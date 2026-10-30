// =====================================================================
// api/_lib/examBotNet.js — 🤖 BOTUL DE EXAMENE: rețeaua (politicos și sigur)
//
//   · `Net` — cererile botului: se prezintă (User-Agent „ExamenMateBot"),
//     RESPECTĂ robots.txt-ul fiecărui site (un site care nu vrea roboți e sărit,
//     iar raportul spune asta), așteaptă între două cereri pe același site,
//     are un plafon de cereri pe rulare, limite de mărime (PDF ≤ 30 MB) și
//     refuză adresele interne (localhost, rețele private — paginile urmărite le
//     scrie adminul, dar o adresă greșită nu are voie să lovească serverul);
//   · sursele: edupedu.ro (WordPress: API-ul /wp-json, apoi RSS-ul căutării,
//     apoi pagina de căutare, plus etichetele urmărite), subiecte.edu.ro și
//     edu.ro (paginile pe ani, dacă robots.txt le permite), paginile urmărite
//     (inspectorate școlare etc.);
//   · căutarea web (opțională): Brave Search, Serper (Google) sau Google
//     Programmable Search — după cheia pusă în Vercel;
//   · căutarea cu AI (opțională, doar la cerere, din Admin): Claude cu unealta
//     web_search propune linkuri — botul le verifică el însuși, ca pe oricare.
// Logica pură (clasificare, extragerea linkurilor): api/_lib/examBot.js.
// =====================================================================
const dnsp = require('node:dns').promises;
const netmod = require('node:net');
const E = require('./examBot');

const UA = 'Mozilla/5.0 (compatible; ExamenMateBot/1.0; +https://examenmate.com/contact)';
const UA_TOKEN = 'examenmatebot';
const EDUPEDU = 'https://www.edupedu.ro';
// etichetele edupedu cu subiectele și baremele de matematică (cele mai noi articole)
const EDUPEDU_TAGS = [
  'subiecte-bac-matematica', 'subiecte-bac-mate-info', 'matematica-bac', 'bareme-matematica',
  'matematica-evaluarea-nationala', 'subiecte-matematica-tehnologic', 'varianta-de-rezerva', 'subiecte-rezerva-bac',
];

