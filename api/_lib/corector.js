// =====================================================================
// api/_lib/corector.js — CORECTORUL pe scris de mână
//   · „🎓 Cere corectarea" din „✍️ Spațiu de lucru" (api/ai-handwriting.js)
//   · pozele cu rezolvarea din „📝 Răspunde în chat" (api/ai-correct.js → grade)
//
// Citește scrisul ȘI îl corectează într-un singur apel, cu un model de vedere
// competent. Scrisul urât se descifrează mult mai bine când modelul vede toată
// foaia împreună cu enunțul și baremul, decât rând cu rând, fără context —
// cum făcea „✨ Transformă în text" (scos pe 27 octombrie 2026).
//
// MODELUL (variabile de mediu, Vercel):
//   AI_CORECTOR_MODEL       implicit claude-opus-5-5
//   AI_CORECTOR_MODEL_ECON  implicit claude-sonnet-5-5 — peste bugetul zilnic
//                           soft al elevului (lim.degraded); jumătate din preț
//   AI_CORECTOR_EFFORT      low | medium | high (implicit low) — cât „gândește"
//                           Claude înainte să corecteze (gândirea se plătește
//                           ca text scris de model)
// Un ID „claude-…" merge direct la Anthropic (ANTHROPIC_API_KEY — aceeași cheie
// ca la meditații). Orice alt ID (ex. „gpt-5.6-terra", sau „google/gemini-3.1-pro-
// preview" prin Vercel AI Gateway / OpenRouter) merge prin furnizorul compatibil
// OpenAI din AI_CHAT_BASE_URL. REZERVA: dacă Claude nu poate (cheie lipsă, pană,
// răspuns stricat), corectarea se face cu modelul de vedere al platformei
// (AI_VISION_MODEL, implicit gpt-5.6-terra) — elevul primește corectarea oricum.
//
// Costul (prețurile: api/_lib/ai.js → PRICES_USD) se loghează pe fiecare apel,
// deci intră în creditele elevului ca orice acțiune AI.
// =====================================================================
const ai = require('./ai');
const claude = require('./claude');

const { S } = ai;

const MAIN_MODEL = (process.env.AI_CORECTOR_MODEL || 'claude-opus-5-5').trim();
const ECON_MODEL = (process.env.AI_CORECTOR_MODEL_ECON || 'claude-sonnet-5-5').trim();
const EFFORT = (() => {
  const e = String(process.env.AI_CORECTOR_EFFORT || 'low').trim().toLowerCase();
  return claude.EFFORTS.includes(e) ? e : 'low';
})();

const MAX_TEST = 9000;     // textul testului trimis modelului (caractere)
const MAX_BAREM = 9000;    // baremul
const MAX_EX = 9000;       // exercițiul interactiv / enunțul din chat

