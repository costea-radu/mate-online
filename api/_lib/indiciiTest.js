// =====================================================================
// api/_lib/indiciiTest.js — 💡 INDICIILE exercițiilor care n-au indicii în fișier
// (26 nov. 2026)
//
// Cererea: „Nu apar indicii la testele grilă de Evaluare Națională. Fă să apară ca
// la BAC." La BAC, fiecare pas al rezolvării are indicația lui, scrisă în fișierul
// testului („💡 Arată indiciile"). Testele de EN — Subiectele I și II grilă
// (`EX1` randat în #exList1 + cardurile scrise direct în pagină), Subiectul al
// III-lea pe pași (`PROBS`) — n-au nicio indicație în fișier.
//
// Ce face: scoate din HTML-ul unui test interactiv din `content` exercițiile FĂRĂ
// indicație proprie — cardurile-grilă și pașii din PROBS fără `help` — și scrie
// O DATĂ, cu AI, câte un indiciu scurt pentru fiecare (fără răspuns, fără litera
// corectă), apoi îl servește tuturor elevilor din app_settings 'indicii:<id>'
// (fără SQL nou — ca 'pagina2:<id>' și 'lectie:…'). Fișierul testului rămâne
// neatins; dacă testul se înlocuiește (alt file_url), indiciile se refac.
//   cheile: c<k>    = al k-lea card-grilă din pagină (ordinea din DOM, numărând TOATE
//                     cardurile; puntea verifică numărul lor și începutul enunțului);
//           p<i>s<j> = PROBS[i].steps[j].
//   obtine(supa, contentId)  — din cache, sau generate acum (o singură generare
//                              odată: marcajul „generare"; ceilalți reîncearcă);
//   processBatch(supa)       — cronul (api/ai-ingest.js): câteva teste de EN pe
//                              rulare, ca indiciile să fie gata înainte de elevi.
// Puntea (src/lib/tutorBridge.js) le pune în pagină: „💡 Arată indiciile" la fiecare
// card-grilă și la pasul deschis, ca la BAC. Ruta: api/indicii.js.
// =====================================================================
const ai = require('./ai');
const SET = require('./settings');

const PREFIX = 'indicii:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = process.env.AI_INDICII_MODEL || ai.PDF_MODEL;      // conținut canonic, servit la mulți elevi
const PE_APEL = 16;                     // exerciții pe un apel la model
const PARALEL = 3;                      // apeluri în paralel (un test EN: ~40 de exerciții → 3 apeluri)
const MARCAJ_MS = 4 * 60 * 1000;        // „generare" mai vechi de atât = generare întreruptă
const ESEC_MS = 30 * 60 * 1000;         // după un eșec, reîncercăm peste 30 de minute
const LOT = parseInt(process.env.AI_INDICII_BATCH || '2', 10);
const dezactivat = () => process.env.AI_INDICII_DISABLED === '1';

function eroare(status, msg) { const e = new Error(msg); e.status = status; return e; }

