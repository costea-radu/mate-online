// =====================================================================
// api/_lib/duel.js — duelul ASINCRON 1-la-1 (pasul 3 din gamificare)
//
// Reguli:
//  · provoci doar un COLEG acceptat (tabela `buddies`) — nu pe oricine;
//  · amândoi primesc ACELAȘI test interactiv, la care amândoi au acces;
//  · 48 de ore de la acceptare, fiecare îl rezolvă când poate;
//  · scorul intră DOAR prin api/ai-score.js (recalculat din chei) — nu există
//    drum prin care browserul să scrie direct un rezultat de duel;
//  · adversarul îți vede scorul abia după ce l-ai trimis pe al tău;
//  · câștigă procentul; la egalitate, timpul; altfel e remiză.
//
// Tabela: supabase/gamificare_v3_dueluri.sql
// =====================================================================
const xp = require('./xp');
const ai = require('./ai');
const barem = require('./barem');

const ORE_DUEL = 48;
const MAX_PROVOCARI_PE_ZI = 5;

// XP la final (peste XP-ul normal luat pe exercițiu)
const XP_VICTORIE = 40;
const XP_INFRANGERE = 15;   // ai rezolvat, ai învățat ceva — nu pleci cu zero
const XP_EGALITATE = 25;
const XP_NEPREZENTARE = 20; // adversarul n-a jucat: victorie, dar fără meci
const XP_PER_PROCENT = 25;  // partea care depinde de CÂT ai rezolvat

// XP-ul din duel = o bază (după rezultat) + o parte proporțională cu procentul
// obținut. Așa contează și cât ai rezolvat, nu doar dacă ai câștigat: un elev
// care pierde la limită cu 85% ia aproape cât câștigătorul, iar unul care
// câștigă cu 30% nu ia maximum.
function xpDuel(baza, pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return baza + Math.round((XP_PER_PROCENT * p) / 100);
}

const ms = (ore) => ore * 3600 * 1000;
const pct = (s, m) => (m > 0 ? (s / m) * 100 : 0);

function esteParte(d, userId) {
  return d && (d.challenger_id === userId || d.opponent_id === userId);
}

// Rândul așa cum îl vede un anume elev: adversarul rămâne ascuns până joci.
function forUser(d, userId, nume = {}) {
  const eu = d.challenger_id === userId ? 'challenger' : 'opponent';
  const el = eu === 'challenger' ? 'opponent' : 'challenger';
  const meuScor = d[`${eu}_score`];
  const luiScor = d[`${el}_score`];
  const terminat = d.status === 'terminat' || d.status === 'expirat';
  const amJucat = meuScor != null;
  // rezultat PROVIZORIU = salvarea automată de la jumătatea exercițiului.
  // Elevul poate să se întoarcă și să termine: duelul rămâne deschis.
  const provizoriu = amJucat && d[`${eu}_partial`] === true && !terminat;
  return {
    id: d.id,
    status: d.status,
    euSuntProvocator: eu === 'challenger',
    adversar: { id: d[`${el}_id`], nume: nume[d[`${el}_id`]] || 'Coleg' },
    material: { id: d.content_id, titlu: d.content_title },
    deadline: d.deadline,
    amJucat,
    provizoriu,
    // „am terminat" = am trimis un rezultat FINAL (am apăsat „Verifică")
    amTerminat: amJucat && !provizoriu,
    aJucat: luiScor != null,
    scorulMeu: amJucat ? { scor: meuScor, max: d[`${eu}_max`], pct: Math.round(pct(meuScor, d[`${eu}_max`])), sec: d[`${eu}_sec`] } : null,
    // scorul adversarului se dezvăluie DOAR după ce ai jucat tu sau după final
    scorulLui: (amJucat || terminat) && luiScor != null
      ? { scor: luiScor, max: d[`${el}_max`], pct: Math.round(pct(luiScor, d[`${el}_max`])), sec: d[`${el}_sec`] }
      : null,
    rezultat: terminat
      ? (d.winner_id == null ? 'egalitate' : (d.winner_id === userId ? 'castigat' : 'pierdut'))
      : null,
    tip: d.result,
    creat: d.created_at,
  };
}

// Notificare în clopoțelul existent (AINotifications). Nu blochează niciodată.
async function anunta(supa, recipientId, title, body, data = {}) {
  try { await ai.createNotification(supa, { recipientId, type: 'duel', title, body, data }); }
  catch { /* notificările nu opresc duelul */ }
}