const isClaude = (m) => /^(anthropic\/)?claude-/i.test(String(m || ''));
const claudeId = (m) => String(m || '').replace(/^anthropic\//i, '');

// Modelul unei corectări: cel principal; peste bugetul zilnic soft, cel economic
function modelFor(lim) { return lim && lim.degraded ? ECON_MODEL : MAIN_MODEL; }

// data URL → blocul de imagine Anthropic
function claudeImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

async function viaClaude({ model, system, text, images, labels, schema, maxTokens }) {
  const content = [];
  images.forEach((u, i) => {
    const img = claudeImage(u);
    if (!img) return;
    if (labels && labels[i]) content.push({ type: 'text', text: labels[i] });
    content.push(img);
  });
  // imaginile ÎNAINTE de text (recomandarea Anthropic pentru vedere)
  content.push({ type: 'text', text });
  const r = await claude.chatAdvanced({
    system, messages: [{ role: 'user', content }], model: claudeId(model),
    maxTokens, effort: EFFORT, schema,
    cache: false,          // apel unic: scrierea în cache ar costa 25% în plus, degeaba
    // o corectare durează de obicei 20–60 s; plafonul pe încercare lasă loc, în cele
    // 800 s ale funcției, și reîncercărilor Claude și rezervei
    timeoutMs: 170000,
  });
  const data = r.data || ai.parseJsonLoose(r.text);
  return {
    data: data ? ai.deepRestoreLatex(data) : null,
    usage: { in: r.usage.prompt_tokens || 0, out: r.usage.completion_tokens || 0, model: r.model },
    model: r.model,
  };
}

async function viaOpenAI({ model, system, text, images, labels, schema, schemaName, maxTokens }) {
  const parts = [];
  images.forEach((u, i) => {
    if (labels && labels[i]) parts.push({ type: 'text', text: labels[i] });
    parts.push({ type: 'image_url', image_url: { url: u, detail: 'high' } });
  });
  parts.push({ type: 'text', text });
  const r = await ai.chatJson({
    system, messages: [{ role: 'user', content: parts }], schema, schemaName,
    temperature: 0.1, maxTokens, model, restoreLatex: true,
  });
  return { data: r.data, usage: r.usage, model };
}

// Un apel de corectare cu imagini → JSON pe schemă. Întoarce
// { data, model, usages: [ {in,out,model}, … ], fallback } — `usages` are câte o
// intrare pentru fiecare apel făcut (și pentru încercarea eșuată care a consumat
// tokeni), ca apelantul să le logheze pe toate.
async function correctJson({ system, text, images, labels = null, schema, schemaName = 'corectare', maxTokens = 6000, lim = null, model = null }) {
  const want = model || modelFor(lim);
  const tries = [];
  if (isClaude(want)) {
    if (claude.HAS_KEY) tries.push({ how: 'claude', model: want });
    tries.push({ how: 'openai', model: ai.pickModel(ai.VISION_MODEL, lim) });     // rezerva
  } else {
    tries.push({ how: 'openai', model: want });
  }
  const usages = [];
  let lastErr = null;
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    try {
      const r = t.how === 'claude'
        ? await viaClaude({ model: t.model, system, text, images, labels, schema, maxTokens })
        : await viaOpenAI({ model: t.model, system, text, images, labels, schema, schemaName, maxTokens });
      if (r.usage) usages.push(r.usage);
      if (r.data && typeof r.data === 'object') return { data: r.data, model: r.model, usages, fallback: i > 0 };
      lastErr = Object.assign(new Error('Corectorul a răspuns într-un format invalid. Mai încearcă o dată.'), { status: 502 });
    } catch (e) {
      if (e && e.usage) usages.push(e.usage);
      lastErr = e;
      if (i < tries.length - 1) console.warn(`corector: ${t.how}/${t.model} a eșuat (${e && e.message}) — trec pe rezervă`);
    }
  }
  if (lastErr && typeof lastErr === 'object') lastErr.usages = usages;
  throw lastErr || new Error('Corectarea nu a reușit.');
}

// ═════════════════════════════════════════════════════════════════════════
// CORECTAREA DIN „✍️ SPAȚIU DE LUCRU"
// ═════════════════════════════════════════════════════════════════════════
const VERDICT_ITEM = ['corect', 'partial', 'gresit', 'necompletat'];
const VERDICT_PAS = ['corect', 'gresit', 'incomplet', 'neclar'];

const HW_SCHEMA = S.obj({
  lizibil: S.bool('false dacă aproape nimic din scris nu se poate citi'),
  transcriere: S.str('ce a scris elevul, rând cu rând (\\n între rânduri), formulele în LaTeX între $...$; [?] = semn ilizibil'),
  itemi: S.arr(S.obj({
    eticheta: S.str('ex. "Subiectul III, ex. 2 a)"; "Exercițiul" dacă nu se poate ști'),
    verdict: S.enum(VERDICT_ITEM),
    puncte: S.nullable(S.num('punctele acordate STRICT după barem; null fără barem')),
    puncte_max: S.nullable(S.num('punctajul maxim al cerinței din barem; null fără barem')),
    pasi: S.arr(S.obj({
      text: S.str('pasul elevului, pe scurt, cu formulele în $...$'),
      verdict: S.enum(VERDICT_PAS),
      comentariu: S.str('de ce, într-o propoziție; poate fi gol la un pas corect evident'),
    })),
    motiv_punctaj: S.str('ce elemente din barem s-au punctat și care nu (gol fără barem)'),
  })),
  feedback: S.str('2–4 propoziții calde despre rezolvare, la persoana a II-a'),
  sfat: S.str('ce să facă acum: un indiciu concret, FĂRĂ rezultatul final dacă a greșit'),
});