// ─── Valori JS: tablouri / obiecte cu chei fără ghilimele, stringuri cu ' ────
// Doar DATE (ca în `var EX1 = [{q:'…', a:'…', ok:'b'}]`); orice altceva (funcții,
// expresii, `${…}`) aruncă eroare. Nu execută nimic din fișier.
function parseJs(s, start) {
  let i = start;
  const n = s.length;
  function ws() {
    for (;;) {
      while (i < n && /\s/.test(s[i])) i++;
      if (s[i] === '/' && s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; continue; }
      if (s[i] === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); if (e < 0) throw new Error('comentariu neînchis'); i = e + 2; continue; }
      return;
    }
  }
  function str() {
    const q = s[i++];
    let out = '';
    while (i < n) {
      const c = s[i++];
      if (c === q) return out;
      if (q === '`' && c === '$' && s[i] === '{') throw new Error('șablon cu expresii');
      if (c === '\\') {
        const d = s[i++];
        if (d === 'n') out += '\n';
        else if (d === 't') out += '\t';
        else if (d === 'r') out += '\r';
        else if (d === 'b') out += '\b';
        else if (d === 'f') out += '\f';
        else if (d === 'v') out += '\v';
        else if (d === '0' && !/[0-9]/.test(s[i] || '')) out += '\0';
        else if (d === 'x') { out += String.fromCharCode(parseInt(s.substr(i, 2), 16)); i += 2; }
        else if (d === 'u') {
          if (s[i] === '{') { const e = s.indexOf('}', i); out += String.fromCodePoint(parseInt(s.slice(i + 1, e), 16)); i = e + 1; }
          else { out += String.fromCharCode(parseInt(s.substr(i, 4), 16)); i += 4; }
        } else if (d === '\r') { if (s[i] === '\n') i++; }            // continuare de rând
        else if (d === '\n' || d === ' ' || d === ' ') { /* continuare de rând */ }
        else out += d;
        continue;
      }
      if (c === '\n' && q !== '`') throw new Error('rând nou în string');
      out += c;
    }
    throw new Error('string neînchis');
  }
  function val() {
    ws();
    const c = s[i];
    if (c === '[') {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (s[i] === ']') { i++; return a; }
        a.push(val());
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return a; }
        throw new Error('tablou');
      }
    }
    if (c === '{') {
      i++;
      const o = {};
      for (;;) {
        ws();
        if (s[i] === '}') { i++; return o; }
        let k;
        if (s[i] === '"' || s[i] === "'") k = str();
        else {
          const m = /^(?:[A-Za-z_$][\w$]*|\d+)/.exec(s.slice(i, i + 80));
          if (!m) throw new Error('cheie');
          k = m[0]; i += k.length;
        }
        ws();
        if (s[i] !== ':') throw new Error('lipsește „:”');
        i++;
        o[k] = val();
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return o; }
        throw new Error('obiect');
      }
    }
    if (c === '"' || c === "'" || c === '`') return str();
    const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i, i + 40));
    if (m) { i += m[0].length; return Number(m[0]); }
    for (const [w, v] of [['true', true], ['false', false], ['null', null], ['undefined', undefined]]) {
      if (s.startsWith(w, i) && !/[\w$]/.test(s[i + w.length] || '')) { i += w.length; return v; }
    }
    throw new Error('valoare necunoscută');
  }
  const value = val();
  return { value, end: i };
}

// porțiunile <script>/<style> (cardurile „statice" nu se caută acolo)
function zone(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
  let m;
  while ((m = re.exec(html))) out.push([m.index, m.index + m[0].length]);
  return out;
}
const inZona = (at, zs) => zs.some(([a, b]) => at >= a && at < b);

// tabloul din `var|let|const NUME = [ … ]` (null dacă lipsește sau nu e doar date)
function tablouDupa(html, nume) {
  const re = new RegExp(`\\b(?:var|let|const)\\s+${nume}\\s*=\\s*\\[`, 'g');
  const m = re.exec(html);
  if (!m) return null;
  try {
    const { value } = parseJs(html, m.index + m[0].length - 1);
    return Array.isArray(value) ? value : null;
  } catch { return null; }
}

// ─── Text ────────────────────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', minus: '−', times: '×', divide: '÷', deg: '°', hellip: '…', ndash: '–', mdash: '—', bdquo: '„', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', le: '≤', ge: '≥', ne: '≠', infin: '∞', radic: '√', pi: 'π', ang: '∠', perp: '⊥', isin: '∈' };
function entitati(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const v = ENT[e.toLowerCase()];
    return v != null ? v : m;
  });
}

// HTML-ul unui enunț → text (formulele LaTeX rămân cum sunt)
function textSimplu(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' [figură] ');
  for (let k = 0; k < 3; k++) {
    s = s.replace(/<span class="frac">\s*<span class="num">([\s\S]*?)<\/span>\s*<span class="den">([\s\S]*?)<\/span>\s*<\/span>/gi, '($1)/($2)');
  }
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li|tr|h\d)>/gi, ' ').replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<sup>([\s\S]*?)<\/sup>/gi, '^($1)').replace(/<sub>([\s\S]*?)<\/sub>/gi, '_($1)');
  s = s.replace(/<[^>]+>/g, '');
  s = entitati(s);
  s = s.replace(/\[([^|\][]+)\|([^|\][]+)\]/g, '($1)/($2)');    // fracțiile [a|b] din șabloanele de BAC
  return s.replace(/\s+/g, ' ').trim();
}