async function numeleLor(supa, ids) {
  const lista = [...new Set(ids.filter(Boolean))];
  if (!lista.length) return {};
  const { data } = await supa.from('profiles').select('id, full_name').in('id', lista);
  const out = {};
  (data || []).forEach((p) => {
    const s = String(p.full_name || '').trim().replace(/\s+/g, ' ');
    const parti = s ? s.split(' ') : [];
    out[p.id] = parti.length > 1 ? `${parti[0]} ${parti[parti.length - 1][0].toUpperCase()}.` : (parti[0] || 'Coleg');
  });
  return out;
}

// Sunt colegi acceptați?
async function suntColegi(supa, a, b) {
  const { data } = await supa.from('buddies')
    .select('id')
    .eq('status', 'accepted')
    .or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`)
    .limit(1);
  return !!(data && data.length);
}

// ─── Lista mea de dueluri ───────────────────────────────────────────────────
async function list(supa, userId) {
  const { data } = await supa.from('duels')
    .select('*')
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(40);
  const rows = data || [];
  const nume = await numeleLor(supa, rows.flatMap((d) => [d.challenger_id, d.opponent_id]));
  const ids = [...new Set(rows.map((d) => d.content_id).filter(Boolean))];
  const { data: mats } = ids.length
    ? await supa.from('content').select('id, content_type').in('id', ids)
    : { data: [] };
  const tip = Object.fromEntries((mats || []).map((m) => [m.id, m.content_type]));
  const toate = rows.map((d) => {
    const v = forUser(d, userId, nume);
    v.material.tip = tip[d.content_id] || 'interactive';
    return v;
  });

  const stats = await xp.ensureStats(supa, userId);
  const castigate = toate.filter((d) => d.rezultat === 'castigat').length;
  const pierdute = toate.filter((d) => d.rezultat === 'pierdut').length;

  return {
    primite: toate.filter((d) => d.status === 'invitat' && !d.euSuntProvocator),
    trimise: toate.filter((d) => d.status === 'invitat' && d.euSuntProvocator),
    active: toate.filter((d) => d.status === 'activ'),
    incheiate: toate.filter((d) => d.status === 'terminat' || d.status === 'expirat').slice(0, 10),
    bilant: { castigate, pierdute },
    accept: stats.duels_open !== false,
  };
}

// ─── Provocarea ─────────────────────────────────────────────────────────────
async function create(supa, userId, { opponentId, contentId }, { isPremium }) {
  if (!opponentId || !contentId) return { error: 'Alege colegul și exercițiul.' };
  if (opponentId === userId) return { error: 'Nu te poți provoca pe tine.' };

  // Provocarea nu mai cere să fiți colegi: poți provoca pe ORICINE de pe site,
  // atâta timp cât persoana e găsibilă („Colegii mei" → poate fi găsit) sau vă
  // știți deja. Supapele rămân: acceptarea duelurilor, limita zilnică și o
  // singură provocare deschisă între aceiași doi elevi.
  const { data: adv } = await supa.from('profiles')
    .select('id, colegi_discoverable, subscription_status, is_admin')
    .eq('id', opponentId).maybeSingle();
  if (!adv) return { error: 'Persoana nu există.' };
  if (adv.colegi_discoverable === false && !await suntColegi(supa, userId, opponentId)) {
    return { error: 'Persoana nu poate fi provocată (și-a oprit găsirea în căutare).' };
  }

  // adversarul acceptă dueluri?
  const advStats = await xp.ensureStats(supa, opponentId);
  if (advStats.duels_open === false) return { error: 'Colegul nu acceptă provocări momentan.' };

  // limita zilnică de provocări trimise
  const azi = new Date(Date.now() - ms(24)).toISOString();
  const { count } = await supa.from('duels')
    .select('id', { count: 'exact', head: true })
    .eq('challenger_id', userId).gte('created_at', azi);
  if ((count || 0) >= MAX_PROVOCARI_PE_ZI) {
    return { error: `Ai trimis deja ${MAX_PROVOCARI_PE_ZI} provocări în ultimele 24 de ore. Mai încearcă mâine.` };
  }

  // materialul: interactiv și accesibil AMÂNDURORA
  const { data: content } = await supa.from('content')
    .select('id, title, content_type, is_free, category, subcategory, file_url').eq('id', contentId).maybeSingle();
  if (!content || !['interactive', 'pdf'].includes(content.content_type)) {
    return { error: 'Alege un exercițiu interactiv sau un test PDF.' };
  }
  // Baremul e răspunsul testului — un duel pe el n-are niciun sens. Filtrul
  // din formular nu le mai arată, dar gardul stă aici, pe server.
  if (barem.isBaremRow(content)) {
    return { error: 'Acela e un barem (rezolvarea testului), nu un exercițiu. Alege testul în sine.' };
  }
  if (!content.is_free) {
    const advPremium = adv?.is_admin || adv?.subscription_status === 'active';
    if (!isPremium || !advPremium) {
      return { error: 'Exercițiul e premium, iar unul dintre voi nu are abonament. Alege un exercițiu gratuit.' };
    }
  }

  const row = {
    challenger_id: userId, opponent_id: opponentId,
    content_id: content.id, content_title: content.title || null,
    status: 'invitat', deadline: new Date(Date.now() + ms(ORE_DUEL)).toISOString(),
  };
  const { data, error } = await supa.from('duels').insert(row).select().maybeSingle();
  if (error) {
    if (/uq_duels_activ|duplicate key/i.test(error.message || '')) {
      return { error: 'Aveți deja un duel în desfășurare cu acest coleg.' };
    }
    return { error: `Duelul nu s-a putut crea (${error.message}).` };
  }
  const nume = await numeleLor(supa, [userId]);
  await anunta(supa, opponentId,
    `${nume[userId] || 'Un coleg'} te-a provocat la duel`,
    `${content.title || 'Exercițiu'} · ai ${ORE_DUEL} de ore să răspunzi.`,
    { duelId: data.id, url: '/arena' });
  return { ok: true, duel: forUser(data, userId, nume) };
}

// ─── Accept / refuz ─────────────────────────────────────────────────────────
async function respond(supa, userId, { id, accept }) {
  const { data: d } = await supa.from('duels').select('*').eq('id', id).maybeSingle();
  if (!d) return { error: 'Duelul nu există.' };
  if (d.opponent_id !== userId) return { error: 'Doar cel provocat poate răspunde.' };
  if (d.status !== 'invitat') return { error: 'Provocarea nu mai e în așteptare.' };

  const patch = accept
    ? { status: 'activ', deadline: new Date(Date.now() + ms(ORE_DUEL)).toISOString(), updated_at: new Date().toISOString() }
    : { status: 'refuzat', updated_at: new Date().toISOString() };
  const { data } = await supa.from('duels').update(patch).eq('id', id).select().maybeSingle();
  const nume2 = await numeleLor(supa, [d.challenger_id, d.opponent_id]);
  const nume = await numeleLor(supa, [userId]);
  await anunta(supa, d.challenger_id,
    accept ? `${nume[userId] || 'Colegul'} a acceptat duelul` : `${nume[userId] || 'Colegul'} a refuzat duelul`,
    accept ? `${d.content_title || 'Exercițiu'} · aveți ${ORE_DUEL} de ore.` : null,
    { duelId: id, url: '/arena' });
  // NU întoarcem rândul brut: conține scorul provocatorului, care poate să fi
  // jucat deja — cel provocat l-ar vedea înainte să rezolve.
  return { ok: true, duel: data ? forUser(data, userId, nume2) : null };
}

// „Nu accept provocări acum"
async function setOpen(supa, userId, open) {
  await xp.ensureStats(supa, userId);
  await supa.from('user_stats').update({ duels_open: !!open, updated_at: new Date().toISOString() }).eq('user_id', userId);
  return { ok: true, accept: !!open };
}

// Pornirea cronometrului: prima deschidere a exercițiului cu ?duel=…
// Se scrie o singură dată per participant (a doua deschidere nu resetează).
async function start(supa, userId, duelId) {
  const { data: d } = await supa.from('duels').select('*').eq('id', duelId).maybeSingle();
  if (!d || !esteParte(d, userId)) return { error: 'Duelul nu există.' };
  const eu = d.challenger_id === userId ? 'challenger' : 'opponent';
  if (d[`${eu}_started_at`]) return { ok: true, deja: true };
  await supa.from('duels')
    .update({ [`${eu}_started_at`]: new Date().toISOString() })
    .eq('id', duelId).is(`${eu}_started_at`, null);
  return { ok: true };
}

// ─── Rezultatul (apelat DOAR din api/ai-score.js, cu scorul verificat) ──────
async function recordScore(supa, userId, duelId, { contentId, score, maxScore, verified = true, partial = false }) {
  try {
    const { data: d } = await supa.from('duels').select('*').eq('id', duelId).maybeSingle();
    if (!d || !esteParte(d, userId)) return null;
    if (d.status !== 'activ' && d.status !== 'invitat') return null;

    // Rezultatul trebuie să vină DIN MATERIALUL DUELULUI. Fără verificarea asta,
    // se putea rezolva un exercițiu ușor și trimite scorul în duelul greu.
    if (!contentId || contentId !== d.content_id) return { altMaterial: true };

    // Materialele fără chei citibile se salvează cu scorul trimis de browser —
    // acolo un POST fabricat ar însemna victorie sigură. Nu intră în duel.
    if (!verified) return { neverificat: true };

    const eu = d.challenger_id === userId ? 'challenger' : 'opponent';
    // O singură încercare per duel — dar un rezultat PROVIZORIU (salvare
    // automată la jumătate) poate fi îmbunătățit sau înlocuit de cel final.
    const areRezultat = d[`${eu}_score`] != null;
    const eProvizoriu = d[`${eu}_partial`] === true;
    if (areRezultat && !eProvizoriu) return { deja: true };
    // un provizoriu nu coboară un provizoriu mai bun
    if (partial && areRezultat) {
      const vechi = d[`${eu}_max`] > 0 ? d[`${eu}_score`] / d[`${eu}_max`] : -1;
      const nou = maxScore > 0 ? score / maxScore : 0;
      if (nou <= vechi) return { partial: true, pastrat: true };
    }

    // Timpul: măsurat pe server, din momentul deschiderii exercițiului.
    const start = d[`${eu}_started_at`];
    const sec = start
      ? Math.max(1, Math.min(6 * 3600, Math.round((Date.now() - new Date(start).getTime()) / 1000)))
      : null;

    // provocatorul poate juca înainte ca adversarul să accepte
    const patch = {
      [`${eu}_score`]: score, [`${eu}_max`]: maxScore, [`${eu}_sec`]: sec,
      [`${eu}_partial`]: !!partial,
      [`${eu}_at`]: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    let { data: dupa, error } = await supa.from('duels').update(patch).eq('id', duelId).select().maybeSingle();
    if (error) { // baza fără coloanele de provizoriu (migrarea v7 nerulată)
      delete patch[`${eu}_partial`];
      ({ data: dupa } = await supa.from('duels').update(patch).eq('id', duelId).select().maybeSingle());
      // Înainte aruncam salvarea parțială aici — elevul care rezolva pe
      // jumătate rămânea cu duelul nejucat. Acum o păstrăm oricum: e mult mai
      // bine decât să piardă tot prin neprezentare.
      if (partial && dupa) {
        console.warn('duel: rulează supabase/gamificare_v7_partial.sql — rezultatul provizoriu s-a salvat ca final.');
        return { partial: true, salvat: true, migrare: true };
      }
    }
    if (!dupa) return null;

    // Duelul se încheie doar când AMBII au trimis un rezultat final. Cele
    // provizorii așteaptă: poate elevul se întoarce și termină exercițiul.
    const amandoi = dupa.challenger_score != null && dupa.opponent_score != null;
    const finale = !dupa.challenger_partial && !dupa.opponent_partial;
    if (amandoi && finale) return await finalize(supa, dupa);
    return partial ? { partial: true, salvat: true } : { asteptam: true };
  } catch (e) {
    console.warn('duel.recordScore:', e?.message || e);
    return null;
  }
}

// Cine câștigă (funcție pură, testabilă separat).
//   procent mai mare → victorie; egalitate la procent → timpul mai scurt;
//   fără timpi comparabili → remiză. Neprezentare: câștigă cine a jucat.
function castigator(d, { neprezentare = false } = {}) {
  // Dacă AMÂNDOI au trimis ceva (fie și un rezultat provizoriu), duelul se
  // judecă normal chiar dacă a expirat — înainte ieșea „expirat", fără
  // câștigător și fără XP, deși amândoi jucaseră.
  const amandoi = d.challenger_score != null && d.opponent_score != null;
  if (neprezentare && !amandoi) {
    if (d.challenger_score != null) return { winner: d.challenger_id, result: 'neprezentare' };
    if (d.opponent_score != null) return { winner: d.opponent_id, result: 'neprezentare' };
    return { winner: null, result: null };
  }
  const pc = Math.round(pct(d.challenger_score || 0, d.challenger_max || 0));
  const po = Math.round(pct(d.opponent_score || 0, d.opponent_max || 0));
  if (pc !== po) return { winner: pc > po ? d.challenger_id : d.opponent_id, result: 'victorie' };
  const tc = d.challenger_sec || 0; const to = d.opponent_sec || 0;
  if (tc > 0 && to > 0 && tc !== to) return { winner: tc < to ? d.challenger_id : d.opponent_id, result: 'victorie' };
  return { winner: null, result: 'egalitate' };
}

// Varianta pentru materialele PDF: corectarea AI (api/ai-correct.js) nu
// primește `duelId`, dar duelul e oricum unic pe (participant, material) cât
// timp e deschis — deci îl găsim după material.
async function recordByContent(supa, userId, contentId, { score, maxScore, partial = false }) {
  try {
    if (!contentId) return null;
    const { data } = await supa.from('duels')
      .select('id')
      .eq('content_id', contentId)
      .in('status', ['invitat', 'activ'])
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .limit(1);
    if (!data || !data.length) return null;
    return await recordScore(supa, userId, data[0].id, { contentId, score, maxScore, verified: true, partial });
  } catch (e) {
    console.warn('duel.recordByContent:', e?.message || e);
    return null;
  }
}

// ─── Închiderea unui duel ───────────────────────────────────────────────────
async function finalize(supa, d, { neprezentare = false } = {}) {
  const { winner, result } = castigator(d, { neprezentare });

  await supa.from('duels').update({
    status: neprezentare && !winner ? 'expirat' : 'terminat',
    winner_id: winner, result, updated_at: new Date().toISOString(),
  }).eq('id', d.id);

  // XP: câștigătorul ia mai mult, dar și cel care pierde primește ceva —
  // altfel elevul mai slab joacă de două ori și abandonează.
  const perdant = winner ? (winner === d.challenger_id ? d.opponent_id : d.challenger_id) : null;
  const pctul = (u) => (u === d.challenger_id
    ? pct(d.challenger_score || 0, d.challenger_max || 0)
    : pct(d.opponent_score || 0, d.opponent_max || 0));
  const aJucat = (u) => (u === d.challenger_id ? d.challenger_score : d.opponent_score) != null;

  if (neprezentare) {
    if (winner) {
      await xp.bonus(supa, winner, { source: 'duel', refId: d.id, xp: xpDuel(XP_NEPREZENTARE, pctul(winner)), coins: 5, meta: { rezultat: 'neprezentare', pct: Math.round(pctul(winner)) } });
    }
  } else if (winner) {
    await xp.bonus(supa, winner, { source: 'duel', refId: d.id, xp: xpDuel(XP_VICTORIE, pctul(winner)), coins: 10, meta: { rezultat: 'victorie', pct: Math.round(pctul(winner)) } });
    if (perdant && aJucat(perdant)) {
      await xp.bonus(supa, perdant, { source: 'duel', refId: d.id, xp: xpDuel(XP_INFRANGERE, pctul(perdant)), coins: 3, meta: { rezultat: 'infrangere', pct: Math.round(pctul(perdant)) } });
    }
  } else {
    for (const u of [d.challenger_id, d.opponent_id]) {
      if (!aJucat(u)) continue;
      await xp.bonus(supa, u, { source: 'duel', refId: d.id, xp: xpDuel(XP_EGALITATE, pctul(u)), coins: 5, meta: { rezultat: 'egalitate', pct: Math.round(pctul(u)) } });
    }
  }

  const nume = await numeleLor(supa, [d.challenger_id, d.opponent_id]);
  for (const u of [d.challenger_id, d.opponent_id]) {
    const altul = u === d.challenger_id ? d.opponent_id : d.challenger_id;
    const titlu = result == null ? 'Duel expirat — nu a jucat nimeni'
      : winner == null ? 'Duel încheiat la egalitate'
        : (winner === u ? 'Ai câștigat duelul!' : 'Duel pierdut');
    await anunta(supa, u, titlu,
      `${d.content_title || 'Exercițiu'} · cu ${nume[altul] || 'colegul tău'}`,
      { duelId: d.id, url: '/arena' });
  }

  return { gata: true, winner, result };
}

// ─── Cron: duelurile depășite ───────────────────────────────────────────────
async function expire(supa) {
  const acum = new Date().toISOString();
  const { data } = await supa.from('duels')
    .select('*').in('status', ['invitat', 'activ']).lt('deadline', acum).limit(200);
  let inchise = 0;
  for (const d of data || []) {
    if (d.status === 'invitat' && d.challenger_score == null && d.opponent_score == null) {
      await supa.from('duels').update({ status: 'expirat', updated_at: acum }).eq('id', d.id);
    } else {
      await finalize(supa, d, { neprezentare: true });
    }
    inchise++;
  }
  return { ok: true, inchise };
}

module.exports = {
  ORE_DUEL, MAX_PROVOCARI_PE_ZI, XP_VICTORIE, XP_INFRANGERE, XP_EGALITATE, XP_NEPREZENTARE, xpDuel,
  forUser, esteParte, suntColegi, numeleLor, castigator,
  list, create, respond, setOpen, start, recordScore, recordByContent, finalize, expire,
};