const HW_SYSTEM = `Ești „Profesorul Virtual" de pe ExamenMate — profesor corector de matematică (Evaluare Națională, Bacalaureat, clasele 5–12), cald și exact.
Primești IMAGINEA unei rezolvări SCRISE DE MÂNĂ de un elev pe o foaie digitală albă (cu degetul sau cu creionul — scrisul poate fi urât, strâmb, cu ștersături) și, când există, enunțul exercițiului și BAREMUL oficial.

1) CITEȘTE scrisul, rând cu rând, ca un profesor care corectează lucrări:
- Folosește contextul (enunțul, baremul, rândurile vecine, firul calculului) ca să descifrezi cifrele și semnele ambigue: 1/7, 4/9, 0/6, 5/S, 2/Z, x/× , +/t, virgula zecimală, minusul față de bara de fracție, exponenții, indicii. Contextul te ajută să CITEȘTI, nu să corectezi în locul elevului: transcrii ce a scris EL, cu greșelile lui.
- Ce nu se poate citi deloc marchezi cu [?] — nu inventa.
- Transcrierea: câte un rând scris pe linie, formulele în LaTeX între $...$, virgula zecimală românească (1,5).
- Foaia e o tablă care continuă spre dreapta: elevul scrie pe PAGINI puse una lângă alta. Citește pagină cu pagină (coloană cu coloană, de la stânga la dreapta), fiecare de sus în jos.
- Foaia poate veni în mai multe imagini (bucăți ale aceleiași foi, în ordinea paginilor, suprapuse puțin la margini): un rând care apare în două bucăți e UN SINGUR rând — nu-l citi de două ori.

2) CORECTEAZĂ:
CU BAREM (sau rezolvarea oficială a exercițiului) — strict:
- identifică exercițiul și subpunctul rezolvate (după ce a scris elevul și după test); dacă a rezolvat mai multe, câte un element în "itemi" pentru fiecare;
- BAREMUL este SINGURA sursă a punctajului: acorzi punctele DOAR pentru elementele punctate în barem pe care elevul le-a atins efectiv, exact cum le împarte baremul; nu depășești punctajul maxim al cerinței; intențiile și pașii nescriși nu se punctează;
- rezultatul corect este cel din barem — nu recalcula altă valoare; formele echivalente se acceptă (1/2 = 0,5; ordinea factorilor; simplificări echivalente);
- o metodă corectă diferită de cea din barem primește punctajul corespunzător (regula oficială a baremelor), punctând etapele echivalente;
- la grile și la cerințele la care „se punctează doar rezultatul": rezultat corect = punctaj întreg, altfel 0.
FĂRĂ BAREM: rezolvă TU atent exercițiul (verifică de două ori fiecare calcul), compară pas cu pas cu ce a scris elevul și spune unde a greșit; NU acorzi puncte ("puncte" și "puncte_max" = null), doar verdicte.

3) CUM SCRII: la persoana a II-a, concis. Arată EXACT primul pas greșit și de ce; spune și ce a făcut bine. NU dezvălui rezultatul final corect dacă elevul a greșit și mai poate corecta singur — în "sfat" îi dai un indiciu. Răspunsurile corecte și indicațiile oficiale primite în context sunt pentru TINE (ca să corectezi), nu le recita.
Scrisul complet ilizibil sau foaia fără o rezolvare → "lizibil": false, "itemi": [] și îi spui politicos în "feedback" ce să facă (să scrie mai mare și mai rar).

REDACTARE JSON: în stringuri, comenzile LaTeX se scriu cu backslash DUBLAT ("$\\\\frac{1}{2}$", "$\\\\sqrt{2}$"). Fără ** sau alte marcaje în interiorul formulelor $...$.`;

