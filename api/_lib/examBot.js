// =====================================================================
// api/_lib/examBot.js — 🤖 BOTUL DE EXAMENE: logica PURĂ (fără rețea, fără DB)
//
// Cererea (30 oct. 2026): „fă un bot care să caute permanent pe internet modele
// de examen, variante oficiale (date în sesiune, rezerve, pentru olimpici),
// simulări, teste de antrenament, bareme — pentru Evaluarea Națională, BAC
// Tehnologic, BAC Științele Naturii, BAC Mate-Info — și să le încarce în baza de
// date, să le publice pe site, fiecare la rubrica lui (PDF). Să caute examenul
// ȘI baremul. Același bot să verifice toate fișierele încărcate: au un barem
// corespunzător? Dacă nu, să-l caute pe internet și să-l încarce. Numele din
// site, numele original al fișierului și conținutul trebuie să se potrivească
// exact." — întâi ca BOT (fără AI, pentru economie).
//
// Aici stă tot ce se poate testa fără rețea:
//   · clasificarea unui link găsit (numele fișierului, textul linkului, titlul
//     articolului / paginii, data) — `classifyLink`;
//   · clasificarea DUPĂ CONȚINUT (antetul PDF-ului — sursa de adevăr; refolosește
//     api/_lib/barem.js) — `classifyDoc`, apoi decizia finală — `decide`;
//   · rubrica de pe site, titlul (SEO + aceleași cuvinte pe subiect și barem, ca
//     potrivirea automată din site să le lege), numele fișierului, descrierea;
//   · identitatea (an · profil · sesiune · variantă) și amprenta textului, ca
//     să nu încarce de două ori ce există deja;
//   · verificarea subiect ↔ barem (titlu + nume de fișier + antet + conținut);
//   · robots.txt, extragerea linkurilor din HTML / RSS / WordPress, căutările.
// Rețeaua: api/_lib/examBotNet.js · baza de date: api/_lib/examBotRun.js.
// =====================================================================
const B = require('./barem');

const fold = (s) => B.norm(s);

// ─── Rubricile site-ului (oglinda lui src/lib/contentMeta.js) ────────────────
const PROFILES = {
  'mate-info': { label: 'Mate-Info', cod: 'M_mate-info', nume: 'matematică-informatică' },
  'stiinte-naturii': { label: 'Științele Naturii', cod: 'M_st-nat', nume: 'științe ale naturii' },
  tehnologic: { label: 'Tehnologic', cod: 'M_tehnologic', nume: 'tehnologic' },
};
const PROFILE_IDS = Object.keys(PROFILES);
const TIPURI = {
  sesiune: 'Variantă dată în sesiune',
  rezerva: 'Variantă de rezervă',
  speciala: 'Sesiunea specială (olimpici)',
  simulare: 'Simulare',
  model: 'Model oficial',
  antrenament: 'Test de antrenament',
};
const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

// Județele (codul auto → numele), pentru simulările județene și testele ISJ
const JUDETE = {
  ab: 'Alba', ar: 'Arad', ag: 'Argeș', bc: 'Bacău', bh: 'Bihor', bn: 'Bistrița-Năsăud', bt: 'Botoșani', bv: 'Brașov',
  br: 'Brăila', bz: 'Buzău', cs: 'Caraș-Severin', cl: 'Călărași', cj: 'Cluj', ct: 'Constanța', cv: 'Covasna',
  db: 'Dâmbovița', dj: 'Dolj', gl: 'Galați', gr: 'Giurgiu', gj: 'Gorj', hr: 'Harghita', hd: 'Hunedoara', il: 'Ialomița',
  is: 'Iași', if: 'Ilfov', mm: 'Maramureș', mh: 'Mehedinți', ms: 'Mureș', nt: 'Neamț', ot: 'Olt', ph: 'Prahova',
  sm: 'Satu Mare', sj: 'Sălaj', sb: 'Sibiu', sv: 'Suceava', tr: 'Teleorman', tm: 'Timiș', tl: 'Tulcea', vs: 'Vaslui',
  vl: 'Vâlcea', vn: 'Vrancea', b: 'București',
};
const JUDET_NUME = Object.values(JUDETE).map((n) => ({ nume: n, f: fold(n) }))
  .sort((a, b) => b.f.length - a.f.length);   // „satu mare" înaintea lui „mare"…

// ─── Setările botului (app_settings 'exam_bot') ──────────────────────────────
const DEFAULT_SETTINGS = {
  enabled: true,            // cronul rulează singur
  autoPublish: true,        // publică singur ce e SIGUR; restul așteaptă în Admin
  isFree: true,             // materialele noi: gratuite (PDF-urile sunt gratuite pe site)
  announce: true,           // un singur anunț în clopoțel pe rulare (nu câte unul pe fișier)
  exams: { en: true, 'mate-info': true, 'stiinte-naturii': true, tehnologic: true },
  minYear: 2019,            // subiectele oficiale (Ministerul Educației) de la anul acesta
  isjYears: 2,              // simulările județene / testele ISJ: doar ultimii 2 ani școlari
  sources: { edupedu: true, subiecte: true, eduRo: true, pagini: true, cautare: true },
  pages: ['https://sbisj.ro/Noutati/'],   // pagini urmărite (inspectorate școlare etc.)
  domains: [],              // domenii acceptate în plus (pe lângă edu.ro, ISJ-uri, edupedu.ro)
  intervalHours: 24,        // căutarea online, în afara perioadelor de examen
  seasonHours: 2,           // în perioadele de examen (simulări, sesiuni, modele)
  maxNewPerRun: 40,         // câte fișiere noi procesează cel mult o rulare
  maxBaremSearchPerRun: 15, // câte bareme lipsă caută online o rulare de cron
};

const clampInt = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
function cleanUrlList(list, max = 40) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list || '').split(/\s+/)) {
    const s = String(raw || '').trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = '';
      if (!out.includes(u.href)) out.push(u.href);
    } catch { /* ignorăm ce nu e URL */ }
    if (out.length >= max) break;
  }
  return out;
}
function cleanDomains(list, max = 40) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)) {
    const d = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !out.includes(d)) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}
