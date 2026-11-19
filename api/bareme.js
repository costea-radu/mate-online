// =====================================================================
// api/bareme.js — „📋 BAREME" LA FIECARE CLASĂ (a V-a … a XII-a) — 15 nov. 2026
//
// Cererea: „Adaugă, la fiecare clasă (a V-a…a XII-a), o secțiune nouă «📋 Bareme»
// (în navigarea clasei, lângă capitole): 1. arată toate baremele existente pentru
// exercițiile/fișele clasei (…) 2. adminul poate lega manual un barem de un exercițiu
// de clasă (…) 3. o dată legat, baremul trebuie folosit automat de corectarea
// existentă (Profesorul Virtual, «✏️ Rezolvă pe PDF», «🎓 Cere corectarea») (…)
// 4. respectă regula botului: nu rescrie o legătură pusă deja manual de admin."
//
// Nu e un motor nou: legătura fișă ↔ barem stă tot în ai_pdf_text
// (barem_override_id / barem_override_by — ca la examene, api/ai-pdf-context.js →
// setOverride), iar corectarea o citește tot din getPdfContext (Profesorul Virtual,
// api/ai-correct.js, api/rezolva-pdf.js). Potrivirea automată a unei fișe de clasă e
// cea a botului de examene, generalizată la fișe (api/_lib/barem.js →
// matchBaremByTitle: titlul și numele fișierului; la deschidere, antetul baremului
// poate doar să o refuze — chooseBarem, pasul 0). Baremele clasei sunt materialele
// PDF ale clasei recunoscute ca barem (isBaremRow: rubrica „bareme", titlul sau
// numele fișierului); cele încărcate de aici primesc rubrica „bareme".
//
// POST /api/bareme
//   { action: 'clasa', category: 'clasa-6' }  — oricine (și fără cont): fișele clasei
//       cu baremul lor, pe capitole (api/_lib/capitoleHarta.js), și baremele fără fișă.
//       Elevul vede doar ce are barem; adminul vede tot: propunerile după titlu,
//       cine a legat baremul, fișele fără barem. Secțiunea ascunsă (setarea de mai jos)
//       → elevul primește { vizibil: false } și nimic altceva.
//   — doar admin —
//   { action: 'leaga', contentId, baremId }   — leagă manual (barem_override_by 'admin')
//   { action: 'dezleaga', contentId }         — scoate legătura manuală (înapoi la automat)
//   { action: 'leaga_propuneri', category }   — leagă toate propunerile după titlu, DOAR
//       la fișele fără barem și fără nicio legătură (admin, bot sau alta) — nu rescrie nimic
//   { action: 'incarca', contentId, fileUrl, title? } — baremul încărcat din browser în
//       Storage (content-files[-free]/pdf/<clasa>/…) devine material al clasei (rubrica
//       „bareme") și se leagă de fișă
//   { action: 'vizibil', vizibil: true|false } — secțiunea e vizibilă elevilor?
//       (app_settings → 'bareme_clase'; implicit: vizibilă, ca referință)
// Răspuns (acțiunile de mai sus): starea clasei, ca la 'clasa' — vezi stareClasa.
//
// 💡 EXPLICAȚIILE LA GRILĂ — baremele de Evaluare Națională (18 nov. 2026,
// api/_lib/explicatiiGrila.js, supabase/explicatii_grila.sql):
//   { action: 'explicatii', baremId }      — oricine: există explicații? (fără link)
//   { action: 'explicatii_url', baremId }  — linkul semnat (gratuit → oricine; Premium →
//                                            abonații și adminii)
//   — doar admin — { action: 'explicatii_lista' } · { action: 'explicatii_salveaza',
//   baremId, fileUrl, titlu? } (PDF-ul încărcat din browser în content-files, la
//   pdf/evaluare-nationala/) · { action: 'explicatii_sterge', baremId }
//
// 📋 BAREMELE ORICĂREI CATEGORII — Admin → „📋 Încarcă bareme", „🤖 Variante AI (EN)"
// și „📋 Tot Conținutul" (19 nov. 2026), doar admin:
//   { action: 'incarca_barem', category, profile?, materialId?, fileUrl, title? } — baremul
//       încărcat din browser (content-files[-free]/pdf/<categorie>/…) devine material al
//       categoriei (rubrica „bareme"; la BAC cu profilul) și, cu materialId, se leagă de
//       materialul lui (barem_override_by 'admin') — corectarea și „📋 Barem" îl folosesc
//   { action: 'sterge_barem', baremId } — șterge baremul (rândul, apoi fișierul); legăturile
//       manuale se golesc singure (FK SET NULL), potrivirile automate rămase în cache se
//       recalculează la prima deschidere
//   { action: 'legaturi', baremIds?, materialIds? } — ce material folosește fiecare barem /
//       ce barem are fiecare material (pentru listele din Admin)
// =====================================================================
const ai = require('./_lib/ai');
const http = require('./_lib/http');
const B = require('./_lib/barem');
const CH = require('./_lib/capitoleHarta');
const settings = require('./_lib/settings');
const pdfContext = require('./ai-pdf-context');
const EG = require('./_lib/explicatiiGrila');

