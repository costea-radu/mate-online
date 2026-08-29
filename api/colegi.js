// =====================================================================
// api/colegi.js — COLEGI pe tot site-ul (ca la Facebook)
//
// Oricine poate căuta pe ORICINE, pe CATEGORII, în funcție de rolul lui:
//
//   • profesor → colegi profesori · elevi · părinți
//   • elev     → colegi elevi     · profesori · părinți
//   • părinte  → alți părinți     · profesori · elevi
//
// Îi trimite cerere, iar după ACCEPTARE cei doi pot discuta 1-la-1 oricând,
// indiferent de grupă (api/messages.js).
//
// Confidențialitate (neschimbată de deschiderea pe roluri):
//   • căutarea cere minimum 3 caractere și întoarce DOAR numele și rolul
//     (niciodată e-mailul);
//   • se caută doar printre cei care au lăsat pornit „Pot fi găsit de colegi"
//     (`profiles.colegi_discoverable`, comutator în „Lista persoane");
//   • nimeni nu poate scrie nimănui până când cererea NU e acceptată.
//
// POST { action, ... }
//   list      : colegii mei + cererile primite/trimise + categoriile de căutare
//   search    : { q, role } → oameni din categoria cerută, negăsiți încă în listă
//   request   : { otherId } → trimite cererea (orice rol către orice rol)
//   respond   : { id, accept } → acceptă / refuză o cerere primită
//   remove    : { otherId } → șterge legătura (sau anulează cererea trimisă)
//   set_visible: { visible } → pornește/oprește găsirea în căutare
//
// Tabele: supabase/mesagerie.sql (`buddies`, `profiles.colegi_discoverable`)
// =====================================================================
const ai = require('./_lib/ai');

const ROLES = ['elev', 'profesor', 'parinte'];
const ROLE_LABEL = { profesor: 'profesor', elev: 'elev', parinte: 'părinte' };
const ROLE_ICON = { profesor: '🧑‍🏫', elev: '🎓', parinte: '👨‍👩‍👧' };

