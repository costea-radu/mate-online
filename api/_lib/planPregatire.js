// =====================================================================
// api/_lib/planPregatire.js — „🗺️ HARTA PREGĂTIRII", planul de parcurs din
// „🎯 Pregătește-mă de examen" (13 nov. 2026)
//
// Cererea lui Radu (13 nov., dimineața): „pune în «pregătește-mă de examen» un
// plan de pregătire cu exerciții în ordine: planul să conțină, în ordine, toate
// exercițiile interactive din subiectele de la «capitole cu exerciții»,
// «exerciții pe subiecte» și apoi «teste interactive» de la tipul de examen ales
// de elev. După terminarea testelor interactive, să se treacă la cele PDF. (…)
// Să se poată alege și o clasă (…) Planul să se poată vedea ca o hartă (…) Harta
// să se updateze mereu, dacă se adaugă exerciții noi în site. Să se poată stagna
// pe hartă la un exercițiu până îl termină, dar să poată și trece mai departe
// după mai multe încercări. Dacă se întrerupe șirul de zile, să se poată relua de
// unde a rămas."
// Și (13 nov., după-amiaza): „scoate din hartă PDF exerciții pe capitole și
// exerciții pe subiecte. păstrează doar subiecte de examen cu corectare după
// barem. împarte harta în două: prima dată harta exercițiilor interactive și a
// doua harta exercițiilor PDF" + „fă să apară progresul din hartă în «rezultate»,
// la profesori și părinți".
//
// Cum merge:
//   · ȚINTA (user_stats.prep_exam): un examen (EN, BAC M1/M2/M3) sau o clasă
//     (clasa-5 … clasa-12) — aleasă în /pregateste-ma (api/_lib/pregatireZilnica.js).
//   · DOUĂ HĂRȚI, fiecare cu drumul și pasul ei curent:
//       🧩 INTERACTIVĂ — examen: Capitole cu exerciții · Exerciții pe subiecte ·
//          Teste interactive; clasă: interactivele clasei alese, apoi ale claselor
//          dinainte (… a V-a);
//       📄 PDF — DOAR subiecte cu corectare după barem: examen → Variante ·
//          (BAC) Teste de antrenament · Simulări, fiecare cu baremul lui legat
//          (potrivirea site-ului din ai_pdf_text sau legătura botului de examene din
//          exam_bot_index); clasă → fișele clasei (și ale celor dinainte) care au
//          barem. Fără informații despre bareme (tabelele lipsă): la examen intră
//          toate subiectele (au barem oficial), la clasă niciuna.
//     Pasul zilei vine din harta interactivă; când e gata, din cea PDF. Harta PDF
//     se poate lucra oricând, în paralel (cu Premium — corectarea e Premium).
//   · HARTA se construiește din `content` la FIECARE deschidere (sort_order, apoi
//     created_at descrescător — exact ca listele din site): un exercițiu nou apare
//     singur la locul lui, marcat „nou" dacă e adăugat după începutul planului.
//   · STAREA unui pas vine din `progress` (aceeași sursă ca „Rezultatele mele"):
//       nou       — neînceput;
//       inceput   — doar salvarea automată de la jumătate (attempts = 0) → „neterminat";
//       incercat  — trimis / corectat, sub prag (încercările se numără);
//       trecut    — PRAG_INTERACTIV% la interactive, PRAG_PDF% la PDF (nota 5);
//                   ținut minte în prep_plan.trecute: o reluare mai slabă nu-l
//                   mai scoate de pe hartă;
//       sarit     — „⏭ Treci mai departe", permis după INCERCARI_SARIRE încercări.
//   · PASUL CURENT al unei hărți = primul pas accesibil care nu e trecut și nici
//     sărit. Elevul „stagnează" pe el până îl trece sau până are destule încercări
//     ca să sară; pașii de după sunt încuiați (cei la care a lucrat deja din site
//     rămân deschiși). Nimic nu depinde de seria de zile.
//   · FĂRĂ ABONAMENT: pașii Premium și testele PDF (corectarea lor e Premium) apar
//     pe hartă cu ⭐ și nu opresc planul.
//   · PROFESORII ȘI PĂRINȚII văd progresul (rezumat) în „Rezultate" —
//     rezumateElevi() → api/teacher-students.js → src/components/TeacherResults.jsx.
//
// 15 nov. 2026 (seara) — CE LUCREZI ACUM: „fă să poată alege în hartă să facă direct teste
// interactive sau pdf. la premium, fă să poată alege orice pas. testele premium să rămână
// premium și în pași". prep_plan.focus = { harta, id, etapa } — de unde pornește pasul
// curent al hărții alese (și pasul zilei vine din ea): oricine poate porni de la începutul
// unei etape (de ex. „Teste interactive") sau din harta PDF (cu Premium — corectarea e
// Premium); cu Premium, de la orice pas, iar toți pașii accesibili sunt deschiși (nu se
// mai încuie pașii de după). Pasul curent = primul pas accesibil netrecut de la focus
// încolo (apoi, dacă toți de după sunt gata, primul de la început). Pașii Premium rămân ⭐
// fără abonament (accesibil). alegeFocus() — api/gamificare.js → 'plan_focus'.
//
// Tabela: supabase/plan_pregatire.sql (coloana user_stats.prep_plan — sărite,
// trecute, începutul planului). Fără coloană, harta merge, doar „⏭ Treci mai
// departe" cere migrarea. Funcțiile cu baza de date nu aruncă spre apelant.
//
// 15 nov. 2026 — HĂRȚI PE CAPITOLE, CU PICTOGRAME: „Hărți cu pictograme, împărțită pe
// capitole, la fiecare capitol mai mulți pași. Dacă adaug PDF cu numele capitolului să
// îl adauge în plus la capitolul din hartă ca un pas în plus. Elevul să vadă progresul
// pe capitole, dar și pe ligă (…) și la părinți și profesori."
//   · În fiecare etapă, pașii se grupează pe CAPITOLE (api/_lib/capitoleHarta.js, după
//     titlu): capitolele apar în ordinea primului lor exercițiu din site, iar în capitol
//     exercițiile rămân în ordinea din site; ce nu se recunoaște — „Alte exerciții", la
//     sfârșit. „Exerciții pe subiecte" se grupează pe Subiectul I / II / III, testele
//     interactive câte 10, subiectele PDF (variante, simulări) pe ani.
//   · Un PDF numit după capitol (cu barem legat — regula hărții PDF rămâne) apare singur
//     în capitolul lui: la clase, în fișele PDF ale clasei; la examen, într-o etapă nouă
//     a hărții PDF, „Fișe pe capitole" (doar fișele recunoscute pe un capitol și cu barem;
//     PLAN_PDF_CAPITOLE=0 o oprește).
//   · `vedereHarta` dă și `capitole` (pictograma, câți pași, câți trecuți, capitolul
//     pasului curent); rezumatul pentru profesori / părinți — la fel, fără pași.
// =====================================================================
const http = require('./http');
const barem = require('./barem');
const CH = require('./capitoleHarta');