const CHEIE = 'bareme_clase';
// baremele oricărei categorii (Admin): clasele, Evaluarea Națională, Bacalaureatul
const CATEGORII_BAREM = new Set(['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12', 'evaluare-nationala', 'bacalaureat']);
const PROFILURI_BAC = new Set(['mate-info', 'stiinte-naturii', 'tehnologic']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// acțiunile care merg și fără cont (un token expirat nu le oprește)
const PUBLICE = new Set(['clasa', 'explicatii', 'explicatii_url']);
const CLASA_RE = /^clasa-(5|6|7|8|9|10|11|12)$/;
const ROMAN = { 5: 'a V-a', 6: 'a VI-a', 7: 'a VII-a', 8: 'a VIII-a', 9: 'a IX-a', 10: 'a X-a', 11: 'a XI-a', 12: 'a XII-a' };
// potrivirile site-ului care contează (ca în api/_lib/planPregatire.js → bareme)
const SITE_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'inclus', 'ok_admin']);
// cine a legat baremul — și ce se vede în Admin; orice alt marcaj (de ex. un task
// programat care generează bareme) apare „de verificat"
const CUM_STIUT = new Set(['admin', 'bot', 'automat', 'inclus']);
const BUCKETS = new Set(['content-files', 'content-files-free']);
const SELECT_CONTENT = 'id, title, category, subcategory, content_type, file_url, is_free, sort_order, created_at';

function eroare(status, msg) { const e = new Error(msg); e.status = status; return e; }

// ─── setarea „secțiunea e vizibilă elevilor" ─────────────────────────────────
async function citesteVizibil(supa) {
  try {
    const r = await settings.readSetting(supa, CHEIE);
    if (!r.setup) return { vizibil: true, setup: false };
    const v = r.value && typeof r.value === 'object' ? r.value.vizibil : r.value;
    return { vizibil: v !== false, setup: true };
  } catch { return { vizibil: true, setup: false }; }
}

// ─── datele: fișele clasei, baremele ei, legăturile din ai_pdf_text ──────────
async function materialeClasa(supa, category) {
  return http.allRows((from, to) => supa.from('content').select(SELECT_CONTENT)
    .eq('category', category).eq('content_type', 'pdf')
    .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    .range(from, to), { pageSize: 1000, maxPages: 5 });
}

async function legaturi(supa, ids) {
  if (!ids.length) return new Map();
  const cols = 'content_id, file_url, barem_status, barem_id, barem, barem_override_id, barem_override_by, updated_at';
  const citeste = (c) => http.inBatches(ids, (chunk, from, to) => supa.from('ai_pdf_text').select(c).in('content_id', chunk).range(from, to));
  let rows = [];
  try { rows = await citeste(cols); } catch (e) {
    // fără coloana barem_override_by (supabase/bot_examene.sql nerulat): ca înainte, totul e „admin"
    if (/barem_override_by/.test(String(e.message || ''))) {
      try { rows = await citeste(cols.replace(', barem_override_by', '')); } catch { rows = []; }
    } else rows = [];   // cache-ul PDF lipsește — nicio legătură încă
  }
  return new Map((rows || []).filter((r) => r && r.content_id).map((r) => [r.content_id, r]));
}

const parseBarem = (b) => { if (typeof b !== 'string') return b || null; try { return JSON.parse(b); } catch { return null; } };