const doarLitere = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// Începutul enunțului, doar litere, până la prima formulă (în pagină formulele se
// randează altfel) — puntea verifică cu el că indiciul ajunge la cardul potrivit.
function amprenta(html) {
  let s = textSimplu(html);
  const taie = s.search(/\\\(|\\\[|\$/);
  if (taie >= 0) s = s.slice(0, taie);
  return doarLitere(s).slice(0, 24);
}

// ─── Exercițiile testului ────────────────────────────────────────────────────
const RE_CARD = /<div\s+class="card(?:\s[^"]*)?"[^>]*>/gi;
const RE_PROPRIU = /btn-hint|hintBtn|mt-indicatie|class="hint\b/i;

function carduriStatice(html, scripturi) {
  const starturi = [];
  let m;
  RE_CARD.lastIndex = 0;
  while ((m = RE_CARD.exec(html))) {
    if (!inZona(m.index, scripturi)) starturi.push({ at: m.index, tag: m[0], dupa: m.index + m[0].length });
  }
  const out = [];
  for (let k = 0; k < starturi.length; k++) {
    const a = starturi[k];
    const b = k + 1 < starturi.length ? starturi[k + 1].at : html.length;
    let seg = html.slice(a.dupa, b);
    const stop = seg.search(/<div class="sec-title"|<script\b|<!--\s*=+/i);
    if (stop >= 0) seg = seg.slice(0, stop);
    if (!/class="opt\b/.test(seg)) continue;                       // nu e card-grilă
    const q = /class="qtxt"[^>]*>([\s\S]*?)<\/div>/i.exec(seg);
    const tbl = /<table[\s\S]*?<\/table>/i.exec(seg);
    const variante = {};
    const reOpt = /<div class="opt\b[^"]*"[^>]*data-opt="([^"]+)"[^>]*>[\s\S]*?class="otxt"[^>]*>([\s\S]*?)<\/div>/gi;
    let o;
    while ((o = reOpt.exec(seg))) variante[o[1]] = textSimplu(o[2]);
    const ex = /class="expl"[^>]*>([\s\S]*)$/i.exec(seg);
    out.push({
      at: a.at,
      enunt: q ? q[1] : '',
      tabel: tbl ? tbl[0] : '',
      variante,
      corect: (/data-correct="([^"]*)"/i.exec(a.tag) || [])[1] || '',
      explicatie: ex ? ex[1] : '',
      propriu: RE_PROPRIU.test(seg),
    });
  }
  return out;
}

function cardDinEx(ex) {
  const e = ex && typeof ex === 'object' ? ex : {};
  const areCD = e.c !== undefined && e.c !== null && e.c !== '';
  const variante = {};
  for (const k of (areCD ? ['a', 'b', 'c', 'd'] : ['a', 'b'])) variante[k] = textSimplu(e[k]);
  return {
    enunt: String(e.q || ''),
    tabel: String(e.tbl || ''),
    variante,
    corect: String(e.ok || ''),
    explicatie: String(e.e || e.expl || ''),
    propriu: !!(e.h || e.hint || e.indiciu),
  };
}

// Cardurile din #exList1, #exList2… (randate din EX1, EX2…) — null dacă există o
// listă al cărei tablou nu-l putem citi (ordinea cardurilor din pagină n-ar mai fi sigură)
function carduriDinListe(html, scripturi) {
  const out = [];
  const re = /<div\s+id="exList(\d+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (inZona(m.index, scripturi)) continue;
    const arr = tablouDupa(html, `EX${m[1]}`);
    if (!arr) return null;
    arr.forEach((ex, j) => out.push({ at: m.index + j / 1000, ...cardDinEx(ex) }));
  }
  return out;
}

function raspunsPas(s) {
  const u = s.u ? ` ${s.u}` : '';
  if (s.t === 'mc' && Array.isArray(s.o)) return textSimplu(s.o[s.ci]);
  if (s.t === 'calc') return `${Array.isArray(s.c) ? textSimplu(s.c[s.ci]) : ''} = ${s.a}${u}`.trim();
  if (s.t === 'tf') return `${s.ok ? 'ADEVĂRAT' : 'FALS'}${s.just ? ` — ${textSimplu(s.just)}` : ''}`;
  if (s.a !== undefined && s.a !== null) return `${s.a}${u}`;
  return '';
}