const envInt = (k, d, min, max) => { const n = parseInt(process.env[k] || '', 10); return Number.isFinite(n) && n >= min && n <= max ? n : d; };
const PRAG_INTERACTIV = envInt('PLAN_PRAG', 70, 1, 100);       // pasul interactiv e trecut de la atât la sută
const PRAG_PDF = envInt('PLAN_PRAG_PDF', 50, 1, 100);          // testul PDF: nota 5 (corectarea costă AI)
const INCERCARI_SARIRE = envInt('PLAN_INCERCARI', 3, 1, 20);    // după câte încercări poate trece mai departe
const MAX_LISTA = 3000;                                         // plafonul listelor din prep_plan
const TESTE_PE_GRUPA = 10;                                      // testele interactive, câte 10 pe „capitol"
// fișele PDF pe capitole (cu barem) intră și ele în harta PDF a unui examen (15 nov. 2026)
const PDF_CAPITOLE = () => process.env.PLAN_PDF_CAPITOLE !== '0';

const ROMAN = { 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII' };
const CLASE = [5, 6, 7, 8, 9, 10, 11, 12];
const numeClasa = (g) => `Clasa a ${ROMAN[g]}-a`;
const STARI_LUCRATE = ['trecut', 'incercat', 'inceput', 'sarit'];
const HARTI = ['interactiv', 'pdf'];

// baremul legat: potrivirea confirmată a site-ului / ales de admin (ai_pdf_text) sau
// legătura botului de examene (exam_bot_index) — aceleași stări ca în api/_lib/examBotRun.js
const BAREM_SITE_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'inclus', 'ok_admin']);
const BAREM_BOT_OK = new Set([...BAREM_SITE_OK, 'ok_bot']);

// ─── Etapele unei ținte, în ordinea din site ────────────────────────────────
// tinta: { tip: 'examen', category, profile } | { tip: 'clasa', clasa }
// `profil: null` = oricare (EN; „Capitole cu exerciții" de la BAC sunt comune profilurilor)
// `doarCuBarem` (hartă PDF): intră doar subiectele cu barem; `dacaNuStim` — ce intră când
// nu se știe nimic despre bareme (tabelele lipsă): 'toate' (subiecte oficiale) / 'niciunul'
// `grupare` — cum se împart pașii etapei pe „capitole" (15 nov. 2026): 'capitol' (după
// titlu, api/_lib/capitoleHarta.js), 'subiect' (Subiectul I / II / III), 'bucati' (câte
// TESTE_PE_GRUPA), 'an' (anul subiectului). `doarCuCapitol` — intră doar ce se
// recunoaște pe un capitol (fișele pe capitole din harta PDF a unui examen).
function etape(tinta) {
  if (!tinta) return [];
  if (tinta.tip === 'clasa') {
    const g0 = Number(tinta.clasa);
    if (!CLASE.includes(g0)) return [];
    const out = [];
    for (let g = g0; g >= 5; g--) out.push({ id: `c${g}-int`, harta: 'interactiv', titlu: `${numeClasa(g)} · exerciții interactive`, tip: 'interactive', category: `clasa-${g}`, subcategory: null, profil: null, grupare: 'capitol' });
    for (let g = g0; g >= 5; g--) out.push({ id: `c${g}-pdf`, harta: 'pdf', titlu: `${numeClasa(g)} · fișe PDF cu barem`, tip: 'pdf', category: `clasa-${g}`, subcategory: null, profil: null, doarCuBarem: true, dacaNuStim: 'niciunul', grupare: 'capitol' });
    return out;
  }
  const cat = tinta.category;
  if (cat !== 'evaluare-nationala' && cat !== 'bacalaureat') return [];
  const en = cat === 'evaluare-nationala';
  const prof = en ? null : (tinta.profile || null);
  const subiecte = en ? 'exercitii-subiecte' : 'exercitii';
  const pdf = (o) => ({ harta: 'pdf', tip: 'pdf', category: cat, profil: prof, doarCuBarem: true, dacaNuStim: 'toate', grupare: 'an', ...o });
  return [
    { id: 'capitole', harta: 'interactiv', titlu: 'Capitole cu exerciții', tip: 'interactive', category: cat, subcategory: 'capitole', profil: null, grupare: 'capitol' },
    { id: 'subiecte', harta: 'interactiv', titlu: 'Exerciții pe subiecte', tip: 'interactive', category: cat, subcategory: subiecte, profil: prof, grupare: 'subiect' },
    { id: 'teste', harta: 'interactiv', titlu: 'Teste interactive', tip: 'interactive', category: cat, subcategory: 'teste-interactive', profil: prof, grupare: 'bucati', icon: 'test' },
    // harta PDF: subiectele de examen (13 nov., după-amiaza) — și, din 15 nov., fișele PDF
    // numite după un capitol, dacă au barem (un pas în plus la capitolul lor); doar ele,
    // nu toate fișele pe capitole / pe subiecte
    ...(PDF_CAPITOLE() ? [pdf({ id: 'pdf-capitole', titlu: 'Fișe pe capitole', subcategory: 'capitole', profil: null, grupare: 'capitol', doarCuCapitol: true, dacaNuStim: 'niciunul' })] : []),
    pdf({ id: 'pdf-variante', titlu: en ? 'Variante date și modele' : 'Variante date, olimpici, rezerve', subcategory: 'variante', icon: 'varianta' }),
    ...(en ? [] : [pdf({ id: 'pdf-antrenament', titlu: 'Teste de antrenament', subcategory: 'teste-antrenament', icon: 'antrenament' })]),
    pdf({ id: 'pdf-simulari', titlu: en ? 'Simulări' : 'Simulări și modele', subcategory: 'simulari', icon: 'simulare' }),
    // 26 nov. 2026: variantele generate cu AI (procedura 4 a skill-ului; și PDF-urile testelor
    // interactive de EN, procedura 8) — la sfârșitul hărții PDF, în ordinea în care au apărut
    ...(en ? [pdf({ id: 'pdf-variante-ai', titlu: 'Variante generate cu AI', subcategory: 'variante-ai', grupare: 'bucati', icon: 'varianta', ordine: 'creare', bucati: ['Varianta', 'Variantele'] })] : []),
  ];
}