// Categoriile de căutare, în ordinea în care le vede fiecare. Prima e mereu
// „colegii" — oamenii cu ACELAȘI tip de cont; după ea vin celelalte două.
const CAT_ORDER = {
  profesor: ['profesor', 'elev', 'parinte'],
  elev:     ['elev', 'profesor', 'parinte'],
  parinte:  ['parinte', 'profesor', 'elev'],
};
const CAT_LABEL = {
  profesor: { profesor: 'Colegi profesori', elev: 'Elevi',     parinte: 'Părinți' },
  elev:     { elev: 'Colegi de clasă',      profesor: 'Profesori', parinte: 'Părinți' },
  parinte:  { parinte: 'Alți părinți',      profesor: 'Profesori', elev: 'Elevi' },
};
const categoriesFor = (role) => (CAT_ORDER[role] || CAT_ORDER.elev).map((k) => ({
  key: k,
  label: (CAT_LABEL[role] || CAT_LABEL.elev)[k] || ROLE_LABEL[k],
  icon: ROLE_ICON[k],
}));

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const { action } = req.body || {};
    if (action === 'list') return await list(req, res, supa);
    if (action === 'search') return await search(req, res, supa);
    if (action === 'request') return await request(req, res, supa);
    if (action === 'respond') return await respond(req, res, supa);
    if (action === 'remove') return await remove(req, res, supa);
    if (action === 'set_visible') return await setVisible(req, res, supa);
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('colegi error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

// ─── Ajutoare ────────────────────────────────────────────────────────────────
async function me(req, supa) {
  const userId = await ai.authUser(req, supa);
  const { data } = await supa.from('profiles')
    .select('id, full_name, username, email, role, colegi_discoverable').eq('id', userId).maybeSingle();
  if (!data) { const e = new Error('Profil inexistent.'); e.status = 404; throw e; }
  const role = ROLES.includes(data.role) ? data.role : 'elev';
  return { userId, profile: data, role };
}

const nameOf = (p) => p?.full_name || p?.username || (p?.email ? p.email.split('@')[0] : null) || 'Utilizator';

async function namesOf(supa, ids) {
  const out = {};
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return out;
  const { data } = await supa.from('profiles').select('id, full_name, username, email, role').in('id', uniq);
  (data || []).forEach((p) => { out[p.id] = { id: p.id, name: nameOf(p), role: ROLES.includes(p.role) ? p.role : 'elev' }; });
  return out;
}

// Toate legăturile mele (acceptate sau în așteptare), într-o singură citire.
async function linksOf(supa, userId) {
  const { data } = await supa.from('buddies')
    .select('id, requester_id, addressee_id, role, status, created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  return data || [];
}

// ─── Lista mea de colegi ─────────────────────────────────────────────────────
async function list(req, res, supa) {
  const { userId, profile, role } = await me(req, supa);
  const links = await linksOf(supa, userId);
  const others = links.map((l) => (l.requester_id === userId ? l.addressee_id : l.requester_id));
  const info = await namesOf(supa, others);

  const colegi = [];
  const incoming = [];
  const outgoing = [];
  links.forEach((l) => {
    const otherId = l.requester_id === userId ? l.addressee_id : l.requester_id;
    // rolul CELUILALT se ia din profilul lui, nu din `buddies.role` (acolo e
    // scris rolul celui care a trimis cererea, iar rolurile pot fi diferite)
    const p = info[otherId] || { id: otherId, name: 'Utilizator', role: null };
    const row = {
      linkId: l.id, id: otherId, name: p.name, role: p.role,
      roleLabel: ROLE_LABEL[p.role] || '', at: l.created_at,
    };
    if (l.status === 'accepted') colegi.push(row);
    else if (l.addressee_id === userId) incoming.push(row);
    else outgoing.push(row);
  });

  // grupate pe categorii (întâi cei ca mine), apoi alfabetic
  const ordine = CAT_ORDER[role] || CAT_ORDER.elev;
  const rang = (r) => { const i = ordine.indexOf(r); return i === -1 ? 9 : i; };
  colegi.sort((a, b) => (rang(a.role) - rang(b.role)) || a.name.localeCompare(b.name, 'ro'));

  return res.status(200).json({
    colegi, incoming, outgoing,
    role, roleLabel: ROLE_LABEL[role] || role,
    categories: categoriesFor(role),
    myName: nameOf(profile),
    discoverable: profile.colegi_discoverable !== false,
  });
}

// ─── Căutare pe CATEGORII (orice rol poate căuta orice rol) ─────────────────
// `role` spune în ce categorie caut: profesori, elevi sau părinți. Lipsă →
// categoria mea („colegii"), ca înainte.
async function search(req, res, supa) {
  const { userId, role } = await me(req, supa);
  const q = String(req.body?.q || '').trim();
  const want = ROLES.includes(req.body?.role) ? req.body.role : role;
  if (q.length < 3) return res.status(200).json({ items: [], role: want, hint: 'Scrie cel puțin 3 litere din nume.' });

  const like = `%${q.replace(/[%_,()]/g, ' ')}%`;
  const baza = () => supa.from('profiles')
    .select('id, full_name, username, email, role, colegi_discoverable')
    .neq('id', userId)
    .or(`full_name.ilike.${like},username.ilike.${like}`)
    .limit(60);

  const { data: d1 } = await baza().eq('role', want);
  const gasiti = [...(d1 || [])];
  // Contul care nu și-a ales încă rolul e tratat peste tot ca „elev", deci
  // apare și el în categoria „elevi" — a doua interogare, nu un al doilea
  // filtru `or` pe aceeași cerere (combinarea lor nu e la fel de limpede).
  if (want === 'elev') {
    const { data: d2 } = await baza().is('role', null);
    (d2 || []).forEach((p) => { if (!gasiti.some((x) => x.id === p.id)) gasiti.push(p); });
  }

  // scoatem cei care au oprit găsirea și cei cu care am deja o legătură
  const links = await linksOf(supa, userId);
  const known = new Set(links.map((l) => (l.requester_id === userId ? l.addressee_id : l.requester_id)));
  const items = gasiti
    .filter((p) => p.colegi_discoverable !== false && !known.has(p.id))
    .slice(0, 20)
    .map((p) => ({ id: p.id, name: nameOf(p), role: want, roleLabel: ROLE_LABEL[want] || want }));

  return res.status(200).json({ items, role: want, roleLabel: ROLE_LABEL[want] || want });
}

// ─── Cerere de coleg ─────────────────────────────────────────────────────────
async function request(req, res, supa) {
  const { userId, profile, role } = await me(req, supa);
  const { otherId } = req.body || {};
  if (!otherId) return res.status(400).json({ error: 'otherId obligatoriu' });
  if (otherId === userId) return res.status(400).json({ error: 'Nu îți poți trimite ție cerere.' });

  const { data: other } = await supa.from('profiles')
    .select('id, full_name, username, email, role, colegi_discoverable').eq('id', otherId).maybeSingle();
  if (!other) return res.status(404).json({ error: 'Contul nu există.' });
  // Rolurile pot fi DIFERITE: un elev poate cere unui profesor sau unui
  // părinte, și invers. Legătura rămâne valabilă doar dacă e acceptată.

  const links = await linksOf(supa, userId);
  const existing = links.find((l) => l.requester_id === otherId || l.addressee_id === otherId);
  if (existing) {
    return res.status(200).json({ ok: true, already: existing.status === 'accepted' ? 'coleg' : 'cerere' });
  }

  // `role` = rolul CELUI CARE CERE (rolul celuilalt se citește din profilul lui)
  const { error } = await supa.from('buddies').insert({
    requester_id: userId, addressee_id: otherId, role, status: 'pending',
  });
  if (error) return res.status(500).json({ error: error.message });

  try {
    await ai.createNotification(supa, {
      recipientId: otherId, type: 'coleg',
      title: `${nameOf(profile)} (${ROLE_LABEL[role] || role}) vrea să vă fiți colegi`,
      body: 'Acceptă din „Lista persoane", în Contul meu.',
      data: { url: '/profil?colegi=1' },
      dedupeKey: `coleg_req:${userId}:${otherId}`, dedupeDays: 14,
    });
  } catch (e) { console.warn('colegi notify:', e.message); }

  return res.status(200).json({ ok: true, status: 'pending' });
}

// ─── Răspuns la o cerere primită ─────────────────────────────────────────────
async function respond(req, res, supa) {
  const { userId, profile, role } = await me(req, supa);
  const { id, accept = true } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obligatoriu' });

  const { data: l } = await supa.from('buddies').select('*').eq('id', id).maybeSingle();
  if (!l) return res.status(404).json({ error: 'Cererea nu există.' });
  if (l.addressee_id !== userId) return res.status(403).json({ error: 'Cererea nu îți este adresată.' });

  if (!accept) {
    await supa.from('buddies').delete().eq('id', id);
    return res.status(200).json({ ok: true, status: 'refuzat' });
  }

  const { error } = await supa.from('buddies')
    .update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });

  try {
    await ai.createNotification(supa, {
      recipientId: l.requester_id, type: 'coleg',
      title: `${nameOf(profile)} (${ROLE_LABEL[role] || role}) ți-a acceptat cererea de coleg`,
      body: 'Îi poți scrie oricând din Mesagerie.',
      data: { url: '/mesagerie' },
      dedupeKey: `coleg_ok:${l.id}`, dedupeDays: 14,
    });
  } catch (e) { console.warn('colegi notify:', e.message); }

  return res.status(200).json({ ok: true, status: 'accepted' });
}

// ─── Ștergerea unei legături (sau anularea cererii trimise) ──────────────────
async function remove(req, res, supa) {
  const { userId } = await me(req, supa);
  const { otherId } = req.body || {};
  if (!otherId) return res.status(400).json({ error: 'otherId obligatoriu' });
  await supa.from('buddies').delete()
    .or(`and(requester_id.eq.${userId},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${userId})`);
  return res.status(200).json({ ok: true });
}

// ─── „Pot fi găsit de colegi" ────────────────────────────────────────────────
async function setVisible(req, res, supa) {
  const { userId } = await me(req, supa);
  const visible = req.body?.visible !== false;
  const { error } = await supa.from('profiles').update({ colegi_discoverable: visible }).eq('id', userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, discoverable: visible });
}