function pasiDinProbs(html) {
  const P = tablouDupa(html, 'PROBS');
  if (!P) return [];
  const out = [];
  P.forEach((p, i) => {
    if (!p || typeof p !== 'object' || !Array.isArray(p.steps)) return;
    const req = Array.isArray(p.req) ? p.req : null;
    p.steps.forEach((s, j) => {
      if (!s || typeof s !== 'object') return;
      const parte = String(s.p || '').trim().toLowerCase();
      let cerinta = '';
      if (parte && p[`q${parte}`]) cerinta = p[`q${parte}`];
      else if (req) {
        const idx = parte ? parte.charCodeAt(0) - 97 : -1;
        cerinta = idx >= 0 && req[idx] ? req[idx] : req.join(' ');
      }
      const variante = s.t === 'mc' && Array.isArray(s.o) ? s.o : (s.t === 'calc' && Array.isArray(s.c) ? s.c : null);
      out.push({
        id: `p${i}s${j}`,
        tip: 'pas',
        problema: textSimplu(p.lead || p.enunt || ''),
        cerinta: textSimplu(cerinta),
        pas: textSimplu(s.d || ''),
        variante: variante ? variante.map(textSimplu) : null,
        corect: raspunsPas(s),
        _s: s,
        propriu: !!String(s.help || '').trim(),
      });
    });
  });
  return out;
}

// Toate exercițiile, cu cheile punții. `nc` = câte carduri-grilă are pagina (null =
// nu putem fi siguri de ordinea lor → fără indicii la carduri).
function itemiDinHtml(html) {
  const s = String(html || '');
  const scripturi = zone(s, 'script').concat(zone(s, 'style'));
  const liste = carduriDinListe(s, scripturi);
  let carduri = [];
  let nc = null;
  if (liste) {
    carduri = liste.concat(carduriStatice(s, scripturi)).sort((a, b) => a.at - b.at)
      .map((c, k) => ({
        id: `c${k + 1}`, tip: 'grila',
        enunt: textSimplu(c.enunt), tabel: textSimplu(c.tabel),
        variante: c.variante, corect: c.corect, explicatie: textSimplu(c.explicatie),
        fp: amprenta(c.enunt), propriu: c.propriu,
      }));
    nc = carduri.length;
  }
  return { carduri, pasi: pasiDinProbs(s), nc };
}

// ─── Verificarea unui indiciu (nimic din răspuns) ────────────────────────────
const normRez = (t) => String(t || '').toLowerCase()
  .replace(/\\[a-z]+/g, ' ').replace(/[\s{}()[\]\\$,.;:]+/g, '');
function rezultate(it) {
  if (it.tip === 'grila') return [it.variante && it.variante[it.corect]];
  const s = it._s || {};
  if (s.t === 'mc' && Array.isArray(s.o)) return [textSimplu(s.o[s.ci])];
  if (s.t === 'calc') return [String(s.a), Array.isArray(s.c) ? textSimplu(s.c[s.ci]) : ''];
  if (s.t === 'num' || (s.a !== undefined && s.a !== null && s.t !== 'tf')) return [String(s.a)];
  return [];
}
function contextul(it) {
  return it.tip === 'grila' ? `${it.enunt} ${it.tabel}` : `${it.problema} ${it.cerinta} ${it.pas}`;
}

function curataIndiciu(text, it) {
  let s = String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 12 || s.length > 420) return null;
  if (/r[ăa]spuns(ul)?\s+(corect|bun|final)|varianta\s+(corect|bun)|\bbarem/i.test(s)) return null;
  if (/\b(litera|varianta|r[ăa]spunsul)\s+[a-d]\b|\b[a-d]\)\s*(este|e)\s+(corect|bun)/i.test(s)) return null;
  if (it.tip === 'pas' && it._s && it._s.t === 'tf' && /\b(este|e)\s+(adev[ăa]rat|fals)/i.test(s)) return null;
  const ctx = normRez(contextul(it));
  const tn = normRez(s);
  for (const r of rezultate(it)) {
    const rr = normRez(r);
    if (rr.length >= 2 && !ctx.includes(rr) && tn.includes(rr)) return null;   // rezultatul, pe față
  }
  return s;
}

// ─── Scrierea indiciilor ─────────────────────────────────────────────────────
const SISTEM = `Ești profesor de matematică (Evaluare Națională, Bacalaureat) și scrii INDICII pentru elevi, la exercițiile unui test interactiv.
Pentru FIECARE exercițiu primit scrii UN indiciu:
- 1–2 propoziții scurte (cel mult ~220 de caractere), în limba română, cu diacritice (ș, ț);
- arată de unde pornește elevul: noțiunea, formula sau primul pas; poți încheia cu o întrebare care îl ghidează;
- NU dai rezultatul, NU spui litera sau varianta corectă, NU elimini variante, NU faci calculul până la capăt;
- nu repeta enunțul; nu folosi cuvintele „barem" sau „răspunsul corect";
- formulele în LaTeX inline, \\( ... \\), ca în enunț; fără Markdown, fără HTML.
Răspunsul corect și explicația oficială le primești DOAR ca să știi metoda — nu le copia și nu le dezvălui.
Răspunde STRICT cu JSON: { "indicii": [ { "id": "<id-ul primit>", "indiciu": "<textul>" } ] } — câte unul pentru fiecare id primit.`;