// baremul legat al unei fișe (din rândul ei din ai_pdf_text) → { id, cum } | null
function baremulFisei(fisa, d) {
  if (!d) return null;
  if (d.barem_override_id) return { id: d.barem_override_id, cum: d.barem_override_by || 'admin', manual: true };
  const fisier = !d.file_url || !fisa.file_url || d.file_url === fisa.file_url;
  if (!fisier) return null;                                        // fișierul s-a schimbat → se recalculează
  if (d.barem_status === 'inclus') return { id: fisa.id, cum: 'inclus' };
  if (SITE_OK.has(d.barem_status) && d.barem_id && B.baremCacheValid(fisa, d)) {
    const b = parseBarem(d.barem);
    return { id: d.barem_id, cum: 'automat', dupa: (b && b.matchedBy) || null };
  }
  return null;
}

const ALTE = { id: 'alte', titlu: 'Alte fișe', icon: 'alte', alte: true };
// capitolul unei fișe — după titlu, ca pe harta pregătirii; al unui barem fără fișă —
// după titlu sau, în lipsă, după numele fișierului („Barem_Numere_intregi_fisa_14.pdf")
function capitolul(r, category, { siFisier = false } = {}) {
  const c = CH.capitolDin(r.title, category) || (siFisier ? CH.capitolDin(B.fileNameOf(r).replace(/[_-]+/g, ' '), category) : null);
  return c ? { id: c.id, titlu: c.titlu, icon: c.icon } : ALTE;
}
const scurt = (r) => (r ? { id: r.id, title: r.title || 'Material', is_free: !!r.is_free } : null);

// Starea secțiunii pentru o clasă. `admin` = vede tot (propuneri, fișe fără barem).
async function stareClasa(supa, category, { admin = false, vizibil = true, setup = false } = {}) {
  const g = Number(CLASA_RE.exec(category)[1]);
  const baza = { ok: true, category, clasa: ROMAN[g], vizibil, admin, setupSetare: setup };
  if (!vizibil && !admin) return { ...baza, capitole: [], bareme: [], stats: null };
  const rows = await materialeClasa(supa, category);
  const bareme = rows.filter((r) => B.isBaremRow(r));
  const fise = rows.filter((r) => !B.isBaremRow(r));
  const t = await legaturi(supa, fise.map((f) => f.id));
  const dupaId = new Map(rows.map((r) => [r.id, r]));
  // baremele legate care nu sunt în clasă (legături vechi, alt loc) — doar titlul
  const lipsa = [...new Set(fise.map((f) => baremulFisei(f, t.get(f.id))).filter((x) => x && x.cum !== 'inclus' && !dupaId.has(x.id)).map((x) => x.id))];
  if (lipsa.length) {
    try {
      const { data } = await supa.from('content').select(SELECT_CONTENT).in('id', lipsa);
      for (const r of data || []) dupaId.set(r.id, r);
    } catch { /* rămân fără titlu */ }
  }

  const capitole = [];
  const idxCap = new Map();
  const inCapitol = (cap) => {
    if (!idxCap.has(cap.id)) { idxCap.set(cap.id, capitole.length); capitole.push({ ...cap, intrari: [] }); }
    return capitole[idxCap.get(cap.id)];
  };
  const leg = new Map(fise.map((f) => [f.id, baremulFisei(f, t.get(f.id))]));
  const folosite = new Map();   // baremId → câte fișe
  for (const l of leg.values()) if (l && l.cum !== 'inclus') folosite.set(l.id, (folosite.get(l.id) || 0) + 1);
  // 💡 propunerile după titlu (doar adminul le vede): fișele fără barem, baremele nefolosite,
  // unice în ambele sensuri (barem.propuneriPeTitlu)
  const prop = admin ? B.propuneriPeTitlu(fise.filter((f) => !leg.get(f.id)), bareme, { folosite: new Set(folosite.keys()) }) : new Map();
  let cuBarem = 0;
  for (const f of fise) {
    const l = leg.get(f.id);
    const br = l ? (l.cum === 'inclus' ? f : dupaId.get(l.id) || { id: l.id, title: 'Barem (material șters sau mutat)', is_free: false }) : null;
    const propunere = prop.has(f.id) ? scurt(prop.get(f.id)) : null;
    if (l) cuBarem++;
    if (!l && !admin) continue;                                      // elevul vede doar ce are barem
    const intrare = {
      fisa: scurt(f),
      barem: l ? { ...scurt(br), cum: l.cum, ...(l.dupa ? { dupa: l.dupa } : {}), deVerificat: !CUM_STIUT.has(l.cum) } : null,
    };
    if (admin) { intrare.manual = !!(l && l.manual); if (propunere) intrare.propunere = propunere; }
    inCapitol(capitolul(f, category)).intrari.push(intrare);
  }
  // baremele clasei pe care nu le folosește nicio fișă: la capitolul din titlul lor
  for (const b of bareme) {
    if (folosite.has(b.id)) continue;
    inCapitol(capitolul(b, category, { siFisier: true })).intrari.push({ fisa: null, barem: { ...scurt(b), cum: null, deVerificat: false } });
  }
  // capitolele în ordinea primei lor fișe din site; „Alte fișe" la sfârșit
  const ordonate = [...capitole.filter((c) => !c.alte), ...capitole.filter((c) => c.alte)].map(({ alte, ...c }) => c);
  const out = {
    ...baza,
    capitole: ordonate,
    stats: { fise: fise.length, cuBarem, bareme: bareme.length, propuneri: prop.size },
  };
  if (admin) out.bareme = bareme.map((b) => ({ ...scurt(b), folosit: folosite.get(b.id) || 0 }));
  return out;
}