function normalizeSettings(v) {
  const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const d = DEFAULT_SETTINGS;
  const bool = (x, def) => (typeof x === 'boolean' ? x : def);
  const exams = {};
  for (const k of Object.keys(d.exams)) exams[k] = bool(s.exams && s.exams[k], d.exams[k]);
  const sources = {};
  for (const k of Object.keys(d.sources)) sources[k] = bool(s.sources && s.sources[k], d.sources[k]);
  return {
    enabled: bool(s.enabled, d.enabled),
    autoPublish: bool(s.autoPublish, d.autoPublish),
    isFree: bool(s.isFree, d.isFree),
    announce: bool(s.announce, d.announce),
    exams, sources,
    minYear: clampInt(s.minYear, 2005, 2100, d.minYear),
    isjYears: clampInt(s.isjYears, 1, 10, d.isjYears),
    pages: s.pages === undefined ? d.pages.slice() : cleanUrlList(s.pages),
    domains: cleanDomains(s.domains),
    intervalHours: clampInt(s.intervalHours, 1, 24 * 14, d.intervalHours),
    seasonHours: clampInt(s.seasonHours, 1, 48, d.seasonHours),
    maxNewPerRun: clampInt(s.maxNewPerRun, 1, 300, d.maxNewPerRun),
    maxBaremSearchPerRun: clampInt(s.maxBaremSearchPerRun, 0, 100, d.maxBaremSearchPerRun),
  };
}

// ─── Calendarul examenelor ───────────────────────────────────────────────────
function roParts(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const g = (t) => parseInt((p.find((x) => x.type === t) || {}).value, 10);
  return { y: g('year'), m: g('month'), d: g('day') };
}
// anul examenului pentru o dată: din septembrie începe anul școlar următor
function examYearOf(date = new Date()) {
  const { y, m } = roParts(date);
  return m >= 9 ? y + 1 : y;
}
// perioadele în care ministerul / inspectoratele publică (botul caută mai des)
function isHotSeason(date = new Date()) {
  const { m, d } = roParts(date);
  const md = m * 100 + d;
  return (md >= 305 && md <= 331)      // simulările naționale (martie)
    || (md >= 512 && md <= 610)        // sesiunea specială (olimpici) — mai
    || (md >= 615 && md <= 715)        // EN + BAC sesiunea din iunie–iulie (+ rezervele)
    || (md >= 810 && md <= 905)        // BAC sesiunea de toamnă
    || (md >= 1015 && md <= 1220);     // modelele pentru anul următor
}

// ─── Semnale din TEXT (nume de fișier, text de link, titlu de articol) ───────
const RE_BAREM = /\bbarem|\bbar\s*(?:\d|simul|model|rez|test|var|special|olimp)|\bbarem(?:ul|e)?\b/;
const RE_MATH = /matemat|\bmate\b|\bm\s*(?:mate\s*info|st\s*nat|tehnologic|pedagogic)\b|\be\s*c\s*matem|\bmi\b|\bsn\b/;
const RE_ALT_MATERIE = /\b(?:istori|biologi|chimi|fizic|geografi|logic|psihologi|economi|sociologi|filosofi|anatomi|limba\s+si\s+literatura|literatura\s+romana|limba\s+romana|lb\s+romana|informatic)/;
// limbile minorităților (variantele traduse): codurile oficiale și cuvintele din numele fișierelor
const RE_LIMBA_ALTA = /\bl(?:ma|ge|sk|sr|uc|ce|it|pl|hr|bg|rt|tc|sb|rr|tt|cz)\b|\b(?:maghiar|german|sarb|slovac|ucrain|ceh|croat|bulgar|italian|polon|turc|tatar|rrom)\w*/;

function examFromText(t) {
  if (/\benviii\b|\ben\s*viii\b|evaluar\w*\s+national|\bclas(?:a|ei)\s+a\s+viii|\ben\s*8\b|\bviii\b/.test(t)) return 'en';
  if (/bacalaureat|\bbac\b|\be\s*c\s*matem|\bm\s*(?:mate\s*info|st\s*nat|tehnologic|pedagogic)\b/.test(t)) return 'bac';
  return null;
}
function profileFromName(t) {
  if (/pedagog|\bpeda|\bm\s*ped\b/.test(t)) return 'pedagogic';
  if (/tehnolog|\btehno\b/.test(t)) return 'tehnologic';
  if (/\bst\s*nat\b|stiint\w*\s+(?:ale\s+)?natur|\bsn\b/.test(t)) return 'stiinte-naturii';
  if (/\bmate\s*info|matematica\s+(?:si\s+)?informatica|\bmi\b|\bm1\b/.test(t)) return 'mate-info';
  return null;
}
// toate profilurile pomenite (un articol cu „mate-info, tehnologic…" nu decide profilul unui fișier)
function profilesMentioned(t) {
  const out = new Set();
  if (/pedagog/.test(t)) out.add('pedagogic');
  if (/tehnolog/.test(t)) out.add('tehnologic');
  if (/stiint\w*\s+(?:ale\s+)?natur|\bst\s*nat\b/.test(t)) out.add('stiinte-naturii');
  if (/\bmate\s*info|matematica\s+(?:si\s+)?informatica/.test(t)) out.add('mate-info');
  return [...out];
}
function yearFromText(t) {
  const y = B.yearOf(t);
  return y && +y >= 2000 && +y <= 2100 ? y : null;
}
// anul examenului dintr-un nume: „simulare … dec 2025" = examenul din 2026
// (septembrie–decembrie aparțin anului școlar care se încheie cu examenul următor)
function yearFromName(t) {
  const y = yearFromText(t);
  if (!y) return null;
  if (/\b(?:19|20)\d{2}\s*[/–—-]?\s*(?:19|20)\d{2}\b/.test(t)) return y;   // „2025-2026" — deja anul examenului
  const l = lunaFrom(t);
  return l && LUNI.indexOf(l) >= 8 ? String(+y + 1) : y;
}
function variantFromName(t) {
  const m = t.match(/\b(?:varianta|var|v|barem|bar|testul|test|simularea|simulare)\s*0*(\d{1,3})\b/);
  return m ? String(parseInt(m[1], 10)) : null;
}
function kindFromName(t) {
  if (/\b(?:varianta|var)\s*\d/.test(t)) return 'varianta';
  if (/\btest(?:ul)?\s*\d/.test(t)) return 'test';
  return null;
}
function langFromName(t) {
  if (/\blro\b|\bromana\s+subiect|\bsubiect\w*\s+romana\b/.test(t)) return 'ro';
  if (RE_LIMBA_ALTA.test(t)) return 'alta';
  return null;
}
function lunaFrom(t) {
  for (const l of LUNI) if (new RegExp(`\\b${l}\\b`).test(t)) return l;
  const s = t.match(/\b(ian|feb|mar|apr|mai|iun|iul|aug|sep|sept|oct|noi|nov|dec)\b/);
  if (s) return { ian: 'ianuarie', feb: 'februarie', mar: 'martie', apr: 'aprilie', mai: 'mai', iun: 'iunie', iul: 'iulie', aug: 'august', sep: 'septembrie', sept: 'septembrie', oct: 'octombrie', noi: 'noiembrie', nov: 'noiembrie', dec: 'decembrie' }[s[1]];
  return null;
}
function judetFrom(t) {
  if (!t) return null;
  if (/\bismb\b|municipiului\s+bucuresti/.test(t)) return 'București';
  // „județul Timiș", „ISJ Sibiu", „Inspectoratul Școlar (Județean) Sibiu", „simularea din Iași"
  for (const j of JUDET_NUME) {
    const re = new RegExp(`(?:judet\\w*|isj|inspectoratul\\s+scolar(?:\\s+judetean)?|din|de\\s+la)\\s+(?:al\\s+)?${j.f.replace(/ /g, '\\s+')}\\b`);
    if (re.test(t)) return j.nume;
  }
  return null;
}
// ISJ din domeniu: „sbisj.ro" → Sibiu, „isjtm.ro" → Timiș, „isj.vs.edu.ro" → Vaslui, „isjiasi.ro" → Iași
function judetFromHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!/isj|ismb/.test(h)) return null;
  if (/ismb/.test(h)) return 'București';
  const first = h.split('.')[0];
  let m = first.match(/^([a-z]{1,2})isj$/) || first.match(/^isj-?([a-z]{1,2})$/);
  if (m && JUDETE[m[1]]) return JUDETE[m[1]];
  m = h.match(/^isj\.([a-z]{1,2})\./);
  if (m && JUDETE[m[1]]) return JUDETE[m[1]];
  const rest = first.replace(/isj-?/, '');
  const j = JUDET_NUME.find((x) => x.f.replace(/[^a-z]/g, '') === rest);
  return j ? j.nume : null;
}

