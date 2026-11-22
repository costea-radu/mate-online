// =====================================================================
// src/lib/metodeRezolvare.js — metodele din „✏️ Rezolvă ▾" (vizualizatorul PDF) și ORDINEA lor
//
// ✏️ 15 nov. 2026 (seara): „la subiectele PDF, pune la Viewer în bara de sus la butonul
// «rezolvă pe PDF» metodele de rezolvare: pe PDF, cu poză, în chat, în foaia de lucru (…) fă ca
// elevul să poată schimba oricând metoda de rezolvare". Alegerea închide metoda de dinainte
// (scrisul de pe PDF rămâne în ciorna locală) și se ține minte pe dispozitiv — de pe harta
// pregătirii pornește ultima metodă aleasă.
// 🧩 19 nov. 2026: „Interactiv" deschide testul interactiv asociat PDF-ului (content.interactiv_id;
// fără el, metoda nu apare).
// 🎥 22 nov. 2026 — cererea lui Radu: „pune la fiecare test PDF în «rezolvă» și varianta de
// rezolvare în meditație live cu Prof. Virtual Tudor. Ordinea în «rezolvă» la testele de evaluare
// națională și la testele de la clase care sunt grilă: 1) pe PDF; 2) Interactiv; 3) meditație live
// cu Prof. virtual Tudor; 4) cu poză; 5) în chat; 6) în foaia de lucru. La celelalte teste, BAC și
// clase, care nu sunt grilă, ordinea să fie: 1) Interactiv; 2) meditație live cu Prof. virtual
// Tudor; 3) cu poză; 4) în chat; 5) în foaia de lucru; 6) pe PDF."
//
// „Interactiv" și meditația live NU se țin minte ca metodă implicită: amândouă pleacă din PDF
// (de pe harta pregătirii n-ar trebui să plece singur din PDF).
// Fără importuri: testele îl încarcă direct. Vizualizatorul: src/pages/PDFViewer.jsx.
// =====================================================================

// metodele care se pot ține minte ca implicite (`em_metoda_rezolvare`, citesteMetoda în PDFViewer)
export const METODE_REZOLVARE = [
  { id: 'pdf', icon: '✏️', label: 'Pe PDF', scurt: 'Pe PDF' },
  { id: 'poza', icon: '📷', label: 'Cu poză', scurt: 'Poză' },
  { id: 'chat', icon: '💬', label: 'În chat', scurt: 'Chat' },
  { id: 'foaie', icon: '✍️', label: 'În foaia de lucru', scurt: 'Foaia' },
];
export const METODA_INTERACTIV = { id: 'interactiv', icon: '🧩', label: 'Interactiv', scurt: 'Interactiv' };
// ședința 1-la-1 din sala live, chiar pe acest test (api/live.js → private_start)
export const METODA_LIVE = { id: 'live', icon: '🎥', label: 'Meditație live cu Prof. Virtual Tudor', scurt: 'Live' };

// ordinea cerută (22 nov. 2026)
export const ORDINE_GRILA = ['pdf', 'interactiv', 'live', 'poza', 'chat', 'foaie'];   // EN + clase grilă
export const ORDINE_ALTE = ['interactiv', 'live', 'poza', 'chat', 'foaie', 'pdf'];    // BAC + clase negrilă

const TOATE = [...METODE_REZOLVARE, METODA_INTERACTIV, METODA_LIVE];

// Ce metode vede elevul, în ordinea cerută:
//   grila      — testele de Evaluare Națională și testele de la clase care sunt grilă
//                (altfel: BAC și testele de la clase care nu sunt grilă)
//   pdf        — „Pe PDF" se poate (PDF-ul e încărcat, nu e barem, nu e testul generat ca pagină)
//   interactiv — PDF-ul are test interactiv asociat
//   live       — meditația live apare (PDF-urile platformei; nu Biblioteca, nu testul pe grupă)
// Cu poză, în chat și în foaia de lucru sunt mereu.
export function ordineMetode({ grila = false, pdf = true, interactiv = false, live = false } = {}) {
  const are = { pdf: !!pdf, interactiv: !!interactiv, live: !!live, poza: true, chat: true, foaie: true };
  return (grila ? ORDINE_GRILA : ORDINE_ALTE).filter((id) => are[id]).map((id) => TOATE.find((m) => m.id === id));
}

// sub butonul „✏️ Rezolvă ▾": primele metode, în ordinea meniului (toate n-ar mai încăpea în bară)
export const PE_SCURT = { pdf: 'pe PDF', interactiv: 'interactiv', live: 'meditație live', poza: 'poză', chat: 'chat', foaie: 'foaie' };
export function rezumatMetode(metode, cate = 3) {
  const n = (Array.isArray(metode) ? metode : []).map((m) => PE_SCURT[m.id] || m.scurt);
  return n.length > cate ? `${n.slice(0, cate).join(' · ')} · …` : n.join(' · ');
}