const SCHEMA = ai.S.obj({ indicii: ai.S.arr(ai.S.obj({ id: ai.S.str('id-ul exercițiului, exact cum a fost primit'), indiciu: ai.S.str('indiciul, fără răspuns') })) });

function pentruModel(it) {
  if (it.tip === 'grila') {
    return { id: it.id, tip: 'grilă', enunt: it.enunt, ...(it.tabel ? { tabel: it.tabel } : {}), variante: it.variante, raspuns_corect: `${it.corect}) ${(it.variante || {})[it.corect] || ''}`.trim(), explicatie_oficiala: it.explicatie.slice(0, 900) };
  }
  return { id: it.id, tip: 'pas de rezolvare', problema: it.problema.slice(0, 900), cerinta: it.cerinta, pasul: it.pas, ...(it.variante ? { variante: it.variante } : {}), raspuns_corect: it.corect };
}

async function scrieIndicii(itemi, { model = MODEL, chat = ai.chatJson } = {}) {
  const loturi = [];
  for (let k = 0; k < itemi.length; k += PE_APEL) loturi.push(itemi.slice(k, k + PE_APEL));
  const h = {};
  const usage = { in: 0, out: 0, model };
  let urm = 0;
  async function lucreaza() {
    while (urm < loturi.length) {
      const lot = loturi[urm++];
      const dupaId = new Map(lot.map((it) => [it.id, it]));
      const r = await chat({
        system: SISTEM, schema: SCHEMA, schemaName: 'indicii', model, temperature: 0.3, maxTokens: 2500, reasoningEffort: 'low',
        messages: [{ role: 'user', content: `Exercițiile (JSON):\n${JSON.stringify(lot.map(pentruModel))}` }],
      });
      if (r && r.usage) { usage.in += r.usage.in || 0; usage.out += r.usage.out || 0; }
      const lista = r && r.data && Array.isArray(r.data.indicii) ? r.data.indicii : [];
      for (const x of lista) {
        const it = x && dupaId.get(String(x.id || ''));
        if (!it || h[it.id]) continue;
        const t = curataIndiciu(x.indiciu, it);
        if (t) h[it.id] = t;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALEL, loturi.length) }, lucreaza));
  return { h, usage };
}

// ─── Cache + generare ────────────────────────────────────────────────────────
function raspuns(v) {
  return { ok: true, stare: 'gata', h: v.h || {}, nc: v.nc == null ? null : v.nc, fp: v.fp || {} };
}

// Marcajul „generare" — un singur proces scrie indiciile unui test odată
async function iaMarcajul(supa, key, st, marcaj) {
  const exista = st.value != null || st.updatedAt != null;
  if (!exista) {
    const { data, error } = await supa.from(SET.TABLE).insert({ key, value: marcaj, updated_at: marcaj.at }).select('key');
    return !error && Array.isArray(data) && data.length > 0;
  }
  return SET.updateSettingIf(supa, key, marcaj, st.updatedAt);
}