// categoriile din care se citește conținutul planului
function categorii(tinta) {
  if (!tinta) return [];
  if (tinta.tip === 'clasa') return CLASE.filter((g) => g <= Number(tinta.clasa)).sort((a, b) => b - a).map((g) => `clasa-${g}`);
  return tinta.category ? [tinta.category] : [];
}

const tipul = (row) => (row && row.content_type === 'pdf' ? 'pdf' : row && row.content_type === 'interactive' ? 'interactive' : null);

function sePotriveste(row, et) {
  if (!row || row.category !== et.category || tipul(row) !== et.tip) return false;
  if (et.subcategory && row.subcategory !== et.subcategory) return false;
  if (et.profil && row.profile !== et.profil) return false;
  return true;
}

// intră un PDF în harta PDF? cuBarem = Set (ce are barem) sau null (nu se știe)
function intraPdf(row, et, cuBarem) {
  if (!et.doarCuBarem) return true;
  if (cuBarem instanceof Set) return cuBarem.has(row.id);
  return et.dacaNuStim === 'toate';
}

// ─── Capitolele unei etape (15 nov. 2026) ────────────────────────────────────
const eExamen = (cat) => cat === 'evaluare-nationala' || cat === 'bacalaureat';
const capitolAlte = (et) => ({
  id: `${et.id}:alte`, alte: true, icon: 'alte',
  titlu: et.tip === 'pdf' ? 'Alte fișe' : eExamen(et.category) ? 'Alte capitole' : 'Alte exerciții',
});
// capitolul unui material într-o etapă: { id (unic în hartă), titlu, icon, alte? }
function capitolNod(r, et) {
  const g = et.grupare || 'capitol';
  if (g === 'subiect') {
    const sb = CH.subiectDin(r.title);
    return sb ? { id: `${et.id}:s${sb}`, titlu: CH.SUBIECT_TITLU[sb], icon: `sub${sb}` } : { ...capitolAlte(et), titlu: 'Alte exerciții pe subiecte' };
  }
  if (g === 'an') {
    const an = CH.anDin(r.title, r.file_url);
    return an ? { id: `${et.id}:${an}`, titlu: `Anul ${an}`, icon: et.icon || 'varianta' } : { ...capitolAlte(et), titlu: 'Alte subiecte', icon: et.icon || 'varianta' };
  }
  if (g === 'bucati') return { id: `${et.id}:b`, titlu: '', icon: et.icon || 'test' };   // numerotat în peCapitole
  const c = CH.capitolDin(r.title, r.category || et.category);
  return c ? { id: `${et.id}:${c.id}`, titlu: c.titlu, icon: c.icon } : capitolAlte(et);
}

// pașii unei etape, așezați pe capitole: capitolele în ordinea primului lor pas din
// site (cele nerecunoscute — „Alte …" — la sfârșit), în capitol ordinea din site;
// testele interactive: câte TESTE_PE_GRUPA, în ordinea din site
function peCapitole(ale, et) {
  if ((et.grupare || 'capitol') === 'bucati') {
    return ale.map((n, k) => {
      const b = Math.floor(k / TESTE_PE_GRUPA);
      const de = b * TESTE_PE_GRUPA + 1, pana = Math.min(ale.length, de + TESTE_PE_GRUPA - 1);
      const [unu, multe] = et.bucati || ['Testul', 'Testele'];
      return { ...n, cap: `${et.id}:b${b + 1}`, capTitlu: de === pana ? `${unu} ${de}` : `${multe} ${de}–${pana}`, capIcon: n.capIcon };
    });
  }
  const grupe = new Map();
  for (const n of ale) {
    if (!grupe.has(n.cap)) grupe.set(n.cap, []);
    grupe.get(n.cap).push(n);
  }
  const chei = [...grupe.keys()];
  const ordine = [...chei.filter((k) => !grupe.get(k)[0].capAlte), ...chei.filter((k) => grupe.get(k)[0].capAlte)];
  return ordine.flatMap((k) => grupe.get(k));
}