// O fișă a unei clase (PDF, nu barem) — pentru acțiunile de admin
async function fisaClasei(supa, contentId) {
  if (!contentId) throw eroare(400, 'Alege fișa.');
  const { data: f } = await supa.from('content').select(SELECT_CONTENT).eq('id', contentId).maybeSingle();
  if (!f || f.content_type !== 'pdf' || !f.file_url) throw eroare(404, 'Fișa nu a fost găsită.');
  if (!CLASA_RE.test(String(f.category || ''))) throw eroare(400, 'Secțiunea „Bareme" e doar pentru clasele a V-a – a XII-a.');
  if (B.isBaremRow(f)) throw eroare(400, 'Materialul ales este el însuși un barem.');
  return f;
}

// după o legătură nouă, rezultatul vechi „negăsit" din cache nu mai e bun: corectarea
// recalculează la prima deschidere (fără să atingă legăturile manuale)
async function reimprospateaza(supa, ids) {
  if (!ids.length) return;
  try {
    await supa.from('ai_pdf_text').update({ updated_at: new Date(0).toISOString() })
      .in('content_id', ids).is('barem_override_id', null).in('barem_status', ['negasit', 'ambiguu', 'continut_diferit']);
  } catch { /* fără cache — nimic de împrospătat */ }
}

// ─── 📋 baremele oricărei categorii (Admin, 19 nov. 2026) ─────────────────────
const SELECT_MATERIAL = `${SELECT_CONTENT}, profile`;

// Baremul încărcat din Admin („📋 Încarcă bareme", „🤖 Variante AI"): material PDF al
// categoriei, în rubrica „bareme" (la BAC cu profilul); cu materialId se leagă de el.
async function incarcaBarem(supa, { category, profile, materialId, fileUrl, title } = {}) {
  const cat = String(category || '');
  if (!CATEGORII_BAREM.has(cat)) throw eroare(400, 'Alege clasa sau examenul baremului.');
  let material = null;
  if (materialId) {
    const { data } = await supa.from('content').select(SELECT_MATERIAL).eq('id', String(materialId)).maybeSingle();
    if (!data) throw eroare(404, 'Materialul ales nu a fost găsit.');
    if (data.category !== cat) throw eroare(400, 'Materialul ales e din altă categorie decât baremul.');
    if (data.content_type !== 'pdf') throw eroare(400, 'Baremul se leagă de un material PDF.');
    if (B.isBaremRow(data)) throw eroare(400, 'Materialul ales este el însuși un barem.');
    material = data;
  }
  let prof = null;
  if (cat === 'bacalaureat') {
    prof = String(profile || (material && material.profile) || '');
    if (!PROFILURI_BAC.has(prof)) throw eroare(400, 'Alege profilul de Bacalaureat.');
  }
  let loc;
  try { loc = http.parseStoragePath(String(fileUrl || '')); } catch { throw eroare(400, 'Fișierul încărcat nu a fost găsit.'); }
  if (!BUCKETS.has(loc.bucket) || !loc.filePath.startsWith(`pdf/${cat}/`) || !/\.pdf$/i.test(loc.filePath)) {
    throw eroare(400, 'Baremul trebuie încărcat ca PDF, la materialele categoriei alese.');
  }
  let titlu = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!titlu) titlu = material ? `Barem — ${material.title || 'material'}` : 'Barem';
  else if (!/barem/i.test(titlu)) titlu = `Barem — ${titlu}`;
  const { data: nou, error } = await supa.from('content').insert({
    title: titlu, category: cat, content_type: 'pdf', subcategory: 'bareme', profile: prof,
    is_free: loc.bucket === 'content-files-free', file_url: String(fileUrl), sort_order: 0,
  }).select(SELECT_MATERIAL).single();
  if (error || !nou) throw eroare(500, `Baremul nu a putut fi salvat (${error ? error.message : 'fără răspuns'}).`);
  if (material) {
    await pdfContext.setOverride(supa, material, nou.id, { by: 'admin' });
    await reimprospateaza(supa, [material.id]);
  }
  return { ok: true, barem: { ...scurt(nou), category: nou.category, profile: nou.profile || null }, legatDe: material ? scurt(material) : null };
}