// ─── Adrese interne (SSRF) ───────────────────────────────────────────────────
function isPrivateIp(ip) {
  const s = String(ip || '').toLowerCase();
  if (netmod.isIPv4(s)) {
    const [a, b] = s.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (netmod.isIPv6(s)) {
    if (s === '::1' || s === '::') return true;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true;
}

class Net {
  constructor({ maxRequests = 300, hostGapMs = 1200, timeoutMs = 20000, deadline = Infinity, log = () => {}, fetchImpl = null, lookup = null, robots = true } = {}) {
    this.maxRequests = maxRequests;
    this.hostGapMs = hostGapMs;
    this.timeoutMs = timeoutMs;
    this.deadline = deadline;
    this.log = log;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.lookup = lookup || ((host) => dnsp.lookup(host, { all: true }));
    this.useRobots = robots;
    this.count = 0;
    this.byHost = {};          // cereri pe site
    this.last = new Map();     // ultima cerere pe site
    this.robotsCache = new Map();
    this.blocked = new Set();  // site-uri care nu permit roboți (pentru raport)
    this.dnsOk = new Map();
  }

  async guard(url) {
    let u;
    try { u = new URL(url); } catch { return 'adresă invalidă'; }
    if (!/^https?:$/.test(u.protocol)) return 'doar http(s)';
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (/^localhost$|\.local$|\.internal$/i.test(host)) return 'adresă internă';
    if (netmod.isIP(host)) return isPrivateIp(host) ? 'adresă internă' : null;
    if (this.dnsOk.has(host)) return this.dnsOk.get(host);
    let verdict = null;
    try {
      const addrs = await this.lookup(host);
      const list = Array.isArray(addrs) ? addrs : [addrs];
      if (!list.length) verdict = 'domeniu inexistent';
      else if (list.some((a) => isPrivateIp(a.address || a))) verdict = 'adresă internă';
    } catch { verdict = 'domeniu inexistent'; }
    this.dnsOk.set(host, verdict);
    return verdict;
  }

  async robotsAllows(url) {
    if (!this.useRobots) return true;
    const u = new URL(url);
    const origin = u.origin;
    if (!this.robotsCache.has(origin)) {
      let txt = '';
      try {
        const r = await this.raw(`${origin}/robots.txt`, { maxBytes: 512 * 1024, timeoutMs: 10000, robots: false });
        if (r.status >= 200 && r.status < 300) txt = r.buf.toString('utf8');
        else if (r.status >= 500 || r.status === 0) txt = null;     // indisponibil → nu riscăm
        else txt = '';                                              // 4xx → fără reguli
      } catch { txt = null; }
      this.robotsCache.set(origin, txt);
    }
    const txt = this.robotsCache.get(origin);
    if (txt === null) { this.blocked.add(`${u.hostname} (robots.txt indisponibil)`); return false; }
    const ok = E.robotsAllowed(txt, UA_TOKEN, u.pathname + u.search);
    if (!ok) this.blocked.add(u.hostname);
    return ok;
  }

  async pace(host) {
    const prev = this.last.get(host) || 0;
    const wait = prev + this.hostGapMs - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    this.last.set(host, Date.now());
  }

  // o cerere (urmărește redirecționările, verificând fiecare pas)
  async raw(url, { method = 'GET', headers = {}, body = undefined, maxBytes = 3 * 1024 * 1024, timeoutMs = this.timeoutMs, robots = true, pace = true } = {}) {
    let cur = url;
    for (let hop = 0; hop < 6; hop++) {
      if (Date.now() > this.deadline) return { ok: false, status: 0, url: cur, error: 'timpul rulării s-a terminat' };
      if (this.count >= this.maxRequests) return { ok: false, status: 0, url: cur, error: 'plafonul de cereri al rulării' };
      const g = await this.guard(cur);
      if (g) return { ok: false, status: 0, url: cur, error: g };
      if (robots && !(await this.robotsAllows(cur))) return { ok: false, status: 0, url: cur, error: 'robots.txt nu permite' };
      const host = new URL(cur).hostname;
      if (pace) await this.pace(host);
      this.count++;
      this.byHost[host] = (this.byHost[host] || 0) + 1;
      let res;
      try {
        res = await this.fetch(cur, {
          method, body, redirect: 'manual',
          headers: { 'user-agent': UA, 'accept-language': 'ro-RO,ro;q=0.9,en;q=0.5', ...headers },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        return { ok: false, status: 0, url: cur, error: `rețea: ${e.message || e}` };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        try { cur = new URL(res.headers.get('location'), cur).href; } catch { return { ok: false, status: res.status, url: cur, error: 'redirecționare invalidă' }; }
        try { await res.body?.cancel?.(); } catch { /* nimic */ }
        continue;
      }
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      const len = Number(res.headers.get('content-length') || 0);
      if (method === 'HEAD') return { ok: res.ok, status: res.status, url: cur, type, length: len, buf: Buffer.alloc(0) };
      if (len && len > maxBytes) { try { await res.body?.cancel?.(); } catch { /* nimic */ } return { ok: false, status: res.status, url: cur, type, error: `fișier prea mare (${Math.round(len / 1048576)} MB)` }; }
      // citire cu plafon
      const chunks = [];
      let size = 0;
      try {
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maxBytes) { try { await reader.cancel(); } catch { /* nimic */ } return { ok: false, status: res.status, url: cur, type, error: 'fișier prea mare' }; }
            chunks.push(Buffer.from(value));
          }
        } else {
          const ab = await res.arrayBuffer();
          if (ab.byteLength > maxBytes) return { ok: false, status: res.status, url: cur, type, error: 'fișier prea mare' };
          chunks.push(Buffer.from(ab));
        }
      } catch (e) {
        return { ok: false, status: res.status, url: cur, type, error: `citire: ${e.message || e}` };
      }
      return { ok: res.ok, status: res.status, url: cur, type, buf: Buffer.concat(chunks) };
    }
    return { ok: false, status: 0, url: cur, error: 'prea multe redirecționări' };
  }

  async html(url) {
    const r = await this.raw(url, { headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' }, maxBytes: 4 * 1024 * 1024 });
    if (!r.ok) return { ok: false, url: r.url || url, error: r.error || `HTTP ${r.status}` };
    return { ok: true, url: r.url, type: r.type, html: r.buf.toString('utf8') };
  }
  async json(url, { headers = {}, method = 'GET', body, robots = true, pace = true } = {}) {
    const r = await this.raw(url, { method, body, headers: { accept: 'application/json', ...headers }, maxBytes: 10 * 1024 * 1024, robots, pace });
    if (!r.ok) return { ok: false, status: r.status, error: r.error || `HTTP ${r.status}` };
    try { return { ok: true, data: JSON.parse(r.buf.toString('utf8')) }; } catch { return { ok: false, error: 'răspuns care nu e JSON' }; }
  }
  // PDF sau ZIP (octeții) — verifică semnătura, nu doar extensia
  async file(url, { maxBytes = 30 * 1024 * 1024 } = {}) {
    const r = await this.raw(url, { headers: { accept: 'application/pdf,application/zip,application/octet-stream;q=0.9,*/*;q=0.5' }, maxBytes, timeoutMs: 45000 });
    if (!r.ok) return { ok: false, url: r.url || url, error: r.error || `HTTP ${r.status}` };
    const head = r.buf.subarray(0, 5).toString('latin1');
    const kind = head.startsWith('%PDF') ? 'pdf' : head.startsWith('PK') ? 'zip' : null;
    if (!kind) return { ok: false, url: r.url, error: `nu e PDF (${r.type || 'tip necunoscut'})` };
    return { ok: true, url: r.url, kind, buf: r.buf };
  }
  async head(url) {
    const r = await this.raw(url, { method: 'HEAD', timeoutMs: 12000 });
    return { ok: r.ok && (/pdf|octet/.test(r.type || '') || /\.pdf$/i.test(url)), status: r.status, url: r.url, type: r.type, error: r.error };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SURSELE
// ═══════════════════════════════════════════════════════════════════════════
// Căutarea pe edupedu.ro → articole { title, link, date, html|null }
async function edupeduSearch(net, q, { perPage = 20 } = {}) {
  const enc = encodeURIComponent(q);
  // 1) API-ul WordPress (conținutul vine odată cu rezultatele: o singură cerere)
  const api = await net.json(`${EDUPEDU}/wp-json/wp/v2/posts?search=${enc}&per_page=${perPage}&_fields=link,date,title,content`);
  if (api.ok && Array.isArray(api.data)) return { via: 'wp-json', items: E.parseWpPosts(api.data) };
  // 2) RSS-ul căutării
  const rss = await net.html(`${EDUPEDU}/?s=${enc}&feed=rss2`);
  if (rss.ok && /<rss|<feed/i.test(rss.html)) return { via: 'rss', items: E.parseFeed(rss.html) };
  // 3) pagina de căutare (doar linkurile articolelor; conținutul se citește după)
  const page = await net.html(`${EDUPEDU}/?s=${enc}`);
  if (page.ok) {
    const { links } = E.extractLinks(page.html, page.url);
    const items = links
      .filter((l) => /^https:\/\/(www\.)?edupedu\.ro\/[a-z0-9-]{20,}\/?$/.test(l.url) && E.relevantArticle(l.text))
      .map((l) => ({ title: l.text, link: l.url, date: null, html: null }));
    return { via: 'html', items };
  }
  return { via: null, items: [], error: api.error || rss.error || page.error };
}

// Cele mai noi articole din etichetele urmărite (RSS-ul etichetei, altfel pagina ei)
async function edupeduTags(net, tags = EDUPEDU_TAGS) {
  const items = [];
  for (const t of tags) {
    const feed = await net.html(`${EDUPEDU}/tag/${t}/feed/`);
    if (feed.ok && /<rss|<feed/i.test(feed.html)) { items.push(...E.parseFeed(feed.html)); continue; }
    const page = await net.html(`${EDUPEDU}/tag/${t}/`);
    if (!page.ok) continue;
    const { links } = E.extractLinks(page.html, page.url);
    for (const l of links) {
      if (/^https:\/\/(www\.)?edupedu\.ro\/[a-z0-9-]{20,}\/?$/.test(l.url) && E.relevantArticle(l.text)) items.push({ title: l.text, link: l.url, date: null, html: null });
    }
  }
  const seen = new Set();
  return items.filter((x) => (seen.has(x.link) ? false : (seen.add(x.link), true)));
}

// Un articol (HTML-ul lui, dacă nu l-am primit deja din API/RSS)
async function articleLinks(net, item) {
  let html = item.html;
  let title = item.title;
  let date = item.date;
  let url = item.link;
  if (!html) {
    const r = await net.html(item.link);
    if (!r.ok) return { ok: false, error: r.error, links: [] };
    const m = E.pageMeta(r.html);
    html = r.html; url = r.url;
    title = title || m.title; date = date || m.date;
  }
  const { links, guesses } = E.extractLinks(html, url);
  return { ok: true, title, date, url, links, guesses };
}

// Paginile pe ani de pe subiecte.edu.ro (dacă robots.txt le permite)
function subiecteSeeds(years) {
  const out = [];
  for (const y of years) {
    out.push(
      `https://subiecte.edu.ro/${y}/bacalaureat/Subiecte_si_bareme/`,
      `https://subiecte.edu.ro/${y}/bacalaureat/modeledesubiecte/probescrise/`,
      `https://subiecte.edu.ro/${y}/simulare/simulare_bac_XII/`,
      `https://subiecte.edu.ro/${y}/evaluarenationala/`,
      `https://subiecte.edu.ro/${y}/evaluarenationala/modeledesubiecte/`,
      `https://subiecte.edu.ro/${y}/simulare/simulare_en_VIII/`,
    );
  }
  return out;
}
const EDU_RO_PAGES = ['https://edu.ro/modele_subiecte_examene_nationale'];

// Parcurge o pagină (și subpaginile ei, pe același site și sub aceeași cale)
// → fișierele găsite { url, text, pageTitle, pageUrl }
const looksLikePage = (u) => /\/$|\.html?$|\.php$|\/[^./]+$/i.test(new URL(u).pathname);
async function crawl(net, seed, { depth = 2, maxPages = 20, follow = null } = {}) {
  const files = [];
  const seen = new Set();
  const queue = [{ url: seed, d: 0 }];
  let base;
  try { base = new URL(seed); } catch { return { files, pages: 0, error: 'adresă invalidă' }; }
  const prefix = base.pathname.replace(/[^/]*$/, '');
  let pages = 0, firstError = null;
  while (queue.length && pages < maxPages) {
    const { url, d } = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await net.html(url);
    if (!r.ok) { if (!firstError) firstError = r.error; continue; }
    pages++;
    const meta = E.pageMeta(r.html);
    const { links, guesses } = E.extractLinks(r.html, r.url);
    for (const l of links) {
      const ext = E.extOf(E.fileNameFromUrl(l.url));
      if (ext === 'pdf' || ext === 'zip') { files.push({ url: l.url, text: l.text, pageTitle: meta.title || '', pageUrl: r.url, pageDate: meta.date || null }); continue; }
      if (d >= depth) continue;
      let lu;
      try { lu = new URL(l.url); } catch { continue; }
      if (lu.hostname !== base.hostname || !looksLikePage(l.url)) continue;
      const ok = follow ? follow(l, lu) : lu.pathname.startsWith(prefix);
      if (ok && !seen.has(l.url)) queue.push({ url: l.url, d: d + 1 });
    }
    for (const g of guesses) files.push({ url: g, text: '', pageTitle: meta.title || '', pageUrl: r.url, pageDate: meta.date || null, guess: true });
  }
  return { files, pages, error: pages ? null : firstError };
}

// Pagina urmărită (inspectorat etc.): fișierele ei + articolele ei despre subiecte
const RE_PAGINA_UTILA = /matemat|simular|subiect|barem|evaluar|bacalaureat|\bbac\b|antrenament|\ben\s*viii|examen/i;
async function watchPage(net, url) {
  return crawl(net, url, {
    depth: 1, maxPages: 12,
    follow: (l, lu) => RE_PAGINA_UTILA.test(`${l.text} ${decodeURIComponent(lu.pathname)}`),
  });
}

// ─── Căutarea web (opțională) ───────────────────────────────────────────────
function searchProvider() {
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave';
  if (process.env.SERPER_API_KEY) return 'serper';
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) return 'google';
  return null;
}
const SEARCH_LABEL = { brave: 'Brave Search', serper: 'Serper (Google)', google: 'Google Programmable Search' };
// → [{ url, title, snippet }]
async function webSearch(net, q) {
  const p = searchProvider();
  if (!p) return { ok: false, error: 'fără motor de căutare configurat', results: [] };
  const enc = encodeURIComponent(q);
  let r;
  if (p === 'brave') {
    r = await net.json(`https://api.search.brave.com/res/v1/web/search?q=${enc}&country=RO&search_lang=ro&count=20`,
      { headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY }, robots: false, pace: false });
    if (!r.ok) return { ok: false, error: r.error, results: [], provider: p };
    return { ok: true, provider: p, results: ((r.data.web && r.data.web.results) || []).map((x) => ({ url: x.url, title: E.stripTags(x.title || ''), snippet: E.stripTags(x.description || '') })) };
  }
  if (p === 'serper') {
    r = await net.json('https://google.serper.dev/search', {
      method: 'POST', body: JSON.stringify({ q, gl: 'ro', hl: 'ro', num: 20 }),
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'content-type': 'application/json' }, robots: false, pace: false,
    });
    if (!r.ok) return { ok: false, error: r.error, results: [], provider: p };
    return { ok: true, provider: p, results: (r.data.organic || []).map((x) => ({ url: x.link, title: x.title || '', snippet: x.snippet || '' })) };
  }
  r = await net.json(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_KEY)}&cx=${encodeURIComponent(process.env.GOOGLE_CSE_CX)}&q=${enc}&num=10&gl=ro`, { robots: false, pace: false });
  if (!r.ok) return { ok: false, error: r.error, results: [], provider: p };
  return { ok: true, provider: p, results: (r.data.items || []).map((x) => ({ url: x.link, title: x.title || '', snippet: x.snippet || '' })) };
}

// ─── Căutarea cu AI (opțională, la cerere) ──────────────────────────────────
// Claude caută pe web și propune linkuri; botul le descarcă și le verifică el.
const AI_MODEL_DEFAULT = process.env.EXAM_BOT_AI_MODEL || 'claude-sonnet-5-5';
const AI_SEARCH_USD = 0.01;   // 10 $ / 1000 de căutări (platform.claude.com, oct. 2026)
async function aiSearch({ ce = 'barem', descriere, model = AI_MODEL_DEFAULT, maxUses = 4 } = {}) {
  const claude = require('./claude');
  const system = 'Ești asistentul unei platforme românești de pregătire pentru examene. Cauți pe internet fișiere PDF OFICIALE '
    + '(Ministerul Educației, CNPEE, inspectoratele școlare, subiecte.edu.ro, edupedu.ro care republică fișierele oficiale). '
    + 'Nu inventa linkuri: dai doar URL-uri pe care le-ai văzut în rezultatele căutării. Răspunsul final: DOAR JSON.';
  const user = `Caut ${ce === 'barem' ? 'BAREMUL DE EVALUARE ȘI DE NOTARE oficial' : 'SUBIECTUL oficial'} pentru:\n${descriere}\n\n`
    + `Fă cel mult ${maxUses} căutări (în română). Întoarce JSON: {"candidati":[{"url":"link direct spre PDF sau spre pagina care îl conține","de_ce":"o propoziție"}]} — cel mult 6, cele mai probabile întâi.`;
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses, user_location: { type: 'approximate', country: 'RO', timezone: 'Europe/Bucharest' } }];
  let messages = [{ role: 'user', content: user }];
  const usage = {};
  let searches = 0;
  const seen = [];
  let text = '';
  let usedModel = model;
  for (let turn = 0; turn < 3; turn++) {
    const r = await claude.callAdvanced({ system, messages, model, tools, maxTokens: 4000, effort: 'low', thinking: false, cache: false });
    usedModel = r.model || model;
    claude.addUsage(usage, r.data.usage || {});
    searches += Number(r.data.usage?.server_tool_use?.web_search_requests || 0);
    for (const b of r.data.content || []) {
      if (b && b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const x of b.content) if (x && x.url) seen.push({ url: x.url, title: x.title || '' });
    }
    text += claude.textOf(r.data.content);
    if (r.stop !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: r.data.content }];
  }
  const data = claude.extractJson(text) || {};
  const proposed = (Array.isArray(data.candidati) ? data.candidati : []).map((c) => ({ url: String(c.url || ''), why: String(c.de_ce || '').slice(0, 200) }))
    .filter((c) => /^https?:\/\//.test(c.url));
  const costUsd = claude.costUsd(usedModel, usage) + searches * AI_SEARCH_USD;
  return { proposed, seen, searches, costUsd, model: usedModel };
}

module.exports = {
  UA, UA_TOKEN, EDUPEDU, EDUPEDU_TAGS, EDU_RO_PAGES, isPrivateIp, Net,
  edupeduSearch, edupeduTags, articleLinks, subiecteSeeds, crawl, watchPage,
  searchProvider, SEARCH_LABEL, webSearch, aiSearch, AI_MODEL_DEFAULT, AI_SEARCH_USD,
};