// Pașii planului: rândurile vin deja în ordinea din site (sort_order ↑, created_at ↓);
// un material apare o singură dată, în prima etapă în care se potrivește; în etapă,
// pașii se așază pe capitole (vezi peCapitole). 26 nov. 2026: testele interactive cu PDF
// asociat (pdf_sursa_id) vin înaintea celor fără PDF, ca pe site; etapele cu ordine: 'creare'
// (variantele AI) — în ordinea în care au apărut.
const ordineEtapa = (rows, et) => {
  let lista = rows || [];
  if (et.tip === 'interactive') lista = [...lista.filter((r) => r && r.pdf_sursa_id), ...lista.filter((r) => r && !r.pdf_sursa_id)];
  if (et.ordine === 'creare') {
    lista = lista.map((r, k) => ({ r, k })).sort((a, b) => ((Date.parse(a.r.created_at || 0) || 0) - (Date.parse(b.r.created_at || 0) || 0)) || (a.k - b.k)).map((x) => x.r);
  }
  return lista;
};
function construiesteNoduri(rows, lista, { cuBarem = null } = {}) {
  const noduri = [];
  const vazute = new Set();
  for (const et of lista) {
    const ale = [];
    for (const r of ordineEtapa(rows, et)) {
      if (!r || !r.id || vazute.has(r.id) || !sePotriveste(r, et) || barem.isBaremRow(r) || !intraPdf(r, et, cuBarem)) continue;
      const cap = capitolNod(r, et);
      if (et.doarCuCapitol && cap.alte) continue;   // fișa nu e pe un capitol → nu intră aici
      vazute.add(r.id);
      ale.push({
        id: r.id, titlu: String(r.title || 'Exercițiu').slice(0, 160), tip: et.tip, harta: et.harta || (et.tip === 'pdf' ? 'pdf' : 'interactiv'),
        etapa: et.id, gratuit: !!r.is_free, creat: r.created_at || null,
        cap: cap.id, capTitlu: cap.titlu, capIcon: cap.icon, ...(cap.alte ? { capAlte: true } : {}),
      });
    }
    noduri.push(...peCapitole(ale, et));
  }
  return noduri;
}

const pctDin = (p) => (!p ? null : (Number(p.max_score) > 0 ? Math.round((Number(p.score) / Number(p.max_score)) * 100) : 0));
// rândurile vechi (înainte de salvarea parțială) au attempts = 1 implicit; salvarea
// parțială scrie explicit 0 → „neterminat"
const incercariDin = (p) => (!p ? 0 : (p.attempts == null ? 1 : Math.max(0, Math.round(Number(p.attempts) || 0))));

// Starea unui pas, din rândul lui din `progress`
function stareNod(nod, p, { sarite = new Set(), trecute = new Set() } = {}) {
  const prag = nod.tip === 'pdf' ? PRAG_PDF : PRAG_INTERACTIV;
  const pct = pctDin(p);
  const incercari = incercariDin(p);
  const trecutAcum = !!p && incercari >= 1 && pct >= prag;
  let stare = 'nou';
  if (trecutAcum || trecute.has(nod.id)) stare = 'trecut';
  else if (sarite.has(nod.id)) stare = 'sarit';
  else if (p && incercari >= 1) stare = 'incercat';
  else if (p) stare = 'inceput';
  return { stare, pct, incercari, prag, trecutAcum, la: p ? p.completed_at || null : null };
}

// Fără abonament: interactivele gratuite. Testele PDF le corectează profesorul
// virtual (Premium), deci nu opresc planul unui cont gratuit.
const accesibil = (nod, premium) => !!premium || (nod.gratuit && nod.tip === 'interactive');

// O hartă: starea fiecărui pas, pasul curent, ce e deschis (indicii `i` — în harta ei)
// `deLa` = indicele de la care pornește pasul curent (focusul ales de elev; -1 = de la început)
// 26 nov. 2026 — „testele noi o să fie adăugate constant, pune-le la sfârșitul traseului": un pas
// apărut după începutul planului elevului („nou") stă în capitolul lui pe hartă, dar pe TRASEU vine
// după toți pașii pe care elevul îi avea deja (`r` = locul pe traseu): nu mai devine pasul următor
// când apare într-o etapă parcursă, ci elevul ajunge la el după ce termină ce avea.
function calculeaza(noduri, progres, { sarite = new Set(), trecute = new Set(), premium = false, start = null, deLa = -1 } = {}) {
  const out = (noduri || []).map((n, i) => {
    const s = stareNod(n, progres.get(n.id) || null, { sarite, trecute });
    const zi = n.creat ? String(n.creat).slice(0, 10) : null;
    return { ...n, i, ...s, accesibil: accesibil(n, premium), nou: !!(start && zi && zi > start) };
  });
  const ruta = [...out.filter((n) => !n.nou), ...out.filter((n) => n.nou)];
  ruta.forEach((n, k) => { n.r = k; });
  const liber = (n) => n.accesibil && n.stare !== 'trecut' && n.stare !== 'sarit';
  let cur = null;
  if (deLa >= 0 && out[deLa]) { const r0 = out[deLa].r; cur = ruta.find((n) => n.r >= r0 && liber(n)) || null; }
  if (!cur) cur = ruta.find(liber) || null;
  const curent = cur ? cur.i : -1;
  for (const n of out) {
    // cu Premium, orice pas e deschis (15 nov. 2026: „la premium, să poată alege orice pas")
    n.deschis = n.accesibil && (premium || !cur || n.r <= cur.r || STARI_LUCRATE.includes(n.stare));
    n.poateSari = n.i === curent && n.stare === 'incercat' && n.incercari >= INCERCARI_SARIRE;
  }
  return { noduri: out, curent };
}

// indicele de pornire al focusului într-o hartă (pasul ales; altfel începutul etapei lui)
function indiceFocus(lista, focus) {
  if (!focus) return -1;
  if (focus.id) {
    const k = lista.findIndex((n) => n.id === focus.id);
    if (k >= 0) return k;
  }
  if (focus.etapa) return lista.findIndex((n) => n.etapa === focus.etapa);
  return -1;
}