// ── Testele GRILĂ, la clase ──────────────────────────────────────────────────
// Ca la Evaluarea Națională: testul cere LITERA (varianta) răspunsului corect. Literele a) b) c)
// d) singure nu ajung — fișele claselor au subpuncte („1. Calculați: a) 24 și 40; b) 24 și 60;
// c) …; d) …"), deci se caută instrucțiunea de grilă, în titlu și la începutul textului.
// Textul scos din PDF rupe cuvintele la diacritice („Încercuie ște litera corespunz ătoare
// r ăspunsului corect", „Incercuie ̧ste…"), deci se compară „lipit": fără diacritice, fără spații
// și fără semne. Verificat pe PDF-urile site-ului (22 nov. 2026): toate testele de EN cu text
// sunt recunoscute; dintre cele 115 fișe ale claselor, niciuna nu e grilă.
const SEMNE_GRILA = [
  /incercui[a-z]{0,4}(?:doar)?(?:litera|varianta|raspunsul)/,             // „Încercuiește litera corespunzătoare…", „Încercuiți varianta…"
  /literacorespunzatoare/,                                                // „Scrieți litera corespunzătoare răspunsului corect"
  /(?:unsingur|singurul(?:ui)?)raspuns(?:ul|ului)?(?:este)?corect/,       // „Pentru fiecare item, un singur răspuns este corect"
  /alege(?:ti)?(?:varianta|raspunsul|litera)corect/,                      // „Alegeți varianta corectă"
  /marcheaz[ai](?:cux)?(?:varianta|raspunsul|litera)corect/,              // „Marchează cu X varianta corectă"
  /(?:test|tip|itemi|intrebari|exercitii|fisa)(?:ul|i|le|a)?(?:de)?(?:tip)?gril[aei]/,   // „test grilă", „itemi de tip grilă"
];
const curat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯʰ-˿¨¯´¸]/g, '').toLowerCase();
const lipit = (s) => curat(s).replace(/[^a-z]/g, '');
export function esteTestGrila(text = '', titlu = '') {
  if (/\bgril[aei]\b/.test(curat(titlu))) return true;                   // „Test grilă — Fracții"
  const t = lipit(`${titlu || ''} ${String(text || '').slice(0, 15000)}`);
  return SEMNE_GRILA.some((re) => re.test(t));
}

// ── 🎥 Meditația live: pe ce teste o poate ține Prof. Tudor ──────────────────
// Prof. Tudor predă live DOAR subiectele de Evaluare Națională și de Bacalaureat cu barem oficial
// (explică strict pe barem — fără barem nu predă) și fără profilul pedagogic (scos din meditațiile
// live). Ultimul cuvânt îl are serverul (api/live.js → private_start: NOT_EXAM, NOT_LIVE,
// NO_BAREM); aici doar ce se știe dinainte, ca meniul să spună adevărul.
//   baremStatus — starea baremului din contextul PDF-ului (api/ai-pdf-context.js); null = încă necunoscută
export const BAREM_OK_LIVE = ['ok', 'ok_antet', 'ok_continut', 'inclus', 'ok_admin'];   // = L.BAREM_OK (api/_lib/live.js)
export function stareLive({ category = null, profile = null, baremStatus = null } = {}) {
  if (category !== 'evaluare-nationala' && category !== 'bacalaureat') {
    return { ok: false, motiv: /^clasa-/.test(category || '') ? 'clasa' : 'alt' };
  }
  if (category === 'bacalaureat' && profile === 'pedagogic') return { ok: false, motiv: 'pedagogic' };
  if (baremStatus && !BAREM_OK_LIVE.includes(baremStatus)) return { ok: false, motiv: 'fara-barem' };
  return { ok: true, motiv: null };
}
// rândul al doilea din meniu
export function subtitluLive(stare) {
  if (stare && stare.ok) return '1-la-1, în sala live: încerci tu, apoi Prof. Tudor îți explică pe barem';
  return ({
    clasa: 'doar la subiectele de EN și BAC cu barem — la testele de la clase, încă nu',
    'fara-barem': 'doar la subiectele cu barem oficial — acest test nu are barem',
    pedagogic: 'meditațiile live nu includ profilul pedagogic',
  })[stare && stare.motiv] || 'doar la subiectele de EN și BAC cu barem oficial';
}
// mesajul de sub bară, la clic, când meditația nu se poate ține pe acest test
export function mesajLiveIndisponibil(motiv) {
  return ({
    clasa: '🎥 Prof. Tudor ține meditațiile live pe subiectele de Evaluare Națională și de Bacalaureat, explicate strict pe baremul oficial. La testele de la clase nu există încă meditații live.',
    'fara-barem': '🎥 Prof. Tudor explică doar pe baremul oficial, iar acest test nu are barem, așa că nu îl poate preda live. În „Meditații live" găsești subiectele cu barem.',
    pedagogic: '🎥 Meditațiile live nu includ profilul pedagogic.',
  })[motiv] || '🎥 Meditațiile live sunt pe subiectele de Evaluare Națională și de Bacalaureat cu barem oficial.';
}

// examenul din lobby-ul Meditațiilor live (src/pages/MeditatiiLive.jsx → EXAMS), din examenul
// subiectului: „en", „mate-info", „stiinte-naturii", „tehnologic"; null = necunoscut
export function examenLobby({ exam = null, profile = null } = {}) {
  if (exam === 'en') return 'en';
  if (exam === 'bac' && ['mate-info', 'stiinte-naturii', 'tehnologic'].includes(profile)) return profile;
  return null;
}
// lobby-ul cu testul ales la „📄 1-la-1: un subiect întreg" (fără drept la ședință: plata e acolo)
export function linkLobbyLive(subiectId, examen = null) {
  return `/meditatii?mod=subiect${examen ? `&examen=${encodeURIComponent(examen)}` : ''}${subiectId ? `&subiect=${encodeURIComponent(subiectId)}` : ''}`;
}
// întoarcerea din sală la testul de unde a pornit elevul (doar vizualizatorul PDF al site-ului)
export const RE_INAPOI_LA_TEST = /^\/pdf-viewer\?id=[0-9a-f-]{36}$/i;
export const cheieInapoi = (sessionId) => `live:inapoi:${sessionId}`;
