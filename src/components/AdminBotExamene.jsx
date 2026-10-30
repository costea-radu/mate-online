// =====================================================================
// src/components/AdminBotExamene.jsx — Admin → „📚 Bot examene"
//
// Botul caută permanent pe internet subiectele oficiale de matematică (EN, BAC
// Mate-Info / Științele Naturii / Tehnologic: variante date în sesiune,
// rezerve, olimpici, simulări, modele, teste de antrenament) și baremele lor,
// le publică în rubrica potrivită și verifică dacă fiecare subiect de pe site
// are baremul lui (titlu, numele original al fișierului, antet, conținut).
// Fără AI; „🤖 Caută cu AI" e doar un buton opțional, pe un singur subiect.
//
// Aici: raportul (fișiere încărcate · cu barem · fără barem · găsite de bot),
// butoanele (caută acum, verifică baremele, caută baremele lipsă), listele cu
// acțiunile pe fiecare rând (caută / asociază / „nu are barem" / publică /
// respinge) și setările. Serverul: api/exam-bot.js (pași de ~3 minute; pagina
// îi cere pe rând până termină).
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiPost } from '../lib/api';
import { categoryLabel, subcategoryLabel, profileLabel } from '../lib/contentMeta';

const API = '/api/exam-bot';
const pill = (bg, fg) => ({ display: 'inline-block', background: bg, color: fg, borderRadius: 12, padding: '2px 9px', fontSize: '.74rem', fontWeight: 700, whiteSpace: 'nowrap' });
const smallBtn = { background: '#fff', border: '1px solid #dde1e8', borderRadius: 8, padding: '5px 10px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', color: 'var(--navy)', whiteSpace: 'nowrap' };
const linkBtn = { background: 'none', border: 'none', padding: 0, color: 'var(--navy)', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: '.78rem' };
const muted = { fontSize: '.76rem', color: 'var(--text-muted)' };
const rowBox = { display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', padding: '12px 4px', borderBottom: '1px solid #f0f4f8' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const lei = (usd) => `${(Number(usd || 0) * 4.6).toFixed(2).replace('.', ',')} lei`;

const BAREM_ST = {
  ok: { label: '✓ potrivit automat', bg: '#e6f4ea', fg: '#137333' },
  ok_antet: { label: '✓ după antet', bg: '#e6f4ea', fg: '#137333' },
  ok_continut: { label: '✓ după conținut', bg: '#e6f4ea', fg: '#137333' },
  inclus: { label: '✓ inclus în PDF', bg: '#e6f4ea', fg: '#137333' },
  ok_admin: { label: '✓ asociat de tine', bg: '#e8f0fe', fg: '#1a56c4' },
  ok_bot: { label: '🤖 asociat de bot', bg: '#e8f0fe', fg: '#1a56c4' },
  negasit: { label: 'fără barem', bg: '#fce8e6', fg: '#b3261e' },
  ambiguu: { label: 'ambiguu (mai multe)', bg: '#fef7e0', fg: '#8a6d1a' },
  continut_diferit: { label: 'baremul găsit nu se potrivește', bg: '#fdecd8', fg: '#b45309' },
  fara_text: { label: 'PDF fără text (scanat?)', bg: '#f1f3f4', fg: '#5f6368' },
  eroare: { label: 'eroare la citire', bg: '#fce8e6', fg: '#b3261e' },
  este_barem: { label: 'barem', bg: '#f1f3f4', fg: '#5f6368' },
  nu_necesita: { label: 'nu necesită barem', bg: '#f1f3f4', fg: '#5f6368' },
};
const ITEM_ST = {
  nou: { label: 'nou', bg: '#f1f3f4', fg: '#5f6368' },
  publicat: { label: '✓ publicat', bg: '#e6f4ea', fg: '#137333' },
  asteptare: { label: '⏸ de verificat', bg: '#fef7e0', fg: '#8a6d1a' },
  duplicat: { label: '= există deja', bg: '#e8f0fe', fg: '#1a56c4' },
  ignorat: { label: 'ignorat', bg: '#f1f3f4', fg: '#5f6368' },
  respins: { label: '✕ respins', bg: '#fce8e6', fg: '#b3261e' },
  eroare: { label: '⚠ eroare', bg: '#fce8e6', fg: '#b3261e' },
};
const SEARCH_ST = {
  gasit: 'găsit', gasit_asteptare: 'găsit — așteaptă publicarea', negasit_online: 'negăsit online', fara_text: 'PDF fără text',
};
const TIP = { sesiune: 'sesiune', rezerva: 'rezervă', speciala: 'olimpici', simulare: 'simulare', model: 'model', antrenament: 'antrenament' };
const SURSA = { edupedu: 'edupedu.ro', 'subiecte.edu.ro': 'subiecte.edu.ro', 'edu.ro': 'edu.ro', pagina: 'pagină urmărită', cautare: 'căutare web', ai: 'AI', ghicit: 'nume oficial', arhiva: 'arhivă .zip', bot: 'bot' };
const KIND_LABEL = { descoperire: '🔎 Căutare online', verificare: '✅ Verificarea baremelor', bareme: '🔍 Baremele lipsă' };

function rubrica(r) {
  return [categoryLabel(r.category), r.subcategory ? subcategoryLabel(r.category, r.subcategory) : null, r.profile ? profileLabel(r.profile) : null].filter(Boolean).join(' · ');
}
function clsText(c) {
  if (!c || !c.exam) return 'neclasificat';
  const ex = c.exam === 'en' ? 'EN' : `BAC ${c.profile ? profileLabel(c.profile) || c.profile : '?'}`;
  return [ex, c.year, c.tip ? TIP[c.tip] : null, c.judet, c.luna, c.variant ? `var. ${c.variant}` : null, c.isBarem ? 'BAREM' : 'subiect'].filter(Boolean).join(' · ');
}
function evidenceText(raw) {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw);
    const bits = [];
    if (e.titlu) bits.push(`titlu: ${e.titlu}`);
    if (e.fisier) bits.push(`fișier: ${e.fisier}`);
    if (e.antet) bits.push(`antet: ${e.antet === 'match' ? 'la fel' : e.antet === 'unknown' ? 'neclar' : 'diferit'}`);
    if (e.continut != null) bits.push(`conținut: ${Math.round(e.continut * 100)}%`);
    return bits.join(' · ');
  } catch { return String(raw); }
}