// cele două hărți, fiecare calculată separat (`focus` — doar în harta lui)
function calculeazaHarti(noduri, progres, opt = {}) {
  const { focus = null, ...rest } = opt;
  const out = {};
  for (const h of HARTI) {
    const lista = (noduri || []).filter((n) => n.harta === h);
    out[h] = calculeaza(lista, progres, { ...rest, deLa: focus && focus.harta === h ? indiceFocus(lista, focus) : -1 });
  }
  return out;
}

// capitolele unei hărți, în ordinea pașilor: numărătorile, procentul, capitolul pasului
// curent, „gata" (toți pașii trecuți sau săriți, măcar unul trecut). Pașii fără capitol
// (construiți în afara construiesteNoduri) stau în capitolul etapei lor.
function capitoleHarta(noduri, curent, lista = []) {
  const titluEtapa = new Map((lista || []).map((e) => [e.id, e.titlu]));
  const out = [];
  const idx = new Map();
  for (const n of noduri) {
    const id = n.cap || n.etapa || 'x';
    if (!idx.has(id)) {
      idx.set(id, out.length);
      out.push({ id, etapa: n.etapa || null, titlu: n.capTitlu || titluEtapa.get(n.etapa) || 'Exerciții', icon: n.capIcon || 'alte', total: 0, trecute: 0, sarite: 0, incercate: 0, inchise: 0 });
    }
    const c = out[idx.get(id)];
    c.total++;
    if (n.stare === 'trecut') c.trecute++;
    else if (n.stare === 'sarit') c.sarite++;
    else if (n.stare === 'incercat' || n.stare === 'inceput') c.incercate++;
    if (!n.accesibil) c.inchise++;
  }
  const cur = curent >= 0 ? noduri[curent] : null;
  for (const c of out) {
    c.procent = c.total ? Math.round((c.trecute / c.total) * 100) : 0;
    c.gata = c.trecute > 0 && c.trecute + c.sarite >= c.total;
    c.curent = !!cur && (cur.cap || cur.etapa || 'x') === c.id;
  }
  return out;
}

// Ce primește pagina pentru o hartă: etapele cu numărătorile lor, capitolele, pașii (compacți), pasul curent
function vedereHarta({ noduri, curent }, lista, { premium = false } = {}) {
  const idxEtapa = new Map(lista.map((e, k) => [e.id, k]));
  const capitole = capitoleHarta(noduri, curent, lista);
  const idxCap = new Map(capitole.map((c, k) => [c.id, k]));
  const etapeOut = lista.map((e) => {
    const ale = noduri.filter((n) => n.etapa === e.id);
    return {
      id: e.id, titlu: e.titlu, tip: e.tip, total: ale.length,
      trecute: ale.filter((n) => n.stare === 'trecut').length,
      sarite: ale.filter((n) => n.stare === 'sarit').length,
      incercate: ale.filter((n) => n.stare === 'incercat' || n.stare === 'inceput').length,
      inchise: ale.filter((n) => !n.accesibil).length,
      curenta: curent >= 0 && noduri[curent].etapa === e.id,
    };
  }).filter((e) => e.total > 0);
  const total = noduri.length;
  const trecute = noduri.filter((n) => n.stare === 'trecut').length;
  const sarite = noduri.filter((n) => n.stare === 'sarit').length;
  const accesibile = noduri.filter((n) => n.accesibil);
  const c = curent >= 0 ? noduri[curent] : null;
  const capDe = (n) => n.cap || n.etapa || 'x';
  const capC = c ? capitole[idxCap.get(capDe(c))] : null;
  return {
    etape: etapeOut,
    capitole,
    noduri: noduri.map((n) => ({
      id: n.id, titlu: n.titlu, tip: n.tip, etapa: n.etapa, e: idxEtapa.get(n.etapa),
      cap: capDe(n), k: idxCap.get(capDe(n)),
      stare: n.stare, pct: n.pct, incercari: n.incercari, gratuit: n.gratuit,
      accesibil: n.accesibil, deschis: n.deschis, nou: n.nou, poateSari: n.poateSari,
    })),
    curent,
    pas: c ? {
      id: c.id, titlu: c.titlu, tip: c.tip, harta: c.harta, etapa: c.etapa, nr: c.i + 1, stare: c.stare, pct: c.pct,
      incercari: c.incercari, prag: c.prag, poateSari: c.poateSari, nou: c.nou,
      incercariRamase: Math.max(0, INCERCARI_SARIRE - c.incercari),
      capitol: capC ? { id: capC.id, titlu: capC.titlu, icon: capC.icon, total: capC.total, trecute: capC.trecute } : null,
    } : null,
    total, trecute, sarite,
    neterminate: noduri.filter((n) => n.stare === 'inceput').length,
    procent: total ? Math.round((trecute / total) * 100) : 0,
    // tot ce poate face elevul pe harta asta e gata (cu Premium: toată harta)
    terminat: total > 0 && curent < 0 && accesibile.length > 0,
    ramasePremium: premium ? 0 : noduri.filter((n) => !n.accesibil && n.stare !== 'trecut').length,
  };
}

// adresa unui pas: vizualizatorul obișnuit, cu insigna „🗺️ Harta pregătirii"; la PDF,
// modul în care elevul trimite rezolvarea (pdf · chat · foaie · poza)
function urlPas(nod, { mod = null } = {}) {
  if (!nod || !nod.id) return null;
  const id = encodeURIComponent(nod.id);
  if (nod.tip === 'pdf') return `/pdf-viewer?id=${id}&pregatire=1&plan=1${mod ? `&mod=${encodeURIComponent(mod)}` : ''}`;
  return `/exercitiu?id=${id}&pregatire=1&plan=1`;
}
function cuAdrese(pas) {
  if (!pas) return null;
  const p = { ...pas, url: urlPas(pas) };
  if (pas.tip === 'pdf') p.moduri = ['pdf', 'chat', 'foaie', 'poza'].map((m) => ({ mod: m, url: urlPas(pas, { mod: m }) }));
  return p;
}