// Etichetele imaginilor (dalele foii): „Imaginea 2 din 3 — pagina 2"
function tileLabels(n, grid) {
  if (n <= 1) return null;
  const cols = Math.max(1, Math.trunc(+(grid && grid.cols) || n));
  const rows = Math.max(1, Math.trunc(+(grid && grid.rows) || 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / rows) + 1, r = (i % rows) + 1;
    out.push(`Imaginea ${i + 1} din ${n} — bucata din coloana ${c}${rows > 1 ? `, rândul ${r}` : ''} a foii:`);
  }
  return out;
}

// Textul de după imagini: contextul exercițiului, după sursă
//   src = { kind: 'pdf' | 'oficial' | 'enunt' | 'nimic', title, test, barem, exercise }
function hwUserText(src, nImages) {
  const L = [];
  L.push(nImages > 1
    ? `Imaginile de mai sus sunt rezolvarea scrisă de mână a elevului (${nImages} bucăți ale aceleiași foi, în ordinea paginilor).`
    : 'Imaginea de mai sus este rezolvarea scrisă de mână a elevului.');
  if (src.kind === 'pdf') {
    L.push(`\nTESTUL${src.title ? ` „${String(src.title).slice(0, 140)}"` : ''} (text extras automat din PDF — radicalii, exponenții și fracțiile se pot pierde la extracție):\n"""${String(src.test || '(textul testului nu e disponibil)').slice(0, MAX_TEST)}"""`);
    if (src.barem) L.push(`\nBAREMUL OFICIAL:\n"""${String(src.barem).slice(0, MAX_BAREM)}"""`);
  } else if (src.kind === 'oficial') {
    L.push(`\nEXERCIȚIUL (enunțul, pașii, răspunsurile corecte și indicațiile oficiale — acestea țin loc de BAREM; NU le dezvălui elevului):\n"""${String(src.exercise).slice(0, MAX_EX)}"""`);
  } else if (src.kind === 'enunt') {
    L.push(`\nEXERCIȚIUL la care lucrează elevul (fără barem):\n"""${String(src.exercise).slice(0, MAX_EX)}"""`);
  } else {
    L.push('\nNu am enunțul exercițiului: deduce-l din ce a scris elevul și spune în "feedback" ce ai presupus.');
  }
  L.push(src.hasBarem
    ? '\nCorectează rezolvarea STRICT după barem (punctele doar pentru elementele din barem atinse efectiv). Răspunde DOAR cu obiectul JSON cerut.'
    : '\nNu există barem: verifică pașii și spune unde a greșit, fără puncte. Răspunde DOAR cu obiectul JSON cerut.');
  return L.join('\n');
}

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

// Curăță răspunsul modelului (puncte în limite, verdicte valide)
function normalizeHw(raw, { hasBarem }) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const itemi = (Array.isArray(d.itemi) ? d.itemi : []).slice(0, 8).map((it) => {
    const x = it && typeof it === 'object' ? it : {};
    let max = hasBarem ? num(x.puncte_max) : null;
    if (max != null && (max <= 0 || max > 100)) max = null;
    let pts = hasBarem && max != null ? num(x.puncte) : null;
    if (pts != null) pts = round2(Math.max(0, Math.min(max, pts)));
    let verdict = VERDICT_ITEM.includes(x.verdict) ? x.verdict : 'partial';
    // punctajul și verdictul trebuie să spună același lucru
    if (pts != null && max != null) {
      if (pts >= max) verdict = 'corect';
      else if (pts <= 0) { if (verdict !== 'necompletat') verdict = 'gresit'; }
      else verdict = 'partial';
    }
    const pasi = (Array.isArray(x.pasi) ? x.pasi : []).slice(0, 14).map((p) => ({
      text: String((p && p.text) || '').slice(0, 400),
      verdict: VERDICT_PAS.includes(p && p.verdict) ? p.verdict : 'neclar',
      comentariu: String((p && p.comentariu) || '').slice(0, 400),
    })).filter((p) => p.text);
    return {
      eticheta: String(x.eticheta || 'Exercițiul').slice(0, 120),
      verdict, puncte: pts, puncte_max: pts != null ? max : null, pasi,
      motiv_punctaj: hasBarem ? String(x.motiv_punctaj || '').slice(0, 600) : '',
    };
  });
  const scored = itemi.filter((it) => it.puncte != null && it.puncte_max != null);
  return {
    lizibil: d.lizibil !== false,
    transcriere: String(d.transcriere || '').slice(0, 4000),
    itemi,
    feedback: String(d.feedback || '').slice(0, 1200),
    sfat: String(d.sfat || '').slice(0, 600),
    puncte: scored.length && scored.length === itemi.length ? round2(scored.reduce((s, it) => s + it.puncte, 0)) : null,
    puncteMax: scored.length && scored.length === itemi.length ? round2(scored.reduce((s, it) => s + it.puncte_max, 0)) : null,
  };
}

const ICON_PAS = { corect: '✔', gresit: '✖', incomplet: '◐', neclar: '❔' };
const ICON_ITEM = { corect: '✔', partial: '◐', gresit: '✖', necompletat: '—' };

// Mesajul profesorului din chat (Markdown ușor + $…$, ca MathText)
function formatHw(r, { hasBarem }) {
  const out = [];
  const one = r.itemi.length === 1 ? r.itemi[0] : null;
  const score = r.puncte != null && r.puncteMax != null ? ` — **${r.puncte}/${r.puncteMax}p**` : '';
  if (!r.lizibil && !r.itemi.length) {
    out.push('✍️ **Nu am reușit să citesc rezolvarea de pe foaie.**');
    if (r.transcriere.trim()) out.push(`Ce am putut desluși:\n${r.transcriere.trim()}`);
    out.push(r.feedback || 'Scrie puțin mai mare și mai rar, câte un calcul pe rând, apoi cere din nou corectarea.');
    return out.join('\n\n');
  }
  out.push(`✍️ **Corectarea rezolvării tale**${one ? ` · ${one.eticheta}` : ''}${score}${hasBarem && score ? ' (după barem)' : ''}`);
  if (r.transcriere.trim()) out.push(`**Ce am citit pe foaie:**\n${r.transcriere.trim()}`);
  for (const it of r.itemi) {
    const lines = [];
    if (!one) {
      const pts = it.puncte != null ? ` — **${it.puncte}/${it.puncte_max}p**` : '';
      lines.push(`**${ICON_ITEM[it.verdict] || '•'} ${it.eticheta}**${pts}`);
    } else if (it.pasi.length) {
      lines.push('**Pas cu pas:**');
    }
    for (const p of it.pasi) lines.push(`${ICON_PAS[p.verdict] || '•'} ${p.text}${p.comentariu ? ` — ${p.comentariu}` : ''}`);
    if (it.motiv_punctaj) lines.push(`**Punctaj:** ${it.motiv_punctaj}`);
    if (lines.length) out.push(lines.join('\n'));
  }
  if (!hasBarem) out.push('_Pentru acest exercițiu nu am barem, așa că nu dau puncte — doar verific pașii._');
  if (r.feedback) out.push(r.feedback);
  if (r.sfat) out.push(`💡 ${r.sfat}`);
  out.push('Întreabă-mă orice despre corectare — îți explic pasul la care te-ai împotmolit.');
  return out.join('\n\n');
}

// Corectarea propriu-zisă: imaginile + sursa (testul și baremul, exercițiul
// interactiv cu rezolvarea oficială sau doar enunțul) → { result, text, model, usages }
async function correctHandwriting({ images, grid = null, src, lim = null }) {
  const hasBarem = !!src.hasBarem;
  const r = await correctJson({
    system: HW_SYSTEM,
    text: hwUserText(src, images.length),
    images, labels: tileLabels(images.length, grid),
    schema: HW_SCHEMA, schemaName: 'corectare_scris',
    maxTokens: 6000, lim,
  });
  const result = normalizeHw(r.data, { hasBarem });
  return { result, text: formatHw(result, { hasBarem }), model: r.model, usages: r.usages, fallback: r.fallback };
}

module.exports = {
  correctJson, correctHandwriting, modelFor, isClaude,
  MAIN_MODEL, ECON_MODEL, EFFORT,
  // exportate pentru teste
  HW_SCHEMA, HW_SYSTEM, hwUserText, tileLabels, normalizeHw, formatHw, claudeImage,
};