function Tile({ icon, label, value, sub, tone = 'navy', onClick }) {
  const colors = { navy: 'var(--navy)', green: '#137333', red: '#b3261e', amber: '#8a6d1a', blue: '#1a56c4' };
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{ textAlign: 'left', background: '#f7f9fc', border: '1px solid #e6eaf0', borderRadius: 12, padding: '12px 14px', cursor: onClick ? 'pointer' : 'default', minWidth: 0 }}>
      <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#5a6170', textTransform: 'uppercase', letterSpacing: '.04em' }}>{icon} {label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: colors[tone] || colors.navy, lineHeight: 1.2, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ ...muted, marginTop: 2 }}>{sub}</div>}
    </button>
  );
}

// ─── Setările ─────────────────────────────────────────────────────────────────
function Setari({ s, value, onSaved, onClose }) {
  const [f, setF] = useState(() => ({ ...value, pagesText: (value.pages || []).join('\n'), domainsText: (value.domains || []).join('\n') }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setIn = (grp, k, v) => setF((x) => ({ ...x, [grp]: { ...x[grp], [k]: v } }));
  const chk = (label, checked, onChange, hint) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '.86rem', marginBottom: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>{label}{hint && <span style={{ ...muted, display: 'block' }}>{hint}</span>}</span>
    </label>
  );
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const value2 = { ...f, pages: f.pagesText, domains: f.domainsText };
      delete value2.pagesText; delete value2.domainsText;
      const r = await apiPost(API, { action: 'settings', value: value2 });
      onSaved(r.settings);
      setMsg({ type: 'success', text: 'Setările s-au salvat.' });
    } catch (e) { setMsg({ type: 'error', text: e.message }); } finally { setBusy(false); }
  }
  return (
    <div style={{ border: '1px solid #e6eaf0', borderRadius: 12, padding: 16, marginTop: 14, background: '#fbfcfe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ color: 'var(--navy)' }}>⚙ Setările botului</strong>
        <button type="button" style={smallBtn} onClick={onClose}>✕ Închide</button>
      </div>
      {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
        <div>
          <div style={s.label}>Cum lucrează</div>
          {chk('Rulează singur (cron, la 2 ore)', f.enabled, (v) => set('enabled', v), 'Caută online zilnic; în perioadele de examen (simulări, sesiuni, modele), la câteva ore.')}
          {chk('Publică singur ce e sigur', f.autoPublish, (v) => set('autoPublish', v), 'Sigur = antetul PDF-ului oficial recunoscut (examen, an, profil, fel), în română. Restul așteaptă la „Găsite de bot".')}
          {chk('Un singur anunț în clopoțel pentru materialele noi', f.announce, (v) => set('announce', v))}
          <label style={{ ...s.label, marginTop: 6 }}>Acces la materialele noi</label>
          <select style={s.select} value={f.isFree ? 'free' : 'premium'} onChange={(e) => set('isFree', e.target.value === 'free')}>
            <option value="free">🟢 Gratuite</option>
            <option value="premium">⭐ Premium</option>
          </select>
        </div>
        <div>
          <div style={s.label}>Ce caută</div>
          {chk('Evaluarea Națională (clasa a VIII-a)', f.exams?.en, (v) => setIn('exams', 'en', v))}
          {chk('BAC Mate-Info', f.exams?.['mate-info'], (v) => setIn('exams', 'mate-info', v))}
          {chk('BAC Științele Naturii', f.exams?.['stiinte-naturii'], (v) => setIn('exams', 'stiinte-naturii', v))}
          {chk('BAC Tehnologic', f.exams?.tehnologic, (v) => setIn('exams', 'tehnologic', v))}
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <label style={{ flex: 1, fontSize: '.8rem' }}>Subiectele oficiale de la anul
              <input type="number" style={{ ...s.input, padding: '6px 10px' }} value={f.minYear} min={2005} max={2100} onChange={(e) => set('minYear', e.target.value)} />
            </label>
            <label style={{ flex: 1, fontSize: '.8rem' }}>Simulări județene / teste ISJ: ultimii … ani
              <input type="number" style={{ ...s.input, padding: '6px 10px' }} value={f.isjYears} min={1} max={10} onChange={(e) => set('isjYears', e.target.value)} />
            </label>
          </div>
        </div>
        <div>
          <div style={s.label}>Unde caută</div>
          {chk('edupedu.ro (republică fișierele oficiale)', f.sources?.edupedu, (v) => setIn('sources', 'edupedu', v))}
          {chk('subiecte.edu.ro (dacă robots.txt permite)', f.sources?.subiecte, (v) => setIn('sources', 'subiecte', v))}
          {chk('edu.ro — modelele de subiecte', f.sources?.eduRo, (v) => setIn('sources', 'eduRo', v))}
          {chk('Paginile urmărite (mai jos)', f.sources?.pagini, (v) => setIn('sources', 'pagini', v))}
          {chk('Căutarea web (Brave / Serper / Google, dacă e pusă cheia în Vercel)', f.sources?.cautare, (v) => setIn('sources', 'cautare', v), 'Cronul caută pe web o dată pe zi (8 căutări); „🔎 Caută acum online", oricând.')}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginTop: 6 }}>
        <label style={{ fontSize: '.8rem' }}>Pagini urmărite (inspectorate școlare etc.) — câte una pe rând
          <textarea style={{ ...s.textarea, minHeight: 80 }} value={f.pagesText} onChange={(e) => set('pagesText', e.target.value)} placeholder="https://sbisj.ro/Noutati/" />
        </label>
        <label style={{ fontSize: '.8rem' }}>Domenii acceptate în plus (pe lângă edu.ro, ISJ-uri, edupedu.ro)
          <textarea style={{ ...s.textarea, minHeight: 80 }} value={f.domainsText} onChange={(e) => set('domainsText', e.target.value)} placeholder="isjcj.ro" />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
        {[['intervalHours', 'Căutare online la … ore', 1, 336], ['seasonHours', 'În perioadele de examen, la … ore', 1, 48], ['maxNewPerRun', 'Fișiere noi pe rulare (max.)', 1, 300], ['maxBaremSearchPerRun', 'Bareme lipsă căutate pe rulare (cron)', 0, 100]].map(([k, label, min, max]) => (
          <label key={k} style={{ flex: '1 1 160px', fontSize: '.8rem' }}>{label}
            <input type="number" style={{ ...s.input, padding: '6px 10px' }} value={f[k]} min={min} max={max} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
      </div>
      <button type="button" style={{ ...s.btnPrimary, marginTop: 12 }} disabled={busy} onClick={save}>{busy ? 'Se salvează…' : '💾 Salvează setările'}</button>
    </div>
  );
}

// ─── Asocierea manuală: baremele de pe site, verificate pe conținut ───────────
function Asociaza({ contentId, onDone }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    let alive = true;
    apiPost(API, { action: 'candidates', contentId }).then((r) => alive && setData(r)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [contentId]);
  async function lega(baremId) {
    setBusy(baremId);
    try { await apiPost(API, { action: 'associate', contentId, baremId }); onDone(); } catch (e) { setErr(e.message); setBusy(null); }
  }
  return (
    <div style={{ width: '100%', background: '#f7f9fc', border: '1px solid #e6eaf0', borderRadius: 10, padding: 12, marginTop: 6 }}>
      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.84rem', marginBottom: 6 }}>🔗 Alege baremul (verificat de bot: titlu, fișier, antet, conținut)</div>
      {err && <div style={{ color: '#b3261e', fontSize: '.8rem' }}>{err}</div>}
      {!data && !err && <div style={muted}>Citesc baremele compatibile…</div>}
      {data && !data.candidates.length && <div style={muted}>Pe site nu există bareme la acest examen.</div>}
      {data && data.candidates.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #eef1f6' }}>
          <span style={pill(c.ok ? '#e6f4ea' : '#f1f3f4', c.ok ? '#137333' : '#5f6368')}>{c.ok ? '✓ se potrivește' : '✗'}</span>
          <span style={{ flex: '1 1 260px', fontSize: '.84rem' }}>
            <strong>{c.title}</strong>
            <span style={{ ...muted, display: 'block' }}>{[c.describe, c.score != null ? `conținut ${Math.round(c.score * 100)}%` : null, c.ok ? null : c.why].filter(Boolean).join(' · ')}</span>
          </span>
          <button type="button" style={smallBtn} disabled={!!busy} onClick={() => lega(c.id)}>{busy === c.id ? '…' : 'Leagă'}</button>
        </div>
      ))}
    </div>
  );
}

// ─── Publicarea unui fișier „de verificat" (cu rubrica / titlul alese) ────────
function Publica({ s, item, onDone }) {
  const c = item.cls || {};
  const [f, setF] = useState({ exam: c.exam || 'en', profile: c.profile || 'mate-info', tip: c.tip || 'sesiune', year: c.year || '', variant: c.variant || '', isBarem: !!c.isBarem, title: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function go() {
    setBusy(true); setErr(null);
    try {
      const edits = { exam: f.exam, profile: f.exam === 'bac' ? f.profile : null, tip: f.tip, year: String(f.year || ''), variant: String(f.variant || ''), isBarem: f.isBarem };
      if (f.title.trim()) edits.title = f.title.trim();
      await apiPost(API, { action: 'item_publish', itemId: item.id, edits });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  const sel = (k, opts) => (
    <select style={{ ...s.select, padding: '6px 8px', width: 'auto' }} value={f[k]} onChange={(e) => set(k, e.target.value)}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div style={{ width: '100%', background: '#fffdf5', border: '1px solid #f3e3b0', borderRadius: 10, padding: 12, marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '.82rem' }}>
        {sel('exam', [['en', 'Evaluare Națională'], ['bac', 'Bacalaureat']])}
        {f.exam === 'bac' && sel('profile', [['mate-info', 'Mate-Info'], ['stiinte-naturii', 'Științele Naturii'], ['tehnologic', 'Tehnologic']])}
        {sel('tip', Object.entries({ sesiune: 'Variantă din sesiune', rezerva: 'Rezervă', speciala: 'Olimpici (specială)', simulare: 'Simulare', model: 'Model', antrenament: 'Test de antrenament' }))}
        <input style={{ ...s.input, padding: '6px 8px', width: 80 }} value={f.year} onChange={(e) => set('year', e.target.value)} placeholder="an" />
        <input style={{ ...s.input, padding: '6px 8px', width: 90 }} value={f.variant} onChange={(e) => set('variant', e.target.value)} placeholder="varianta" />
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.isBarem} onChange={(e) => set('isBarem', e.target.checked)} /> barem</label>
      </div>
      <input style={{ ...s.input, marginTop: 8 }} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Titlu (gol = titlul automat, bun pentru căutări)" />
      {err && <div style={{ color: '#b3261e', fontSize: '.8rem', marginTop: 6 }}>{err}</div>}
      <button type="button" style={{ ...s.btnPrimary, marginTop: 8, padding: '8px 18px' }} disabled={busy} onClick={go}>{busy ? 'Se publică…' : '✓ Publică pe site'}</button>
    </div>
  );
}

export default function AdminBotExamene({ s }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState('fara');
  const [list, setList] = useState({ rows: [], loading: true });
  const [filter, setFilter] = useState({ category: '', profile: '', q: '' });
  const [running, setRunning] = useState(null);       // { kind, steps, log, progress, finished, error }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [open, setOpen] = useState(null);             // { id, what: 'asociaza' | 'publica' | 'log' }
  const [rowBusy, setRowBusy] = useState({});         // id → text
  const [rowMsg, setRowMsg] = useState({});           // id → { ok, text }
  const [showIgnored, setShowIgnored] = useState(false);
  const stopRef = useRef(false);
  const logRef = useRef(null);

  async function loadStatus() {
    try { setSt(await apiPost(API, { action: 'status' })); setErr(null); } catch (e) { setErr(e.message); }
  }
  // rândurile țin minte lista căreia îi aparțin: la schimbarea filei, până sosesc cele noi,
  // nu desenăm rândurile altei liste (au alte câmpuri)
  async function loadList(v = view) {
    setList((l) => ({ ...l, loading: true }));
    const realView = v === 'gasite' && showIgnored ? 'ignorate_bot' : v;
    try { const r = await apiPost(API, { action: 'list', view: realView, ...filter }); setList({ rows: r.rows || [], total: r.total, loading: false, view: v }); }
    catch (e) { setList({ rows: [], loading: false, error: e.message, view: v }); }
  }
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { loadList(view); }, [view, filter.category, filter.profile, showIgnored]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [running?.log?.length]);

  const c = st?.counts;
  const items = st?.items;
  const setupOk = st?.setup?.tables !== false;

  async function run(kind, extra = {}) {
    if (running && !running.finished) return;
    stopRef.current = false;
    let runId = null, phase = 'cauta', steps = 0;
    setRunning({ kind, steps: 0, log: [], progress: null, finished: false });
    try {
      while (!stopRef.current && steps < 80) {
        const r = await apiPost(API, { action: 'step', kind, runId, phase, ...extra });
        runId = r.runId; steps++;
        setRunning((p) => ({ ...p, runId, steps, log: [...(p?.log || []), ...(r.log || [])].slice(-300), progress: r.progress, total: r.total, blocked: r.blocked }));
        if (r.done) break;
        if (kind === 'descoperire') phase = 'proceseaza';
      }
      if (stopRef.current && runId) await apiPost(API, { action: 'stop', runId }).catch(() => {});
      setRunning((p) => ({ ...p, finished: true, stopped: stopRef.current }));
    } catch (e) {
      setRunning((p) => ({ ...(p || {}), finished: true, error: e.message }));
    }
    loadStatus(); loadList();
  }

  async function rowAction(id, label, body, after) {
    setRowBusy((b) => ({ ...b, [id]: label }));
    setRowMsg((m) => ({ ...m, [id]: null }));
    try {
      const r = await apiPost(API, body);
      if (after) after(r);
    } catch (e) { setRowMsg((m) => ({ ...m, [id]: { ok: false, text: e.message } })); }
    finally { setRowBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  }
  const cautaBarem = (r, useAi = false) => {
    if (useAi && !window.confirm(`Caut baremul pentru „${r.title}" cu AI (Claude + căutare web).\nCost: ~0,1–0,5 lei. Botul verifică el însuși ce propune AI-ul.\n\nContinui?`)) return;
    rowAction(r.content_id, useAi ? '🤖 caută cu AI…' : '🔍 caută…', { action: 'find_barem', contentId: r.content_id, useAi }, (res) => {
      const x = res.result || {};
      setRowMsg((m) => ({ ...m, [r.content_id]: { ok: !!x.found, text: x.found ? (x.pending ? `Găsit (${x.barem?.title || 'barem'}) — așteaptă publicarea în „Găsite de bot".` : `Găsit și legat: ${x.barem?.title || 'barem'}`) : (x.note || 'Negăsit.') } }));
      if (x.found) { loadStatus(); setTimeout(() => loadList(), 1200); }
    });
  };

  const tabs = [
    ['fara', `⚠ Fără barem${c ? ` (${c.faraBarem + c.ambigue + c.faraText + c.erori})` : ''}`],
    ['cu', `✅ Cu barem${c ? ` (${c.cuBarem})` : ''}`],
    ['gasite', `📥 Găsite de bot${items ? ` (${(items.total || 0) - (items.ignorat || 0)})` : ''}`],
    ['bareme', `📋 Bareme${c ? ` (${c.bareme})` : ''}`],
    ['ignorate', `🚫 „Nu are barem"${c ? ` (${c.ignorate})` : ''}`],
    ['altele', '📚 Alte PDF-uri'],
    ['jurnal', '🧾 Jurnal'],
  ];

  const shown = useMemo(() => {
    if (list.view !== view) return [];
    const q = filter.q.trim().toLowerCase();
    if (!q || view === 'jurnal') return list.rows;
    return list.rows.filter((r) => `${r.title || ''} ${r.file_name || ''} ${r.page_title || ''} ${r.describe || ''}`.toLowerCase().includes(q));
  }, [list.rows, list.view, filter.q, view]);

  return (
    <div>
      <div style={s.card}>
        <div style={s.cardTitle}>📚 Bot examene — subiecte și bareme oficiale (EN · BAC)</div>
        {err && <div style={s.alert('error')}>{err}</div>}
        {st && !setupOk && (
          <div style={s.alert('error')}>
            Botul nu e încă activat: rulează o dată <code>supabase/bot_examene.sql</code> în Supabase → SQL Editor.
            {st.setup?.missing?.length ? <span style={{ display: 'block', fontSize: '.8rem', marginTop: 4 }}>Lipsesc: {st.setup.missing.join(', ')}</span> : null}
          </div>
        )}
        {st && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={st.config.cron ? pill('#e6f4ea', '#137333') : pill('#fce8e6', '#b3261e')}>{st.config.cron ? `⏱ rulează singur${st.settings.enabled ? '' : ' — oprit din setări'}` : '⏱ CRON_SECRET lipsă în Vercel'}</span>
            <span style={st.settings.autoPublish ? pill('#e6f4ea', '#137333') : pill('#fef7e0', '#8a6d1a')}>{st.settings.autoPublish ? '📤 publică singur ce e sigur' : '📤 nu publică singur (totul așteaptă)'}</span>
            <span style={st.config.search ? pill('#e8f0fe', '#1a56c4') : pill('#f1f3f4', '#5f6368')}>{st.config.search ? `🌐 căutare web: ${st.config.searchLabel}` : '🌐 fără căutare web (opțională: Brave / Serper / Google)'}</span>
            <span style={st.config.ai ? pill('#e8f0fe', '#1a56c4') : pill('#f1f3f4', '#5f6368')}>{st.config.ai ? '🤖 AI la cerere (pe un subiect)' : '🤖 AI indisponibil (fără cheie)'}</span>
            {st.hot && <span style={pill('#fff4e5', '#b45309')}>🔥 perioadă de examen — caută la {st.settings.seasonHours} h</span>}
          </div>
        )}
        {c && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Tile icon="📄" label="PDF-uri EN + BAC" value={c.pdfs} sub={c.neverificate ? `${c.neverificate} încă neverificate` : `toate verificate`} onClick={() => setView('altele')} />
            <Tile icon="✅" label="Subiecte cu barem" value={c.cuBarem} tone="green" sub={`din ${c.subiecte} subiecte${c.deLaBot ? ` · ${c.deLaBot} legate de bot` : ''}`} onClick={() => setView('cu')} />
            <Tile icon="⚠" label="Fără barem" value={c.faraBarem + c.ambigue + c.faraText + c.erori} tone={c.faraBarem ? 'red' : 'green'} sub={[c.ambigue ? `${c.ambigue} ambigue` : null, c.faraText ? `${c.faraText} scanate` : null].filter(Boolean).join(' · ') || 'de căutat online'} onClick={() => setView('fara')} />
            <Tile icon="📋" label="Bareme pe site" value={c.bareme} tone="blue" sub={c.bareme_orfane ? `${c.bareme_orfane} fără subiect pe site` : 'toate au subiect'} onClick={() => setView('bareme')} />
            <Tile icon="📥" label="Găsite de bot" value={items ? items.publicat || 0 : 0} tone="navy" sub={items ? `publicate · ${items.asteptare || 0} de verificat · ${items.duplicat || 0} existau deja` : ''} onClick={() => setView('gasite')} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" style={s.btnPrimary} disabled={!setupOk || (running && !running.finished)} onClick={() => run('descoperire')}>🔎 Caută acum online</button>
          <button type="button" style={s.btnSecondary} disabled={!setupOk || (running && !running.finished)} onClick={() => run('verificare', { force: false })}>✅ Verifică baremele</button>
          <button type="button" style={s.btnSecondary} disabled={!setupOk || (running && !running.finished)} onClick={() => run('bareme', { force: true })}>🔍 Caută baremele lipsă</button>
          <button type="button" style={s.btnSecondary} disabled={!st} onClick={() => setSettingsOpen((v) => !v)}>⚙ Setări</button>
        </div>
        <div style={{ ...muted, marginTop: 8, lineHeight: 1.6 }}>
          Fără AI: caută pe edupedu.ro, subiecte.edu.ro (dacă permite roboții), edu.ro, paginile urmărite (inspectorate) și — dacă pui o cheie — pe un motor de căutare.
          Citește antetul fiecărui PDF (examen, an, profil, sesiune, variantă), îl compară cu ce e deja pe site și publică în rubrica lui doar ce e sigur.
          Un barem se leagă de subiect doar dacă se potrivesc titlul, numele fișierului, antetul și conținutul.
        </div>

        {running && (
          <div style={{ marginTop: 14, border: '1px solid #e6eaf0', borderRadius: 12, padding: 12, background: '#fbfcfe' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ color: 'var(--navy)' }}>
                {KIND_LABEL[running.kind]} {running.finished ? (running.error ? '— oprită de o eroare' : running.stopped ? '— oprită' : '— gata') : `— pasul ${running.steps + 1}…`}
              </strong>
              {!running.finished ? <button type="button" style={smallBtn} onClick={() => { stopRef.current = true; }}>■ Oprește după pasul curent</button>
                : <button type="button" style={smallBtn} onClick={() => setRunning(null)}>✕ Închide</button>}
            </div>
            {running.error && <div style={{ ...s.alert('error'), marginTop: 8 }}>{running.error}</div>}
            {running.total && (
              <div style={{ ...muted, marginTop: 6 }}>
                {[['publicate', 'publicate'], ['asteptare', 'de verificat'], ['duplicate', 'existau deja'], ['ignorate', 'ignorate'], ['verificate', 'PDF-uri verificate'], ['bareme_gasite', 'bareme găsite'], ['asocieri', 'asocieri'], ['erori', 'erori']]
                  .filter(([k]) => running.total[k]).map(([k, l]) => `${running.total[k]} ${l}`).join(' · ') || 'nimic nou încă'}
                {running.total.cost_usd ? ` · cost ${lei(running.total.cost_usd)}` : ''}
              </div>
            )}
            <div ref={logRef} style={{ marginTop: 8, maxHeight: 180, overflow: 'auto', background: '#0f2b44', color: '#d7e3f0', borderRadius: 8, padding: '8px 10px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '.74rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {(running.log || []).length ? running.log.join('\n') : 'Pornesc…'}
            </div>
          </div>
        )}
        {settingsOpen && st && <Setari s={s} value={st.settings} onClose={() => setSettingsOpen(false)} onSaved={(v) => setSt((x) => ({ ...x, settings: v }))} />}
      </div>

      <div style={s.card}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setView(id); setOpen(null); }}
              style={{ ...smallBtn, borderRadius: 999, padding: '6px 12px', background: view === id ? 'var(--navy)' : '#fff', color: view === id ? '#fff' : 'var(--navy)', borderColor: view === id ? 'var(--navy)' : '#dde1e8' }}>
              {label}
            </button>
          ))}
        </div>
        {view !== 'jurnal' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
            {view !== 'gasite' && (
              <>
                <select style={{ ...s.select, width: 'auto', padding: '6px 10px' }} value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value, profile: '' }))}>
                  <option value="">EN + BAC</option>
                  <option value="evaluare-nationala">Evaluare Națională</option>
                  <option value="bacalaureat">Bacalaureat</option>
                </select>
                {filter.category === 'bacalaureat' && (
                  <select style={{ ...s.select, width: 'auto', padding: '6px 10px' }} value={filter.profile} onChange={(e) => setFilter((f) => ({ ...f, profile: e.target.value }))}>
                    <option value="">toate profilurile</option>
                    <option value="mate-info">Mate-Info</option>
                    <option value="stiinte-naturii">Științele Naturii</option>
                    <option value="tehnologic">Tehnologic</option>
                  </select>
                )}
              </>
            )}
            <input style={{ ...s.input, width: 220, padding: '6px 10px' }} placeholder="Caută în titluri…" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
            {view === 'gasite' && <label style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> arată ce a ignorat (alte limbi, alte materii, ani vechi…)</label>}
            <button type="button" style={smallBtn} onClick={() => { loadList(); loadStatus(); }}>↻</button>
          </div>
        )}
        {list.error && <div style={s.alert('error')}>{list.error}</div>}
        {(list.loading || list.view !== view) && <div style={muted}>Se încarcă…</div>}
        {!list.loading && list.view === view && !shown.length && <div style={{ ...muted, padding: '18px 4px' }}>{view === 'fara' ? 'Niciun subiect fără barem. 🎉' : 'Nimic aici încă.'}</div>}

        {/* ⚠ Fără barem */}
        {!list.loading && view === 'fara' && shown.map((r) => {
          const b = BAREM_ST[r.barem_status] || BAREM_ST.negasit;
          return (
            <div key={r.content_id} style={rowBox}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <a href={`/pdf-viewer?id=${r.content_id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: 'var(--navy)' }}>{r.title}</a>
                <div style={muted}>{rubrica(r)}{r.describe ? ` · ${r.describe}` : ''}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                  <span style={pill(b.bg, b.fg)}>{b.label}</span>
                  {r.search_status && <span style={muted}>· online: {SEARCH_ST[r.search_status] || r.search_status}{r.searched_at ? ` (${fmtDate(r.searched_at)})` : ''}</span>}
                </div>
                {r.search_note && <div style={{ ...muted, marginTop: 2 }}>{r.search_note}</div>}
                {rowMsg[r.content_id] && <div style={{ fontSize: '.8rem', marginTop: 4, color: rowMsg[r.content_id].ok ? '#137333' : '#b3261e' }}>{rowMsg[r.content_id].text}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {rowBusy[r.content_id] ? <span style={muted}>{rowBusy[r.content_id]}</span> : (
                  <>
                    <button type="button" style={smallBtn} onClick={() => cautaBarem(r)}>🔍 Caută</button>
                    {st?.config?.ai && <button type="button" style={smallBtn} onClick={() => cautaBarem(r, true)}>🤖 Caută cu AI</button>}
                    <button type="button" style={smallBtn} onClick={() => setOpen(open?.id === r.content_id ? null : { id: r.content_id, what: 'asociaza' })}>🔗 Asociază…</button>
                    <button type="button" style={{ ...smallBtn, color: '#5f6368' }} onClick={() => rowAction(r.content_id, '…', { action: 'ignore', contentId: r.content_id, on: true }, () => { loadList(); loadStatus(); })}>Nu are barem</button>
                  </>
                )}
              </div>
              {open?.id === r.content_id && open.what === 'asociaza' && <Asociaza contentId={r.content_id} onDone={() => { setOpen(null); loadList(); loadStatus(); }} />}
            </div>
          );
        })}

        {/* ✅ Cu barem */}
        {!list.loading && view === 'cu' && shown.map((r) => {
          const b = BAREM_ST[r.barem_status] || BAREM_ST.ok;
          return (
            <div key={r.content_id} style={rowBox}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <a href={`/pdf-viewer?id=${r.content_id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: 'var(--navy)' }}>{r.title}</a>
                <div style={muted}>{rubrica(r)}</div>
                <div style={{ fontSize: '.84rem', marginTop: 4 }}>
                  ↔ {r.barem_id && r.barem_id !== r.content_id ? <a href={`/pdf-viewer?id=${r.barem_id}`} target="_blank" rel="noreferrer">{r.barem_title || 'barem'}</a> : (r.barem_title || 'baremul e în același PDF')}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                  <span style={pill(b.bg, b.fg)}>{b.label}</span>
                  <span style={muted}>{evidenceText(r.barem_evidence) || r.barem_how || ''}{r.barem_score != null && !/conținut/.test(evidenceText(r.barem_evidence) || '') ? ` · conținut ${Math.round(r.barem_score * 100)}%` : ''}</span>
                </div>
                {rowMsg[r.content_id] && <div style={{ fontSize: '.8rem', marginTop: 4, color: rowMsg[r.content_id].ok ? '#137333' : '#b3261e' }}>{rowMsg[r.content_id].text}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {rowBusy[r.content_id] ? <span style={muted}>{rowBusy[r.content_id]}</span> : (
                  <>
                    <button type="button" style={smallBtn} onClick={() => rowAction(r.content_id, 'verific…', { action: 'step', kind: 'verificare', ids: [r.content_id], force: true }, () => { loadList(); })}>↺ Reverifică</button>
                    <button type="button" style={smallBtn} onClick={() => setOpen(open?.id === r.content_id ? null : { id: r.content_id, what: 'asociaza' })}>🔗 Alt barem…</button>
                    {(r.barem_status === 'ok_bot' || r.barem_status === 'ok_admin') && (
                      <button type="button" style={{ ...smallBtn, color: '#b3261e' }} onClick={() => window.confirm('Desfac legătura cu baremul? Site-ul revine la potrivirea automată.') && rowAction(r.content_id, '…', { action: 'associate', contentId: r.content_id, baremId: null }, () => { loadList(); loadStatus(); })}>✕ Desface</button>
                    )}
                  </>
                )}
              </div>
              {open?.id === r.content_id && open.what === 'asociaza' && <Asociaza contentId={r.content_id} onDone={() => { setOpen(null); loadList(); loadStatus(); }} />}
            </div>
          );
        })}

        {/* 📥 Găsite de bot */}
        {!list.loading && view === 'gasite' && shown.map((r) => {
          const b = ITEM_ST[r.status] || ITEM_ST.nou;
          const reasons = Array.isArray(r.reasons) ? r.reasons : [];
          return (
            <div key={r.id} style={rowBox}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', wordBreak: 'break-word' }}>{r.file_name || r.url}</div>
                <div style={muted}>
                  {clsText(r.cls)} · {SURSA[r.source] || r.source || ''}
                  {r.page_url ? <> · <a href={r.page_url} target="_blank" rel="noreferrer">{(r.page_title || 'pagina sursă').slice(0, 90)}</a></> : null}
                  {r.url ? <>{' · '}<a href={String(r.url).split('#')[0]} target="_blank" rel="noreferrer">PDF-ul</a></> : null}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                  <span style={pill(b.bg, b.fg)}>{b.label}</span>
                  {r.confidence === 'sigur' && r.status === 'asteptare' && <span style={pill('#e6f4ea', '#137333')}>sigur</span>}
                  {r.content_id && <a href={`/pdf-viewer?id=${r.content_id}`} target="_blank" rel="noreferrer" style={{ fontSize: '.78rem' }}>vezi pe site →</a>}
                  <span style={muted}>{fmtDate(r.found_at)}</span>
                </div>
                {(reasons.length > 0 || r.last_error) && <div style={{ ...muted, marginTop: 3 }}>{[...reasons, r.last_error].filter(Boolean).slice(0, 3).join(' · ')}</div>}
                {rowMsg[r.id] && <div style={{ fontSize: '.8rem', marginTop: 4, color: rowMsg[r.id].ok ? '#137333' : '#b3261e' }}>{rowMsg[r.id].text}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {rowBusy[r.id] ? <span style={muted}>{rowBusy[r.id]}</span> : (
                  <>
                    {r.status === 'asteptare' && <button type="button" style={smallBtn} onClick={() => setOpen(open?.id === r.id ? null : { id: r.id, what: 'publica' })}>✓ Publică…</button>}
                    {['asteptare', 'nou', 'eroare'].includes(r.status) && <button type="button" style={{ ...smallBtn, color: '#b3261e' }} onClick={() => rowAction(r.id, '…', { action: 'item_reject', itemId: r.id }, () => loadList())}>✕ Respinge</button>}
                    {['eroare', 'respins', 'ignorat'].includes(r.status) && <button type="button" style={smallBtn} onClick={() => rowAction(r.id, '…', { action: 'item_retry', itemId: r.id }, () => loadList())}>↻ Reîncearcă</button>}
                  </>
                )}
              </div>
              {open?.id === r.id && open.what === 'publica' && <Publica s={s} item={r} onDone={() => { setOpen(null); loadList(); loadStatus(); }} />}
            </div>
          );
        })}

        {/* 📋 Bareme · 🚫 Ignorate · 📚 Altele */}
        {!list.loading && ['bareme', 'ignorate', 'altele'].includes(view) && shown.map((r) => (
          <div key={r.content_id} style={rowBox}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <a href={`/pdf-viewer?id=${r.content_id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: 'var(--navy)' }}>{r.title}</a>
              <div style={muted}>{rubrica(r)}{r.describe ? ` · ${r.describe}` : ''}</div>
              {view === 'bareme' && <div style={{ marginTop: 4 }}>{r.folosit ? <span style={pill('#e6f4ea', '#137333')}>folosit de {r.folosit} {r.folosit === 1 ? 'subiect' : 'subiecte'}</span> : <span style={pill('#fef7e0', '#8a6d1a')}>niciun subiect pe site nu-l folosește</span>}</div>}
            </div>
            {view === 'ignorate' && <button type="button" style={smallBtn} onClick={() => rowAction(r.content_id, '…', { action: 'ignore', contentId: r.content_id, on: false }, () => { loadList(); loadStatus(); })}>↺ Caută iar baremul</button>}
          </div>
        ))}

        {/* 🧾 Jurnal */}
        {!list.loading && view === 'jurnal' && shown.map((r) => {
          const stt = r.stats || {};
          const sum = [['publicate', 'publicate'], ['asteptare', 'de verificat'], ['duplicate', 'existau deja'], ['verificate', 'verificate'], ['bareme_gasite', 'bareme găsite'], ['asocieri', 'asocieri'], ['erori', 'erori']]
            .filter(([k]) => stt[k]).map(([k, l]) => `${stt[k]} ${l}`).join(' · ');
          return (
            <div key={r.id} style={rowBox}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <strong style={{ color: 'var(--navy)' }}>{KIND_LABEL[r.kind] || r.kind}</strong>
                <span style={muted}> · {r.by === 'cron' ? 'automat' : 'din Admin'} · {fmtDate(r.started_at)}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                  <span style={r.status === 'ok' ? pill('#e6f4ea', '#137333') : r.status === 'ruleaza' ? pill('#e8f0fe', '#1a56c4') : pill('#fce8e6', '#b3261e')}>{r.status === 'ok' ? 'gata' : r.status === 'ruleaza' ? 'rulează' : r.status}</span>
                  <span style={muted}>{sum || 'nimic nou'}{Number(r.cost_usd) > 0 ? ` · ${lei(r.cost_usd)}` : ''}</span>
                </div>
              </div>
              <button type="button" style={linkBtn} onClick={() => setOpen(open?.id === r.id ? null : { id: r.id, what: 'log' })}>{open?.id === r.id ? 'ascunde' : 'detalii'}</button>
              {open?.id === r.id && (
                <div style={{ width: '100%', maxHeight: 220, overflow: 'auto', background: '#0f2b44', color: '#d7e3f0', borderRadius: 8, padding: '8px 10px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '.72rem', whiteSpace: 'pre-wrap' }}>
                  {(Array.isArray(r.log) ? r.log : []).join('\n') || 'fără detalii'}
                </div>
              )}
            </div>
          );
        })}
        {list.total > shown.length && view !== 'gasite' && <div style={{ ...muted, marginTop: 8 }}>Afișez primele {shown.length} din {list.total}.</div>}
      </div>
    </div>
  );
}