const REGULI = () => ({ pragInteractiv: PRAG_INTERACTIV, pragPdf: PRAG_PDF, incercariSarire: INCERCARI_SARIRE });

// Ce primește pagina: cele două hărți + pasul zilei (din harta interactivă; când e gata, din
// cea PDF) — sau din harta aleasă de elev („ce lucrezi acum", `focus`), cât are pași de lucrat
function vedere(harti, lista, { tinta = null, coloana = true, premium = false, focus = null } = {}) {
  const v = {};
  for (const h of HARTI) {
    v[h] = vedereHarta(harti[h], lista.filter((e) => (e.harta || (e.tip === 'pdf' ? 'pdf' : 'interactiv')) === h), { premium });
    v[h].pas = cuAdrese(v[h].pas);
  }
  const total = v.interactiv.total + v.pdf.total;
  const peFocus = focus && v[focus.harta] && v[focus.harta].pas ? v[focus.harta].pas : null;
  return {
    activ: true,
    coloana,
    tinta: tinta ? { id: tinta.id || null, label: tinta.label || null, tip: tinta.tip } : null,
    interactiv: v.interactiv,
    pdf: v.pdf,
    pas: peFocus || v.interactiv.pas || v.pdf.pas || null,
    // ce a ales elevul să lucreze acum (null = în ordine); `activ` — harta aleasă mai are pași
    focus: focus ? { harta: focus.harta, etapa: focus.etapa || null, id: focus.id || null, activ: !!peFocus } : null,
    premium: !!premium,
    total,
    trecute: v.interactiv.trecute + v.pdf.trecute,
    terminat: total > 0 && !v.interactiv.pas && !v.pdf.pas && (v.interactiv.terminat || v.pdf.terminat),
    reguli: REGULI(),
  };
}

// Rezumatul pentru profesori și părinți (în „Rezultate"): fără lista pașilor
function rezumatHarta(h) {
  if (!h) return null;
  return {
    total: h.total, trecute: h.trecute, sarite: h.sarite, neterminate: h.neterminate, procent: h.procent,
    terminat: h.terminat, ramasePremium: h.ramasePremium,
    pas: h.pas ? { nr: h.pas.nr, titlu: h.pas.titlu, stare: h.pas.stare, incercari: h.pas.incercari, pct: h.pas.pct, capitol: h.pas.capitol ? h.pas.capitol.titlu : null } : null,
    etape: (h.etape || []).map((e) => ({ titlu: e.titlu, total: e.total, trecute: e.trecute })),
    // capitolele (15 nov. 2026): pictograma, câți pași, câți trecuți — fără pașii lor
    capitole: (h.capitole || []).map((c) => ({ titlu: c.titlu, icon: c.icon, etapa: c.etapa, total: c.total, trecute: c.trecute, sarite: c.sarite, gata: c.gata, curent: c.curent })),
  };
}
function rezumat(v) {
  if (!v) return null;
  return { tinta: v.tinta, interactiv: rezumatHarta(v.interactiv), pdf: rezumatHarta(v.pdf), reguli: v.reguli };
}

// ─── prep_plan (jsonb în user_stats) ─────────────────────────────────────────
function citestePlan(stats) {
  let raw = stats ? stats.prep_plan : null;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const o = raw && typeof raw === 'object' ? raw : {};
  const lista = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(-MAX_LISTA) : []);
  return {
    coloana: !!stats && Object.prototype.hasOwnProperty.call(stats, 'prep_plan'),
    start: typeof o.start === 'string' && /^\d{4}-\d\d-\d\d$/.test(o.start) ? o.start : null,
    tinta: typeof o.tinta === 'string' ? o.tinta : null,
    sarite: new Set(lista(o.sarite)),
    trecute: new Set(lista(o.trecute)),
    focus: focusValid(o.focus),
  };
}
// { harta, id?, etapa? } | null
function focusValid(f) {
  if (!f || typeof f !== 'object' || !HARTI.includes(f.harta)) return null;
  const sir = (x) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 120) : null);
  return { harta: f.harta, id: sir(f.id), etapa: sir(f.etapa) };
}

const deScris = (plan) => ({
  v: 1, start: plan.start || null, tinta: plan.tinta || null,
  sarite: [...plan.sarite].slice(-MAX_LISTA), trecute: [...plan.trecute].slice(-MAX_LISTA),
  ...(plan.focus ? { focus: plan.focus } : {}),
});

async function scriePlan(supa, userId, plan) {
  try {
    const { error } = await supa.from('user_stats')
      .update({ prep_plan: deScris(plan), updated_at: new Date().toISOString() }).eq('user_id', userId);
    return !error;
  } catch { return false; }
}

// ─── Cu baza de date ────────────────────────────────────────────────────────
async function continut(supa, tinta) {
  const cats = categorii(tinta);
  if (!cats.length) return [];
  return http.allRows((from, to) => supa.from('content')
    .select('id, title, category, subcategory, profile, is_free, content_type, file_url, sort_order, created_at, pdf_sursa_id')
    .in('category', cats).in('content_type', ['interactive', 'pdf'])
    .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
    .range(from, to), { pageSize: 1000, maxPages: 6 });
}