// Ștergerea unui barem din „📋 Tot Conținutul": rândul (legăturile manuale se golesc singure
// — ai_pdf_text.barem_override_id are ON DELETE SET NULL), apoi potrivirile automate rămase
// în cache (recalcul la prima deschidere, ca la setOverride(null)), apoi fișierul.
async function stergeBarem(supa, baremId) {
  const id = String(baremId || '');
  if (!UUID_RE.test(id)) throw eroare(400, 'Baremul lipsește.');
  const { data: b } = await supa.from('content').select(SELECT_MATERIAL).eq('id', id).maybeSingle();
  if (!b) throw eroare(404, 'Baremul nu a fost găsit (poate a fost șters deja).');
  if (!B.isBaremRow(b)) throw eroare(400, 'Materialul nu e un barem — îl ștergi din lista obișnuită.');
  const { data: fol } = await supa.from('ai_pdf_text').select('content_id').eq('barem_override_id', id);
  const { error } = await supa.from('content').delete().eq('id', id);
  if (error) throw eroare(500, `Baremul nu a putut fi șters (${error.message}).`);
  try {
    await supa.from('ai_pdf_text').update({ barem_status: 'negasit', barem_id: null, barem: null, barem_text: '', updated_at: new Date(0).toISOString() }).eq('barem_id', id);
  } catch { /* fără cache — nimic de curățat */ }
  if (b.file_url) {
    try { const l = http.parseStoragePath(b.file_url); await supa.storage.from(l.bucket).remove([l.filePath]); } catch { /* fișierul rămâne — nu oprește nimic */ }
  }
  return { ok: true, sters: id, legaturiScoase: (fol || []).length };
}