async function obtine(supa, contentId, { genereaza = true, incarcaHtml = null, chat = ai.chatJson } = {}) {
  const id = String(contentId || '');
  if (!UUID.test(id)) throw eroare(400, 'Testul lipsește.');
  const { data: c, error } = await supa.from('content').select('id, category, content_type, file_url').eq('id', id).maybeSingle();
  if (error) throw eroare(500, error.message);
  if (!c || c.content_type !== 'interactive' || !c.file_url) throw eroare(404, 'Testul nu a fost găsit.');
  const key = PREFIX + c.id;
  const st = await SET.readSetting(supa, key);
  if (!st.setup) return { ok: true, stare: 'nimic' };
  const v = st.value && typeof st.value === 'object' ? st.value : null;
  const acum = Date.now();
  if (v && v.file_url === c.file_url) {
    if (v.stare === 'gata') return raspuns(v);
    if (v.stare === 'nimic') return { ok: true, stare: 'nimic' };
    if (v.stare === 'esuat' && acum - Date.parse(v.at || 0) < ESEC_MS) return { ok: true, stare: 'nimic' };
  }
  if (v && v.stare === 'generare' && acum - Date.parse(v.at || 0) < MARCAJ_MS) return { ok: true, stare: 'generare' };
  if (!genereaza || dezactivat() || (!incarcaHtml && !ai.hasChat())) return { ok: true, stare: 'nimic' };

  const marcaj = { v: 1, stare: 'generare', file_url: c.file_url, at: new Date().toISOString() };
  if (!(await iaMarcajul(supa, key, st, marcaj))) return { ok: true, stare: 'generare' };
  try {
    const html = incarcaHtml ? await incarcaHtml(c) : await require('./score').loadContentHtml(supa, c);
    if (!html) throw new Error('fișierul testului nu s-a putut citi');
    const { carduri, pasi, nc } = itemiDinHtml(html);
    const fara = carduri.filter((x) => !x.propriu).concat(pasi.filter((x) => !x.propriu));
    if (!fara.length) {
      await SET.writeSetting(supa, key, { v: 1, stare: 'nimic', file_url: c.file_url, at: new Date().toISOString() });
      return { ok: true, stare: 'nimic' };
    }
    const { h, usage } = await scrieIndicii(fara, { chat });
    try { await ai.logUsage(supa, null, 'ai-indicii-test', usage); } catch { /* doar evidența costului */ }
    const fp = {};
    for (const x of carduri) if (h[x.id] && x.fp) fp[x.id] = x.fp;
    const n = Object.keys(h).length;
    const val = n
      ? { v: 1, stare: 'gata', file_url: c.file_url, model: MODEL, at: new Date().toISOString(), nc, fp, h, n, din: fara.length }
      : { v: 1, stare: 'esuat', file_url: c.file_url, at: new Date().toISOString(), err: 'niciun indiciu valid' };
    await SET.writeSetting(supa, key, val);
    return n ? raspuns(val) : { ok: true, stare: 'nimic' };
  } catch (e) {
    try { await SET.writeSetting(supa, key, { v: 1, stare: 'esuat', file_url: c.file_url, at: new Date().toISOString(), err: String(e.message || e).slice(0, 300) }); } catch { /* ignore */ }
    console.warn('indicii: %s — %s', id, e.message);
    return { ok: true, stare: 'nimic' };
  }
}

// ─── Cronul: testele de EN fără indicii, câteva pe rulare ────────────────────
async function processBatch(supa, limit = LOT) {
  if (dezactivat()) return { generate: 0, note: 'AI_INDICII_DISABLED=1' };
  if (!ai.hasChat()) return { generate: 0, note: 'fără cheie LLM' };
  const { data: teste, error } = await supa.from('content').select('id, file_url, created_at')
    .eq('category', 'evaluare-nationala').eq('content_type', 'interactive')
    .order('created_at', { ascending: false }).limit(1000);
  if (error) return { generate: 0, note: error.message };
  const { data: rows, error: e2 } = await supa.from(SET.TABLE)
    .select('key, file_url:value->>file_url, stare:value->>stare, at:value->>at').like('key', `${PREFIX}%`);
  if (e2) return { generate: 0, note: e2.message };
  const dupa = new Map((rows || []).map((r) => [String(r.key).slice(PREFIX.length), r]));
  const acum = Date.now();
  const lipsa = (teste || []).filter((t) => {
    const r = dupa.get(t.id);
    if (!r) return true;
    if (r.stare === 'generare') return acum - Date.parse(r.at || 0) >= MARCAJ_MS;
    if (r.file_url !== t.file_url) return true;
    return r.stare === 'esuat' && acum - Date.parse(r.at || 0) >= ESEC_MS;
  });
  let generate = 0;
  for (const t of lipsa.slice(0, Math.max(0, limit))) {
    try { const r = await obtine(supa, t.id); if (r.stare === 'gata') generate++; }
    catch (e) { console.warn('indicii în cron: %s — %s', t.id, e.message); }
  }
  return { generate, ramase: Math.max(0, lipsa.length - limit) };
}

module.exports = {
  PREFIX, parseJs, tablouDupa, textSimplu, amprenta, itemiDinHtml, curataIndiciu, scrieIndicii, obtine, processBatch,
};