// PDF-urile (dintre `rows`) care au barem legat → Set; null = nu se știe nimic (tabelele lipsă)
async function bareme(supa, rows) {
  const pdfs = (rows || []).filter((r) => r && r.id && tipul(r) === 'pdf' && !barem.isBaremRow(r));
  if (!pdfs.length) return new Set();
  const ids = pdfs.map((r) => r.id);
  const fisier = new Map(pdfs.map((r) => [r.id, r.file_url || null]));
  const randul = new Map(pdfs.map((r) => [r.id, r]));
  const ok = new Set();
  let stiut = false;
  try {   // potrivirea site-ului (Profesorul Virtual, corectarea) și baremul ales de admin
    const site = await http.inBatches(ids, (chunk, from, to) => supa.from('ai_pdf_text')
      .select('content_id, file_url, barem_status, barem_id, barem_override_id, barem').in('content_id', chunk).range(from, to));
    stiut = true;
    for (const d of site) {
      if (!d || !d.content_id) continue;
      if (d.barem_override_id) { ok.add(d.content_id); continue; }
      const f = fisier.get(d.content_id);
      // la fișe, doar potrivirea după titlu (15 nov. 2026 — barem.baremCacheValid)
      if (BAREM_SITE_OK.has(d.barem_status) && (d.barem_id || d.barem_status === 'inclus') && (!d.file_url || !f || d.file_url === f)
        && barem.baremCacheValid(randul.get(d.content_id), d)) ok.add(d.content_id);
    }
  } catch { /* cache-ul PDF lipsește */ }
  try {   // legăturile botului de examene (EN / BAC)
    const bot = await http.inBatches(ids, (chunk, from, to) => supa.from('exam_bot_index')
      .select('content_id, barem_status, barem_id').in('content_id', chunk).range(from, to));
    stiut = true;
    for (const d of bot) if (d && d.content_id && BAREM_BOT_OK.has(d.barem_status) && (d.barem_id || d.barem_status === 'inclus')) ok.add(d.content_id);
  } catch { /* botul nu e instalat */ }
  return stiut ? ok : null;
}

// conținutul unei ținte, gata de construit hărți: { lista, rows, cuBarem }
async function sursa(supa, tinta) {
  const lista = etape(tinta);
  if (!lista.length) return null;
  const rows = await continut(supa, tinta);
  const cuBarem = lista.some((e) => e.doarCuBarem) ? await bareme(supa, rows.filter((r) => lista.some((e) => e.doarCuBarem && sePotriveste(r, e)))) : null;
  return { lista, rows, cuBarem };
}

async function progres(supa, userId, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await http.inBatches(ids, (chunk, from, to) => supa.from('progress')
    .select('content_id, score, max_score, attempts, completed_at').eq('user_id', userId).in('content_id', chunk).range(from, to));
  for (const p of rows) if (p && p.content_id) out.set(p.content_id, p);
  return out;
}

// Hărțile unui elev. `stats` = rândul din user_stats (cu prep_plan, dacă există).
async function calculeazaPentru(supa, userId, { tinta, stats, premium = false }) {
  const s = await sursa(supa, tinta);
  if (!s) return null;
  const noduri = construiesteNoduri(s.rows, s.lista, { cuBarem: s.cuBarem });
  const prog = await progres(supa, userId, noduri.map((n) => n.id));
  const plan = citestePlan(stats);
  // la o țintă nouă, focusul vechi nu mai contează
  if (plan.focus && plan.tinta !== (tinta && tinta.id ? tinta.id : null)) plan.focus = null;
  // harta PDF fără abonament: focusul nu are ce alege (corectarea e Premium)
  if (plan.focus && plan.focus.harta === 'pdf' && !premium) plan.focus = null;
  const harti = calculeazaHarti(noduri, prog, { sarite: plan.sarite, trecute: plan.trecute, premium, start: plan.start, focus: plan.focus });
  return { lista: s.lista, noduri, prog, plan, harti };
}

async function stare(supa, userId, { tinta, stats, premium = false, azi = null } = {}) {
  try {
    const x = await calculeazaPentru(supa, userId, { tinta, stats, premium });
    if (!x) return null;
    const { lista, plan, harti } = x;
    // pașii trecuți acum rămân trecuți pe hartă; începutul planului (pentru „nou")
    const noi = HARTI.flatMap((h) => harti[h].noduri.filter((n) => n.trecutAcum && !plan.trecute.has(n.id)).map((n) => n.id));
    const tid = tinta && tinta.id ? tinta.id : null;
    const tintaNoua = plan.tinta !== tid;
    if (plan.coloana && (noi.length || !plan.start || tintaNoua)) {
      for (const id of noi) plan.trecute.add(id);
      // planul începe azi (sau din nou, la altă țintă): „nou" = adăugat în site după ziua asta
      if (!plan.start || tintaNoua) plan.start = azi || new Date().toISOString().slice(0, 10);
      if (tintaNoua) plan.focus = null;   // alegerea „ce lucrezi acum" ține de țintă
      plan.tinta = tid;
      await scriePlan(supa, userId, plan);
    }
    return vedere(harti, lista, { tinta, coloana: plan.coloana, premium, focus: plan.focus });
  } catch (e) {
    console.warn('plan.stare:', e?.message || e);
    return null;
  }
}

// „⏭ Treci mai departe": doar pe pasul curent al hărții lui, după INCERCARI_SARIRE încercări
async function sari(supa, userId, { contentId, tinta, stats, premium = false } = {}) {
  const id = String(contentId || '');
  if (!id) return { error: 'Lipsește pasul.' };
  const plan0 = citestePlan(stats);
  if (!plan0.coloana) return { error: 'Trecerea peste un pas nu e activă încă (Admin: rulează supabase/plan_pregatire.sql).', setup: false };
  const x = await calculeazaPentru(supa, userId, { tinta, stats, premium });
  if (!x) return { error: 'Alege întâi examenul sau clasa.' };
  const { plan, harti } = x;
  const h = HARTI.find((k) => harti[k].noduri.some((n) => n.id === id));
  if (!h) return { error: 'Pasul nu mai e în planul tău.' };
  const r = harti[h];
  const nod = r.noduri.find((n) => n.id === id);
  if (nod.stare === 'trecut') return { error: 'Pasul e deja trecut.' };
  if (r.curent < 0 || nod.i !== r.curent) return { error: 'Poți trece mai departe doar de la pasul la care ai ajuns.' };
  if (nod.incercari < INCERCARI_SARIRE) {
    const rest = INCERCARI_SARIRE - nod.incercari;
    return { error: `Mai încearcă: treci mai departe după ${INCERCARI_SARIRE} încercări (mai ai ${rest === 1 ? 'una' : rest}).`, incercari: nod.incercari };
  }
  plan.sarite.add(id);
  if (!(await scriePlan(supa, userId, plan))) return { error: 'Nu am putut salva. Încearcă din nou.' };
  return { ok: true };
}