// felul documentului, din cuvinte (doar indicii — antetul și contextul decid)
function tipSignals(t) {
  return {
    rezerva: /\brezerv/.test(t),
    speciala: /\bspecial|\bolimpi/.test(t),
    simulare: /\bsimul/.test(t),
    model: /\bmodel/.test(t),
    antrenament: /antrenament|\bpregatire\s+examen/.test(t),
    judetean: /\bjudet|\bisj\b|inspectorat|\bjud\b/.test(t),
    national: /\bnational|ministerul|\bmen\b|\bmec\b|cnpee|rocnee/.test(t),
    toamna: /\btoamn|\baugust|\bseptembrie|sesiunea\s+a\s+(?:ii|doua)\b/.test(t),
    iunie: /\biunie|\biulie|sesiunea\s+(?:i|intai)\b/.test(t),
  };
}

// ─── Gazdele de încredere ────────────────────────────────────────────────────
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
function isOfficialHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return /(^|\.)edu\.ro$/.test(h) || /(^|\.)rocnee\.eu$/.test(h) || /(^|\.)cnpee\.ro$/.test(h) || /isj|ismb/.test(h);
}
function isTrustedHost(host, settings = DEFAULT_SETTINGS) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (isOfficialHost(h)) return true;
  if (/(^|\.)edupedu\.ro$/.test(h)) return true;    // republică fișierele oficiale (cdn.edupedu.ro)
  return (settings.domains || []).some((d) => h === d || h.endsWith(`.${d}`));
}

// ─── Numele fișierului dintr-un URL (și dintr-o intrare de arhivă „zip#nume") ─
function fileNameFromUrl(url) {
  const s = String(url || '');
  const hash = s.indexOf('#');
  let last = hash !== -1 && /\.zip$/i.test(s.slice(0, hash).split('?')[0]) ? s.slice(hash + 1) : s.split('#')[0].split('?')[0];
  last = last.split('/').pop() || '';
  try { last = decodeURIComponent(last); } catch { /* rămâne */ }
  return last;
}
const extOf = (name) => { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/); return m ? m[1] : ''; };
const stem = (name) => String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/-\d{1,2}$/, '');  // „…_LRO-1.pdf" (duplicat WordPress)