// Ce material folosește fiecare barem (baremIds) / ce barem are fiecare material (materialIds)
async function legaturiAdmin(supa, { baremIds = [], materialIds = [] } = {}) {
  const curat = (a) => [...new Set((Array.isArray(a) ? a : []).map(String).filter((x) => UUID_RE.test(x)))].slice(0, 3000);
  const bIds = curat(baremIds);
  const mIds = curat(materialIds);
  const randuri = await legaturi(supa, mIds);
  if (bIds.length) {
    for (const col of ['barem_override_id', 'barem_id']) {
      let rows = [];
      try { rows = await http.inBatches(bIds, (chunk, from, to) => supa.from('ai_pdf_text').select('content_id').in(col, chunk).range(from, to)); } catch { rows = []; }
      const extra = [...new Set((rows || []).map((r) => r.content_id))].filter((cid) => cid && !randuri.has(cid));
      for (const [cid, r] of await legaturi(supa, extra)) randuri.set(cid, r);
    }
  }
  const ids = [...new Set([...randuri.keys(), ...mIds])];
  const mat = new Map();
  if (ids.length) {
    const rows = await http.inBatches(ids, (chunk, from, to) => supa.from('content').select(SELECT_CONTENT).in('id', chunk).range(from, to));
    for (const r of rows || []) mat.set(r.id, r);
  }
  const materiale = {};
  const bareme = {};
  for (const [cid, row] of randuri) {
    const m = mat.get(cid);
    if (!m) continue;
    const l = baremulFisei(m, row);
    if (!l || l.cum === 'inclus') continue;
    if (mIds.includes(cid)) materiale[cid] = { id: l.id, cum: l.cum };
    if (bIds.includes(l.id)) (bareme[l.id] = bareme[l.id] || []).push({ id: m.id, title: m.title || 'Material', cum: l.cum });
  }
  // titlurile baremelor materialelor cerute
  const lipsa = [...new Set(Object.values(materiale).map((x) => x.id))].filter((id) => !mat.has(id));
  if (lipsa.length) {
    const rows = await http.inBatches(lipsa, (chunk, from, to) => supa.from('content').select(SELECT_CONTENT).in('id', chunk).range(from, to));
    for (const r of rows || []) mat.set(r.id, r);
  }
  for (const [cid, l] of Object.entries(materiale)) materiale[cid] = { ...l, title: (mat.get(l.id) || {}).title || 'Barem (material șters sau mutat)' };
  for (const id of mIds) if (!(id in materiale)) materiale[id] = null;
  return { ok: true, materiale, bareme };
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const supa = ai.admin();
  try {
    const body = req.body || {};
    const action = String(body.action || 'clasa');
    // contul e opțional la citire (pagina clasei e publică); obligatoriu la rest
    let profil = null;
    const areToken = !!String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (areToken) {
      try {
        const uid = await ai.authUser(req, supa);
        const { data } = await supa.from('profiles').select('id, is_admin, role, subscription_status').eq('id', uid).maybeSingle();
        profil = data || null;
      } catch (e) { if (!PUBLICE.has(action)) throw e; }
    }
    const admin = !!(profil && profil.is_admin);

    // 💡 explicațiile la grilă (EN): starea și linkul — și fără cont (baremele gratuite)
    if (action === 'explicatii') return res.status(200).json(await EG.stare(supa, body.baremId));
    if (action === 'explicatii_url') return res.status(200).json(await EG.link(supa, body.baremId, { profil }));

    const vz = await citesteVizibil(supa);

    if (action === 'clasa') {
      const category = String(body.category || '');
      if (!CLASA_RE.test(category)) return res.status(400).json({ error: 'Clasă necunoscută.' });
      return res.status(200).json(await stareClasa(supa, category, { admin, ...vz }));
    }

    if (!profil) return res.status(401).json({ error: 'Neautentificat. Reautentifică-te.' });
    if (!admin) return res.status(403).json({ error: 'Doar administratorii pot lega bareme.' });

    if (action === 'explicatii_lista') return res.status(200).json(await EG.lista(supa));
    if (action === 'explicatii_salveaza') {
      return res.status(200).json(await EG.salveaza(supa, { baremId: body.baremId, fileUrl: body.fileUrl, titlu: body.titlu, userId: profil.id }));
    }
    if (action === 'explicatii_sterge') return res.status(200).json(await EG.sterge(supa, { baremId: body.baremId }));

    // 📋 baremele oricărei categorii (19 nov. 2026)
    if (action === 'incarca_barem') return res.status(200).json(await incarcaBarem(supa, body));
    if (action === 'sterge_barem') return res.status(200).json(await stergeBarem(supa, body.baremId));
    if (action === 'legaturi') return res.status(200).json(await legaturiAdmin(supa, body));

    if (action === 'vizibil') {
      const vizibil = body.vizibil !== false;
      await settings.writeSetting(supa, CHEIE, { vizibil }, profil.id);
      const category = CLASA_RE.test(String(body.category || '')) ? body.category : null;
      return res.status(200).json(category ? await stareClasa(supa, category, { admin, vizibil, setup: true }) : { ok: true, vizibil });
    }

    if (action === 'leaga_propuneri') {
      const category = String(body.category || '');
      if (!CLASA_RE.test(category)) return res.status(400).json({ error: 'Clasă necunoscută.' });
      const rows = await materialeClasa(supa, category);
      const bareme = rows.filter((r) => B.isBaremRow(r));
      const fise = rows.filter((r) => !B.isBaremRow(r));
      const t = await legaturi(supa, fise.map((f) => f.id));
      const leg = new Map(fise.map((f) => [f.id, baremulFisei(f, t.get(f.id))]));
      const folosite = new Set([...leg.values()].filter((l) => l && l.cum !== 'inclus').map((l) => l.id));
      // doar fișele fără barem (automat / inclus) și fără nicio legătură (admin, bot, …)
      const prop = B.propuneriPeTitlu(fise.filter((f) => !leg.get(f.id) && !(t.get(f.id) && t.get(f.id).barem_override_id)), bareme, { folosite });
      const legate = [];
      for (const f of fise) {
        const b = prop.get(f.id);
        if (!b) continue;
        // starea LIVE, chiar înainte de scriere: între timp poate fi legat de altcineva
        const { data: acum } = await supa.from('ai_pdf_text').select('barem_override_id').eq('content_id', f.id).maybeSingle();
        if (acum && acum.barem_override_id) continue;
        await pdfContext.setOverride(supa, f, b.id, { by: 'admin' });
        legate.push(f.id);
      }
      return res.status(200).json({ ...(await stareClasa(supa, category, { admin, ...vz })), legate: legate.length });
    }

    if (action === 'leaga' || action === 'dezleaga' || action === 'incarca') {
      const fisa = await fisaClasei(supa, body.contentId);
      if (action === 'dezleaga') {
        await pdfContext.setOverride(supa, fisa, null);
      } else if (action === 'leaga') {
        const baremId = String(body.baremId || '');
        if (!baremId) return res.status(400).json({ error: 'Alege baremul.' });
        const { data: b } = await supa.from('content').select(SELECT_CONTENT).eq('id', baremId).maybeSingle();
        if (!b || b.content_type !== 'pdf' || !b.file_url) return res.status(400).json({ error: 'Baremul ales nu este un PDF valid.' });
        if (b.category !== fisa.category) return res.status(400).json({ error: 'Baremul trebuie să fie un PDF al aceleiași clase.' });
        if (b.id === fisa.id) return res.status(400).json({ error: 'O fișă nu poate fi propriul barem — pentru baremul inclus în fișă nu e nevoie de legătură.' });
        await pdfContext.setOverride(supa, fisa, b.id, { by: 'admin' });
      } else {
        // 📤 baremul încărcat din browser: doar în Storage-ul materialelor, la clasa fișei
        let loc;
        try { loc = http.parseStoragePath(String(body.fileUrl || '')); } catch { return res.status(400).json({ error: 'Fișierul încărcat nu a fost găsit.' }); }
        if (!BUCKETS.has(loc.bucket) || !loc.filePath.startsWith(`pdf/${fisa.category}/`) || !/\.pdf$/i.test(loc.filePath)) {
          return res.status(400).json({ error: 'Baremul trebuie încărcat ca PDF, la materialele clasei.' });
        }
        let titlu = String(body.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (!titlu) titlu = `Barem — ${fisa.title || 'fișă'}`;
        else if (!/barem/i.test(titlu)) titlu = `Barem — ${titlu}`;
        const { data: nou, error } = await supa.from('content').insert({
          title: titlu, category: fisa.category, content_type: 'pdf', subcategory: 'bareme', profile: null,
          is_free: loc.bucket === 'content-files-free', file_url: String(body.fileUrl), sort_order: 0,
        }).select(SELECT_CONTENT).single();
        if (error || !nou) return res.status(500).json({ error: `Baremul nu a putut fi salvat (${error ? error.message : 'fără răspuns'}).` });
        await pdfContext.setOverride(supa, fisa, nou.id, { by: 'admin' });
      }
      await reimprospateaza(supa, [fisa.id]);
      return res.status(200).json(await stareClasa(supa, fisa.category, { admin, ...vz }));
    }

    return res.status(400).json({ error: 'Acțiune necunoscută.' });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('bareme error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

module.exports.stareClasa = stareClasa;
module.exports.baremulFisei = baremulFisei;
module.exports.citesteVizibil = citesteVizibil;
module.exports.incarcaBarem = incarcaBarem;
module.exports.stergeBarem = stergeBarem;
module.exports.legaturiAdmin = legaturiAdmin;
module.exports.CHEIE = CHEIE;