// „Ce lucrezi acum?" (15 nov. 2026, seara): de unde pornește pasul curent — și pasul zilei.
//   { harta: null }                       → în ordine (fără focus)
//   { harta: 'interactiv', etapa: 'teste' } → de la începutul unei etape (oricine)
//   { harta: 'pdf' }                       → harta subiectelor PDF (cu Premium)
//   { harta, id }                          → de la un pas anume (doar cu Premium)
async function alegeFocus(supa, userId, { tinta, stats, premium = false, harta = null, id = null, etapa = null } = {}) {
  const plan0 = citestePlan(stats);
  if (!plan0.coloana) return { error: 'Alegerea nu se poate salva încă (Admin: rulează supabase/plan_pregatire.sql).', setup: false };
  const x = await calculeazaPentru(supa, userId, { tinta, stats, premium });
  if (!x) return { error: 'Alege întâi examenul sau clasa.' };
  const { plan, noduri } = x;
  plan.tinta = tinta && tinta.id ? tinta.id : plan.tinta;
  if (!harta) {
    plan.focus = null;
  } else {
    if (!HARTI.includes(harta)) return { error: 'Hartă necunoscută.' };
    if (harta === 'pdf' && !premium) return { error: 'Subiectele PDF se deschid cu Premium: profesorul virtual le corectează după barem.', premium: false };
    const ale = noduri.filter((n) => n.harta === harta);
    if (!ale.length) return { error: 'Harta aleasă nu are încă pași.' };
    let nod = null;
    if (id) {
      if (!premium) return { error: 'Cu Premium poți porni de la orice pas. Fără abonament, alegi o etapă: de exemplu testele interactive.', premium: false };
      nod = ale.find((n) => n.id === String(id)) || null;
      if (!nod) return { error: 'Pasul nu mai e în planul tău.' };
    } else if (etapa) {
      nod = ale.find((n) => n.etapa === String(etapa)) || null;
      if (!nod) return { error: 'Etapa aleasă nu are pași.' };
    }
    plan.focus = { harta, id: nod ? nod.id : null, etapa: nod ? nod.etapa : null };
  }
  if (!(await scriePlan(supa, userId, plan))) return { error: 'Nu am putut salva alegerea. Încearcă din nou.' };
  return { ok: true, focus: plan.focus };
}

// Progresul din hartă al mai multor elevi, pentru „Rezultate" (profesori și părinți).
// elevi: [{ id, premium }]; stari: Map(id → rândul din user_stats); progRows: rândurile lor
// din `progress` (deja citite de api/teacher-students.js). Conținutul și baremele se
// citesc o singură dată pentru fiecare țintă. → Map(id → rezumat)
async function rezumateElevi(supa, elevi, { stari = new Map(), progRows = [], tintaInfo = () => null } = {}) {
  const out = new Map();
  const peTinta = new Map();
  for (const e of elevi || []) {
    const st = stari.get(e.id);
    const t = st ? tintaInfo(st.prep_exam) : null;
    if (!t) continue;
    if (!peTinta.has(t.id)) peTinta.set(t.id, { tinta: t, elevi: [] });
    peTinta.get(t.id).elevi.push(e);
  }
  const progPeElev = new Map();
  for (const p of progRows || []) {
    if (!p || !p.user_id || !p.content_id) continue;
    if (!progPeElev.has(p.user_id)) progPeElev.set(p.user_id, new Map());
    const m = progPeElev.get(p.user_id);
    const vechi = m.get(p.content_id);
    if (!vechi || String(p.completed_at || '') > String(vechi.completed_at || '')) m.set(p.content_id, p);
  }
  for (const { tinta, elevi: lista } of peTinta.values()) {
    let s = null;
    try { s = await sursa(supa, tinta); } catch (e) { console.warn('plan.rezumateElevi:', e?.message || e); }
    if (!s) continue;
    const noduri = construiesteNoduri(s.rows, s.lista, { cuBarem: s.cuBarem });
    for (const e of lista) {
      const plan = citestePlan(stari.get(e.id));
      const focus = plan.focus && plan.tinta === tinta.id && (plan.focus.harta !== 'pdf' || e.premium) ? plan.focus : null;
      const harti = calculeazaHarti(noduri, progPeElev.get(e.id) || new Map(), { sarite: plan.sarite, trecute: plan.trecute, premium: !!e.premium, start: plan.start, focus });
      out.set(e.id, rezumat(vedere(harti, s.lista, { tinta, coloana: plan.coloana, premium: !!e.premium, focus })));
    }
  }
  return out;
}

module.exports = {
  PRAG_INTERACTIV, PRAG_PDF, INCERCARI_SARIRE, ROMAN, CLASE, HARTI, TESTE_PE_GRUPA, numeClasa,
  // pure
  etape, categorii, sePotriveste, intraPdf, capitolNod, peCapitole, construiesteNoduri, stareNod, accesibil, calculeaza, calculeazaHarti,
  capitoleHarta, vedereHarta, vedere, urlPas, rezumat, citestePlan, deScris, focusValid, indiceFocus, pctDin, incercariDin,
  // cu baza de date
  continut, bareme, progres, stare, sari, alegeFocus, scriePlan, rezumateElevi,
};