// ═══════════════════════════════════════════════════════════════════════════
// 1. CLASIFICAREA UNUI LINK (înainte de descărcare)
// ═══════════════════════════════════════════════════════════════════════════
// { url, text, pageTitle, pageUrl, pageDate, source } → indiciile + dacă merită descărcat
function classifyLink({ url, text = '', pageTitle = '', pageUrl = '', pageDate = null, source = '' } = {}) {
  const name = fileNameFromUrl(url);
  const ext = extOf(name);
  const n = fold(stem(name));
  const lt = fold(text);
  const own = `${n} ${lt}`;                                   // ce spune fișierul însuși
  // calea paginii / a folderului (subiecte.edu.ro: „…/Sesiunea_speciala/…") face parte din context
  let pathCtx = '';
  try { pathCtx = fold(decodeURIComponent(new URL(url).pathname.split('/').slice(0, -1).join(' '))); } catch { /* fără */ }
  try { if (pageUrl) pathCtx += ` ${fold(decodeURIComponent(new URL(pageUrl).pathname.replace(/[/-]+/g, ' ')))}`; } catch { /* fără */ }
  const ctx = `${fold(pageTitle)} ${pathCtx}`;
  const all = `${own} ${ctx}`;

  const exam = examFromText(own) || examFromText(ctx);
  const isBarem = RE_BAREM.test(n) || /^barem/.test(lt);
  const profOwn = profileFromName(own);
  const profCtx = profilesMentioned(ctx);
  const profile = exam === 'en' ? null : (profOwn || (profCtx.length === 1 ? profCtx[0] : null));
  // anul: din numele fișierului / textul linkului; altfel din titlul articolului, din folder, din dată
  const t0 = pageDate ? Date.parse(pageDate) : NaN;
  const dateMonth = Number.isFinite(t0) ? roParts(new Date(t0)).m : null;
  let year = yearFromName(n) || yearFromName(lt);
  let yearFrom = year ? 'nume' : null;
  if (!year) { year = yearFromText(fold(pageTitle)) || yearFromText(pathCtx); if (year) yearFrom = 'context'; }
  if (!year && Number.isFinite(t0)) { year = String(examYearOf(new Date(t0))); yearFrom = 'data'; }
  const variant = variantFromName(n) || variantFromName(lt);
  const kind = kindFromName(n) || kindFromName(lt);
  const lang = langFromName(n) || langFromName(lt);
  const sigOwn = tipSignals(own);
  const sigCtx = tipSignals(ctx);
  const host = hostOf(url);
  const pageHost = hostOf(pageUrl);
  const judet = judetFrom(all) || judetFromHost(pageHost) || judetFromHost(host);
  const luna = lunaFrom(n) || lunaFrom(lt);
  const math = RE_MATH.test(own) || (RE_MATH.test(ctx) && !(RE_ALT_MATERIE.test(own) && !RE_MATH.test(own)));
  const altaMaterie = RE_ALT_MATERIE.test(own) && !RE_MATH.test(own);
  const pdf = ext === 'pdf';
  const zip = ext === 'zip';
  const officialSource = isOfficialHost(host) || isOfficialHost(pageHost)
    || /ministerul\s+educatiei|inspectoratul\s+scolar|\bisj\b|cnpee|publicat\w*\s+de\s+minister/.test(fold(pageTitle));
  // merită descărcat? (decizia reală vine din antetul PDF-ului)
  const reasons = [];
  if (!pdf && !zip) reasons.push('nu e PDF / arhivă');
  if (lang === 'alta') reasons.push('varianta tradusă (altă limbă)');
  if (altaMaterie) reasons.push('altă materie');
  if (!math && !zip) reasons.push('nu pare matematică');
  if (profOwn === 'pedagogic') reasons.push('profil pedagogic (nu e pe site)');
  return {
    url, name, ext, pdf, zip, exam, isBarem, profile, profileOwn: profOwn, year, yearFrom, variant, kind, lang, judet, luna, dateMonth,
    signals: { own: sigOwn, ctx: sigCtx }, math, altaMaterie, officialSource, host,
    download: reasons.length === 0, reasons,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CLASIFICAREA DUPĂ CONȚINUT — antetul PDF-ului (sursa de adevăr)
// ═══════════════════════════════════════════════════════════════════════════
// cuvinte tipice fiecărei limbi în enunțurile de matematică
const RO_WORDS = /\b(?:se\s+acorda|puncte|subiectul|aratati|determinati|calculati|demonstrati|rezultatul|numarul|multimea|ecuatia|functia)\b/g;
const HU_WORDS = /\b(?:pont|feladat|tetel|szamitsd|hatarozd|igazold|egyenlet|fuggveny|halmaz|szam)\b/g;
const DE_WORDS = /\b(?:punkte|aufgabe|berechnen|bestimmen|zeigen|gleichung|funktion|menge|zahl|losung)\b/g;
function langFromText(text) {
  const t = fold(String(text || '').slice(0, 8000));
  const c = (re) => (t.match(re) || []).length;
  const ro = c(RO_WORDS), hu = c(HU_WORDS), de = c(DE_WORDS);
  if (ro >= 3 && ro >= hu && ro >= de) return 'ro';
  if (hu >= 3 || de >= 3) return 'alta';
  return ro > 0 ? 'ro' : null;
}

function classifyDoc(text) {
  const raw = String(text || '');
  if (raw.trim().length < 120) return { recognized: false, chars: raw.trim().length };
  const d = B.docTokens(raw) || null;
  const head = fold(raw.slice(0, 2600));
  const top = fold(raw.slice(0, 400));
  const math = /matemat/.test(head);
  const official = /ministerul\s+educatiei|centrul\s+national\s+de\s+(?:politici|evaluare)|\bcnpee\b|\brocnee\b|inspectoratul\s+scolar|\bisj\b|\bismb\b|centrul\s+national\s+de\s+evaluare\s+si\s+examinare/.test(head);
  const isj = /inspectoratul\s+scolar|\bisj\b|\bismb\b/.test(head);
  const isBarem = !!(d && d.isBarem) || /^\s*barem/.test(top) || /\bbarem\s+de\s+(?:evaluare|corectare|notare)\b/.test(head);
  const embedded = !isBarem && !!B.splitEmbeddedBarem(raw);
  const profile = d && d.exam === 'en' ? null : ((d && d.profile) || null);
  return {
    recognized: !!(d && (d.exam || d.year)),
    exam: d ? d.exam : null,
    year: d ? d.year : null,
    variant: d ? d.variant : null,
    kind: d ? d.kind : null,
    flags: d ? d.flagList || [] : [],
    profile,
    isBarem, embedded, math, official, isj,
    judet: judetFrom(head),
    luna: lunaFrom(head),
    antrenament: /antrenament/.test(head),
    lang: langFromText(raw),
    chars: raw.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. DECIZIA: link + conținut → clasificarea finală, încrederea, filtrele
// ═══════════════════════════════════════════════════════════════════════════
function decideTip(link, doc) {
  const own = link.signals.own, ctx = link.signals.ctx;
  const flags = new Set((doc && doc.flags) || []);
  const isjCtx = !!(link.judet || (doc && doc.isj) || own.judetean || ctx.judetean) && !(doc && doc.official && !doc.isj && (flags.has('simulare') || flags.has('model')) && !link.judet);
  const scope = isjCtx ? 'judeteana' : 'nationala';
  const ambigu = [];
  // 1) ce spune DOCUMENTUL (numele lui + antetul)
  if (own.simulare || flags.has('simulare')) return { tip: 'simulare', scope, ambigu };
  if (own.antrenament || (doc && doc.antrenament)) return { tip: 'antrenament', scope: isjCtx ? 'judeteana' : 'nationala', ambigu };
  if (own.model || flags.has('model')) return { tip: isjCtx ? 'antrenament' : 'model', scope, ambigu };
  if (own.rezerva || flags.has('rezerva')) return { tip: 'rezerva', scope: 'nationala', ambigu };
  if (own.speciala || flags.has('speciala')) return { tip: 'speciala', scope: 'nationala', ambigu };
  // 2) contextul (titlul articolului, folderul)
  const ctxTips = ['simulare', 'antrenament', 'model', 'rezerva', 'speciala'].filter((k) => ctx[k]);
  if (ctxTips.length > 1) ambigu.push(`contextul pomenește mai multe feluri (${ctxTips.join(', ')})`);
  if (ctx.simulare) return { tip: 'simulare', scope, ambigu };
  if (ctx.antrenament) return { tip: 'antrenament', scope: isjCtx ? 'judeteana' : 'nationala', ambigu };
  if (ctx.model) return { tip: isjCtx ? 'antrenament' : 'model', scope, ambigu };
  if (ctx.rezerva) return { tip: 'rezerva', scope: 'nationala', ambigu };
  if (ctx.speciala) return { tip: 'speciala', scope: 'nationala', ambigu };
  // 3) o variantă oficială numerotată = sesiunea; luna din context
  const variant = (doc && doc.variant) || link.variant;
  if (variant && (doc ? doc.kind !== 'test' : link.kind !== 'test')) {
    const exam = (doc && doc.exam) || link.exam;
    const dm = link.dateMonth;
    // EN are o singură sesiune (iunie); la BAC luna vine din context sau din data articolului
    const luna = own.toamna || ctx.toamna ? 'august' : own.iunie || ctx.iunie ? 'iunie'
      : exam === 'en' ? 'iunie' : dm === 6 || dm === 7 ? 'iunie' : dm === 8 || dm === 9 ? 'august' : null;
    if (isjCtx) return { tip: 'antrenament', scope: 'judeteana', ambigu };
    return { tip: 'sesiune', scope: 'nationala', luna, ambigu };
  }
  if (variant && (doc ? doc.kind === 'test' : link.kind === 'test')) return { tip: 'antrenament', scope, ambigu };
  return { tip: null, scope, ambigu };
}

// → { cls, confidence: 'sigur' | 'nesigur', status: 'ok' | 'ignorat', reasons: [] }
function decide(link, doc, { settings = DEFAULT_SETTINGS, now = new Date() } = {}) {
  const S = normalizeSettings(settings);
  const reasons = [];
  const conflicts = [];
  const d = doc && doc.recognized ? doc : null;
  const pick = (a, b, label) => {
    if (a && b && String(a) !== String(b)) conflicts.push(`${label}: antetul spune ${a}, numele ${b}`);
    return a || b || null;
  };
  const exam = pick(d && d.exam, link.exam, 'examenul');
  // anul dedus din context / din dată nu contrazice antetul (îl completează doar)
  const year = link.yearFrom === 'nume' ? pick(d && d.year, link.year, 'anul') : ((d && d.year) || link.year || null);
  const variant = pick(d && d.variant, link.variant, 'varianta');
  let profile = exam === 'en' ? null : pick(d && d.profile, link.profile, 'profilul');
  if (exam === 'bac' && !profile && link.profileOwn) profile = link.profileOwn;
  const isBarem = !!((d && d.isBarem) || link.isBarem);
  if (d && link.isBarem && !d.isBarem && !d.embedded) conflicts.push('numele spune „barem", antetul nu');
  const t = decideTip(link, d);
  if (t.ambigu.length) conflicts.push(...t.ambigu);
  const math = d ? d.math || (!!link.math && !d.exam) : link.math;
  // limba se citește din text chiar dacă antetul nu e recunoscut (ex. o variantă în maghiară)
  const lang = (doc && doc.lang) || link.lang || null;
  const judet = (t.scope === 'judeteana' || t.tip === 'antrenament') ? ((d && d.judet) || link.judet || null) : null;
  const luna = t.luna || (t.tip === 'antrenament' || (t.tip === 'simulare' && t.scope === 'judeteana') ? (link.luna || (d && d.luna) || null) : null);
  const official = !!((d && d.official) || link.officialSource);
  const kind = (d && d.kind) || link.kind || null;
  const cls = {
    exam, year, profile, tip: t.tip, scope: t.tip === 'simulare' || t.tip === 'antrenament' ? t.scope : 'nationala',
    luna, judet, variant, kind, isBarem, embedded: !!(d && d.embedded), lang, math, official,
  };

  // ── filtrele (→ ignorat) ──
  if (lang === 'alta' || link.lang === 'alta') reasons.push('varianta tradusă (altă limbă decât româna)');
  if (d && !d.math) reasons.push('nu e la matematică (antetul nu pomenește matematica)');
  if (!d && !link.math) reasons.push('nu pare la matematică');
  if (!exam) reasons.push('nu am recunoscut examenul (EN / BAC)');
  if (profile === 'pedagogic') reasons.push('profilul pedagogic nu are rubrică pe site');
  if (exam === 'en' && !S.exams.en) reasons.push('Evaluarea Națională e oprită în setări');
  if (exam === 'bac' && profile && PROFILES[profile] && !S.exams[profile]) reasons.push(`BAC ${PROFILES[profile].label} e oprit în setări`);
  const ey = examYearOf(now);
  if (year && +year < S.minYear) reasons.push(`anul ${year} e mai vechi decât ${S.minYear} (setări)`);
  if (year && +year > ey + 1) reasons.push(`anul ${year} e în viitor — probabil greșit`);
  const judetean = cls.scope === 'judeteana' || (cls.tip === 'antrenament' && !!cls.judet);
  if (judetean && year && +year <= ey - S.isjYears) reasons.push(`material județean din ${year} (setări: doar ultimii ${S.isjYears} ani)`);
  if (reasons.length) return { cls, confidence: 'nesigur', status: 'ignorat', reasons, conflicts };

  // ── încrederea ──
  const lipsuri = [];
  if (!d) lipsuri.push('PDF fără text (scanat?) — n-am putut citi antetul');
  if (!year) lipsuri.push('anul');
  if (exam === 'bac' && !profile) lipsuri.push('profilul');
  if (!cls.tip) lipsuri.push('felul (sesiune / rezervă / simulare / model / antrenament)');
  if (cls.tip === 'sesiune' && !variant) lipsuri.push('varianta');
  // (fără text, sursa și limba nu se pot verifica — „PDF fără text" spune deja asta)
  if (d && !official) lipsuri.push('sursa oficială (antetul nu pomenește ministerul / inspectoratul)');
  if (d && lang !== 'ro') lipsuri.push('limba (n-am găsit enunțuri în română)');
  const sigur = !lipsuri.length && !conflicts.length;
  return { cls, confidence: sigur ? 'sigur' : 'nesigur', status: 'ok', reasons: [...lipsuri.map((x) => `lipsește: ${x}`), ...conflicts], conflicts };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. RUBRICA, TITLUL, NUMELE FIȘIERULUI, DESCRIEREA
// ═══════════════════════════════════════════════════════════════════════════
function rubricFor(c) {
  if (!c || !c.exam) return null;
  if (c.exam === 'en') {
    if (c.isBarem) return { category: 'evaluare-nationala', subcategory: 'bareme', profile: null };
    return { category: 'evaluare-nationala', subcategory: c.tip === 'simulare' ? 'simulari' : 'variante', profile: null };
  }
  if (!c.profile || !PROFILES[c.profile]) return null;
  if (c.isBarem) return { category: 'bacalaureat', subcategory: 'bareme', profile: c.profile };
  const sub = c.tip === 'antrenament' ? 'teste-antrenament'
    : (c.tip === 'simulare' || c.tip === 'model') ? 'simulari' : 'variante';
  return { category: 'bacalaureat', subcategory: sub, profile: c.profile };
}

// Titlul: același pentru subiect și barem (+ „Barem — "), ca potrivirea automată
// din site (api/_lib/barem.js: an, variantă, profil, felul sesiunii) să le lege.
function titleFor(c) {
  if (!c || !c.exam || !c.year) return null;
  const base = c.exam === 'en'
    ? `Evaluare Națională ${c.year} — Matematică`
    : `Bacalaureat ${c.year} — Matematică ${PROFILES[c.profile] ? PROFILES[c.profile].cod : ''}`.trim();
  const v = c.variant ? `Varianta ${c.variant}` : null;
  const testNr = c.variant && c.kind === 'test' ? `Testul ${c.variant}` : null;
  let detail;
  switch (c.tip) {
    case 'sesiune':
      detail = `${v || 'Subiectul oficial'}${c.luna === 'august' ? ' (sesiunea de toamnă, august)' : c.luna === 'iunie' ? (c.exam === 'en' ? ' (subiectul dat în iunie)' : ' (sesiunea din iunie)') : ''}`;
      break;
    case 'rezerva': detail = v ? `${v} (varianta de rezervă)` : 'Varianta de rezervă'; break;
    case 'speciala': detail = `${v || 'Subiectul'} (sesiunea specială pentru olimpici)`; break;
    case 'simulare':
      detail = c.scope === 'judeteana' ? `Simulare județeană${c.judet ? ` ${c.judet}` : ''}` : 'Simulare națională';
      if (v || testNr) detail += `, ${testNr || v}`;
      if (c.luna && c.scope === 'judeteana') detail += ` (${c.luna})`;
      break;
    case 'model': detail = c.variant ? `Model oficial de subiect, ${v}` : 'Model oficial de subiect'; break;
    case 'antrenament': {
      const unde = [c.judet ? `ISJ ${c.judet}` : null, c.luna].filter(Boolean).join(', ');
      detail = `${testNr || 'Test'} de antrenament${unde ? ` (${unde})` : ''}${!testNr && v ? `, ${v}` : ''}`;
      break;
    }
    default: detail = v || 'Subiect';
  }
  const t = `${base}, ${detail}`;
  return c.isBarem ? `Barem — ${t}` : t;
}

function slugify(s, max = 110) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '');
}
const fileNameFor = (c) => `${slugify(titleFor(c) || 'subiect-examen')}.pdf`;

function descriptionFor(c, { originalName = null, sourceHost = null } = {}) {
  if (!c) return null;
  const autor = c.scope === 'judeteana' || (c.tip === 'antrenament' && c.judet)
    ? `Inspectoratul Școlar${c.judet ? ` ${c.judet}` : ''}` : 'Ministerul Educației';
  const ce = c.isBarem ? 'Baremul de evaluare și de notare' : c.embedded ? 'Subiectul (cu baremul inclus)' : 'Subiectul';
  const ex = c.exam === 'en' ? 'Evaluarea Națională, clasa a VIII-a' : `Bacalaureat, ${PROFILES[c.profile] ? PROFILES[c.profile].cod : 'matematică'}`;
  const tip = c.tip ? TIPURI[c.tip].toLowerCase() : '';
  const parts = [`${ce} oficial (${autor}) · ${ex} ${c.year || ''} · ${tip}`.replace(/\s+·\s*$/, '')];
  if (originalName) parts.push(`fișierul original: ${String(originalName).slice(0, 120)}`);
  if (sourceHost) parts.push(`sursa: ${sourceHost}`);
  return parts.join(' · ').slice(0, 480);
}

// ─── Identitatea și perechea (subiect ↔ barem) ───────────────────────────────
function tipKey(c) {
  if (!c || !c.tip) return '?';
  if (c.tip === 'sesiune') return `sesiune-${c.luna || '?'}`;
  if (c.tip === 'simulare') return c.scope === 'judeteana' ? `simulare-${fold(c.judet || 'judet')}-${c.luna || ''}` : 'simulare-nationala';
  if (c.tip === 'antrenament') return `antrenament-${fold(c.judet || '')}-${c.luna || ''}`;
  return c.tip;
}
const pairKey = (c) => [c.exam || '?', c.year || '?', c.profile || '-', tipKey(c), c.variant || '-'].join('|');
const identity = (c) => `${pairKey(c)}|${c.isBarem ? 'barem' : 'subiect'}`;

// ─── Amprenta textului (pentru „există deja pe site?") ───────────────────────
// MinHash pe cuvinte (64 de valori — mică, se ține în baza de date) + numerele
// distinctive ale documentului (exact). Același PDF republicat (alt nume, alt
// site) are aceleași cuvinte și aceleași numere; două variante diferite din
// același an au aceleași instrucțiuni, dar alte numere în enunțuri.
function fnv(s, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const MH = 64;
const MH_SEEDS = Array.from({ length: MH }, (_, i) => fnv(`examenmate-${i}`));
function numbersIn(text) {
  const m = String(text || '').match(/\d+(?:[.,]\d+)?/g) || [];
  return [...new Set(m.filter((x) => x.length >= 2 && !/^(?:19|20)\d{2}$/.test(x)))];
}
function fingerprint(text) {
  const t = fold(String(text || '').slice(0, 14000));
  const words = new Set();
  for (const w of t.split(' ')) if (w.length >= 3 && /[a-z]/.test(w)) words.add(w);
  const mins = new Array(MH).fill(0xffffffff);
  for (const w of words) {
    for (let k = 0; k < MH; k++) { const h = fnv(w, MH_SEEDS[k]); if (h < mins[k]) mins[k] = h; }
  }
  return { m: words.size ? mins.map((x) => x.toString(36)) : [], c: words.size, n: numbersIn(String(text || '').slice(0, 14000)).slice(0, 150) };
}
function jaccard(a, b) {
  const A = new Set(a || []), Bs = new Set(b || []);
  if (!A.size && !Bs.size) return 0;
  let inter = 0;
  for (const x of A) if (Bs.has(x)) inter++;
  return inter / (A.size + Bs.size - inter);
}
function minhashSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let eq = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) eq++;
  return eq / a.length;
}
// același document? (același PDF republicat, eventual cu alt nume)
function sameDocument(fa, fb) {
  if (!fa || !fb || !fa.m || !fb.m) return false;
  const w = minhashSim(fa.m, fb.m);
  const nA = (fa.n || []).length, nB = (fb.n || []).length;
  const n = Math.min(nA, nB) >= 6 ? jaccard(fa.n, fb.n) : null;
  return w >= 0.85 && (n === null || n >= 0.9);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. VERIFICAREA SUBIECT ↔ BAREM — titlul din site, numele original al
//    fișierului, antetul PDF-urilor și conținutul trebuie să spună același lucru
// ═══════════════════════════════════════════════════════════════════════════
// subject/barem: { row: {title, file_url, category, profile, subcategory}, text }
function verifyPair(subject, barem) {
  const sRow = subject.row || {}, bRow = barem.row || {};
  const sDoc = B.docTokens(subject.text || ''), bDoc = B.docTokens(barem.text || '');
  const ev = { titlu: null, fisier: null, antet: null, continut: null };
  // amprentele din text au „flags" ca listă — pentru comparații: același format ca B.tokensOf
  const tt = (x) => ({ ...x, flags: (x.flags || []).slice().sort().join(',') });
  // 1) titlurile din site
  const tS = tt(B.tokensFromText(fold(sRow.title))), tB = tt(B.tokensFromText(fold(bRow.title)));
  ev.titlu = B.tokensContradict({ ...tS, profile: B.profileOf(sRow) }, { ...tB, profile: B.profileOf(bRow) }) ? 'diferit' : (tS.year && tS.year === tB.year ? 'la fel' : 'neclar');
  // 2) numele originale ale fișierelor
  const fS = tt(B.tokensFromText(fold(B.fileNameOf(sRow)))), fB = tt(B.tokensFromText(fold(B.fileNameOf(bRow))));
  ev.fisier = B.tokensContradict(fS, fB) ? 'diferit' : (fS.year && fS.year === fB.year && (fS.variant || fB.variant ? fS.variant === fB.variant : true) ? 'la fel' : 'neclar');
  // 3) antetele (cu metadatele) — docsCompatible
  const s = B.tokensOf(sRow, sDoc), b = B.tokensOf(bRow, bDoc);
  ev.antet = B.docsCompatible(s, b);                         // match | unknown | contradiction
  // 4) conținutul — numerele din enunțuri regăsite în barem
  const score = B.contentMatchScore(subject.text || '', barem.text || '', { exam: B.examOf(sRow) });
  ev.continut = score === null ? null : Math.round(score * 100) / 100;
  const eBarem = (bDoc && bDoc.isBarem) || B.isBaremRow(bRow);
  let ok = false, how = null, why = null;
  if (!eBarem) why = 'documentul ales nu e un barem';
  else if (ev.antet === 'contradiction') why = 'antetul baremului spune alt an / altă variantă / alt profil';
  else if (ev.titlu === 'diferit' && ev.antet !== 'match') why = 'titlurile din site se contrazic';
  else if (ev.fisier === 'diferit' && ev.antet !== 'match') why = 'numele fișierelor se contrazic';
  else if (score !== null && score < 0.35) why = `conținutul nu se potrivește (${Math.round(score * 100)}% din numerele enunțurilor)`;
  else if (ev.antet === 'match') { ok = true; how = score === null ? 'antet' : 'antet+continut'; }
  else if (score !== null && score >= 0.5) { ok = true; how = 'continut'; }
  else why = 'nu am destule dovezi (antet neclar, conținut prea puțin)';
  return { ok, how, why, evidence: ev, score, subjectTokens: B.describeTokens(s), baremTokens: B.describeTokens(b) };
}

// Numele oficiale de barem care corespund unui subiect (pentru căutarea țintită)
// „E_c_matematica_M_mate-info_2024_var_07_LRO" → „…_bar_07_LRO";
// „ENVIII_Matematica_2025_Var_07_LRO" → „…_Bar_07_LRO"; „Model_BAC_MI_aprilie-2025" → „Barem_BAC_MI_aprilie-2025"
function baremNameGuesses(fileName) {
  const base = stem(String(fileName || '').replace(/^\d{9,}[_-]/, ''));
  if (!base) return [];
  const out = new Set();
  const rep2 = (re, fn) => { const r = base.replace(re, fn); if (r !== base) out.add(r); };
  // _var_ / -var- / _Var_ → _bar_ / _Bar_ (majuscula se păstrează)
  rep2(/(^|[_\-\s])(v)ar(?=[_\-\s]|\d)/i, (m, a, v) => `${a}${v === 'V' ? 'B' : 'b'}ar`);
  // Subiect → Barem
  rep2(/(^|[_\-\s])(s)ubiect(?=[_\-\s]|$)/i, (m, a, x) => `${a}${x === 'S' ? 'B' : 'b'}arem`);
  // Model_ / Test_ la început → Barem_
  rep2(/^(m)odel(?=[_\-\s])/i, (m, x) => (x === 'M' ? 'Barem' : 'barem'));
  rep2(/^(t)est(?=[_\-\s])/i, (m, x) => (x === 'T' ? 'Barem' : 'barem'));
  return [...out];
}

// ─── Linkurile dintr-o pagină HTML ───────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', rdquo: '”', ldquo: '“' };
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch { return m; } })
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return m; } })
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
}
const stripTags = (s) => decodeEntities(String(s || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
function absUrl(href, base) {
  try {
    const u = new URL(decodeEntities(String(href || '').trim()), base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}
// → { links: [{url, text}], guesses: [url] } — `guesses`: PDF-uri deduse din imaginile
// paginilor („…_LRO_page-0001-57x80.jpg" → „…_LRO.pdf"), când articolul n-are linkul PDF-ului
function extractLinks(html, baseUrl) {
  const src = String(html || '');
  const links = [];
  const seen = new Set();
  const re = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(src))) {
    const url = absUrl(m[2], baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: stripTags(m[3]).slice(0, 300) });
    if (links.length >= 3000) break;
  }
  const guesses = new Set();
  const ri = /<img\b[^>]*?\b(?:src|data-src|data-lazy-src)\s*=\s*(["'])(.*?)\1/gi;
  while ((m = ri.exec(src))) {
    const u = absUrl(m[2], baseUrl);
    if (!u) continue;
    const g = u.replace(/[_-]page[_-]?0*1(?:-\d+x\d+)?\.(?:jpe?g|png|webp)(\?.*)?$/i, '.pdf');
    if (g !== u && /\.pdf$/i.test(g)) guesses.add(g);
  }
  return { links, guesses: [...guesses] };
}
function pageMeta(html) {
  const s = String(html || '');
  const meta = (prop) => {
    const r1 = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${prop}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i');
    const r2 = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${prop}["']`, 'i');
    const mm = s.match(r1) || s.match(r2);
    return mm ? decodeEntities(mm[1]).trim() : null;
  };
  const h1 = s.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const tt = s.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const tm = s.match(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/i);
  return {
    title: meta('og:title') || (h1 ? stripTags(h1[1]) : null) || (tt ? stripTags(tt[1]) : null),
    date: meta('article:published_time') || (tm ? tm[1] : null),
  };
}
// RSS 2.0 / Atom → [{ title, link, date, html }]
function parseFeed(xml) {
  const s = String(xml || '');
  const items = [];
  const cdata = (x) => String(x || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  const tag = (block, name) => { const mm = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')); return mm ? cdata(mm[1]) : null; };
  for (const mm of s.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const b = mm[1];
    items.push({
      title: stripTags(tag(b, 'title') || ''),
      link: decodeEntities((tag(b, 'link') || '').trim()),
      date: (tag(b, 'pubDate') || '').trim() || null,
      html: tag(b, 'content:encoded') || tag(b, 'description') || '',
    });
  }
  if (!items.length) {
    for (const mm of s.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
      const b = mm[1];
      const href = (b.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      items.push({ title: stripTags(tag(b, 'title') || ''), link: decodeEntities(href), date: tag(b, 'updated') || tag(b, 'published'), html: tag(b, 'content') || tag(b, 'summary') || '' });
    }
  }
  return items.filter((x) => x.link);
}
// răspunsul API-ului WordPress (/wp-json/wp/v2/posts) → aceeași formă
function parseWpPosts(json) {
  if (!Array.isArray(json)) return [];
  return json.map((p) => ({
    title: stripTags(p?.title?.rendered || p?.title || ''),
    link: String(p?.link || ''),
    date: p?.date || null,
    html: p?.content?.rendered || '',
  })).filter((x) => x.link);
}

// E articolul / pagina despre subiecte de MATEMATICĂ de EN / BAC? (filtrul articolelor)
function relevantArticle(title) {
  const t = fold(title);
  if (!t) return false;
  if (!/matemat|\bmate\s*info|\bm\s*mate|tehnologic|stiint\w*\s+(?:ale\s+)?natur/.test(t)) return false;
  if (!/bac|evaluar|en\s*viii|clasa\s+a\s+viii|examen/.test(t)) return false;
  return /subiect|barem|model|simular|test|variant|rezerv|olimpi|special|sesiun|antrenament|descarca/.test(t);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. ROBOTS.TXT — botul respectă regulile fiecărui site
// ═══════════════════════════════════════════════════════════════════════════
function parseRobots(txt) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'allow' || key === 'disallow') cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  return groups;
}
function ruleMatches(pattern, path) {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return re.test(path);
}
// path = calea + query; ua = numele botului (ex. „ExamenMateBot")
function robotsAllowed(txt, ua, path) {
  const groups = parseRobots(txt);
  const me = String(ua || '').toLowerCase();
  let g = groups.filter((x) => x.agents.some((a) => a !== '*' && me.includes(a)));
  if (!g.length) g = groups.filter((x) => x.agents.includes('*'));
  if (!g.length) return true;
  let best = null;
  for (const grp of g) {
    for (const r of grp.rules) {
      if (r.path === '' && !r.allow) continue;     // „Disallow:" gol = totul permis
      if (!ruleMatches(r.path, path)) continue;
      const len = r.path.replace(/\*|\$$/g, '').length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
    }
  }
  return best ? best.allow : true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. CĂUTĂRILE
// ═══════════════════════════════════════════════════════════════════════════
// pe edupedu.ro (căutarea site-ului) — pentru anii ceruți
function discoveryQueries(years) {
  const q = [];
  for (const y of years) {
    q.push(
      `subiecte bareme matematica bacalaureat ${y}`,
      `barem matematica bacalaureat ${y}`,
      `simulare matematica bacalaureat ${y}`,
      `teste de antrenament matematica bacalaureat ${y}`,
      `modele de subiecte bacalaureat ${y} matematica`,
      `sesiunea speciala olimpici matematica ${y}`,
      `varianta de rezerva matematica ${y}`,
      `evaluarea nationala ${y} matematica subiecte`,
      `evaluarea nationala ${y} matematica barem`,
      `simulare evaluarea nationala ${y} matematica`,
      `test de antrenament evaluarea nationala ${y} matematica`,
    );
  }
  return q;
}
// pe un motor de căutare web (Brave / Serper / Google), dacă e configurat
function webQueries(years) {
  const q = [];
  for (const y of years) {
    q.push(
      `subiecte si bareme matematica bacalaureat ${y} pdf`,
      `simulare judeteana matematica bacalaureat ${y} barem pdf`,
      `simulare judeteana evaluare nationala ${y} matematica barem pdf`,
      `test antrenament matematica ${y} isj barem pdf`,
    );
  }
  return q;
}
// căutările pentru BAREMUL unui subiect (după amprenta lui)
function baremQueries(c, fileName = '') {
  const out = [];
  for (const g of baremNameGuesses(fileName)) out.push(g);
  if (!c || !c.exam || !c.year) return out;
  const ex = c.exam === 'en' ? `evaluarea nationala ${c.year} matematica` : `bacalaureat ${c.year} matematica ${PROFILES[c.profile] ? PROFILES[c.profile].cod.replace('M_', '') : ''}`.trim();
  const tip = c.tip === 'simulare' ? (c.scope === 'judeteana' ? `simulare ${c.judet || 'judeteana'}` : 'simulare')
    : c.tip === 'model' ? 'model' : c.tip === 'rezerva' ? 'varianta de rezerva' : c.tip === 'speciala' ? 'sesiunea speciala olimpici'
      : c.tip === 'antrenament' ? `test antrenament${c.judet ? ` ${c.judet}` : ''}${c.luna ? ` ${c.luna}` : ''}` : (c.luna === 'august' ? 'sesiunea de toamna' : '');
  out.push(`barem ${ex} ${tip} ${c.variant ? `varianta ${c.variant}` : ''}`.replace(/\s+/g, ' ').trim());
  out.push(`${ex} ${tip} subiecte si barem`.replace(/\s+/g, ' ').trim());
  return [...new Set(out)];
}

// Ghicește URL-ul unui fișier oficial pe CDN-ul edupedu (aceeași lună sau următoarea)
// pornind de la un fișier-frate cunoscut (ex. subiectul) — o cerere HEAD fiecare.
function siblingUrlGuesses(knownUrl, newStem) {
  const out = [];
  try {
    const u = new URL(knownUrl);
    const parts = u.pathname.split('/');
    parts[parts.length - 1] = `${newStem}.pdf`;
    out.push(`${u.origin}${parts.join('/')}`);
    const m = u.pathname.match(/\/uploads\/(\d{4})\/(\d{2})\//);
    if (m) {
      let y = +m[1], mo = +m[2] + 1;
      if (mo > 12) { mo = 1; y++; }
      out.push(`${u.origin}${u.pathname.replace(/\/uploads\/\d{4}\/\d{2}\/[^/]+$/, `/uploads/${y}/${String(mo).padStart(2, '0')}/${newStem}.pdf`)}`);
    }
  } catch { /* fără */ }
  return [...new Set(out)];
}

module.exports = {
  PROFILES, PROFILE_IDS, TIPURI, LUNI, JUDETE, DEFAULT_SETTINGS, normalizeSettings,
  roParts, examYearOf, isHotSeason, fold,
  examFromText, profileFromName, profilesMentioned, yearFromText, yearFromName, variantFromName, langFromName, lunaFrom, judetFrom, judetFromHost, tipSignals,
  hostOf, isOfficialHost, isTrustedHost, fileNameFromUrl, extOf, stem,
  classifyLink, classifyDoc, langFromText, decideTip, decide,
  rubricFor, titleFor, slugify, fileNameFor, descriptionFor, tipKey, pairKey, identity,
  numbersIn, fingerprint, jaccard, minhashSim, sameDocument, verifyPair, baremNameGuesses,
  decodeEntities, stripTags, absUrl, extractLinks, pageMeta, parseFeed, parseWpPosts, relevantArticle,
  parseRobots, robotsAllowed, discoveryQueries, webQueries, baremQueries, siblingUrlGuesses,
};
