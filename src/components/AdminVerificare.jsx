// =====================================================================
// src/components/AdminVerificare.jsx — Admin → „🔎 Verificare materiale"
//
// Agentul care verifică exercițiile și testele de pe site (PDF + interactive):
// rezolvă singur fiecare item și îl compară cu cheia, cu explicația, cu
// variantele și cu punctajul; caută greșeli de scriere, LaTeX stricat, figuri
// care nu se potrivesc, JavaScript care nu rulează. Fiecare problemă vine cu o
// corectură propusă: o aplici într-o CIORNĂ, o vezi (diferențele + testul /
// PDF-ul corectat), apoi o publici; originalul rămâne copie de siguranță, iar
// „Anulează" revine la el.
// Serverul: api/content-check.js + api/_lib/verificare.js.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiPost } from '../lib/api';
import { CHECK_AI_MODEL } from '../lib/aiModels';
import { CATEGORIES, categoryLabel, subcategoryLabel, profileLabel } from '../lib/contentMeta';

const STATUS = {
  ok: { label: '✓ Fără greșeli', bg: '#e6f4ea', fg: '#137333' },
  minore: { label: 'Greșeli minore', bg: '#fef7e0', fg: '#8a6d1a' },
  probleme: { label: 'Probleme', bg: '#fdecd8', fg: '#b45309' },
  critic: { label: '⛔ Grave', bg: '#fce8e6', fg: '#b3261e' },
  reparat: { label: '🛠 Corectat', bg: '#e8f0fe', fg: '#1a56c4' },
  none: { label: 'Neverificat', bg: '#f1f3f4', fg: '#5f6368' },
};
const SEV = {
  critica: { label: 'Gravă', bg: '#fce8e6', fg: '#b3261e', bar: '#d93025' },
  majora: { label: 'Majoră', bg: '#fdecd8', fg: '#b45309', bar: '#e8710a' },
  minora: { label: 'Minoră', bg: '#fef7e0', fg: '#8a6d1a', bar: '#f9ab00' },
  info: { label: 'Info', bg: '#f1f3f4', fg: '#5f6368', bar: '#9aa0a6' },
};
const PLURAL = { critica: ['gravă', 'grave'], majora: ['majoră', 'majore'], minora: ['minoră', 'minore'] };
const CAT = {
  rezultat_gresit: 'Rezultat greșit', cheie_gresita: 'Cheie greșită', variante_grila: 'Variantele grilei', calcul_gresit: 'Calcul greșit',
  enunt_ambiguu: 'Enunț ambiguu', enunt_incomplet: 'Enunț incomplet', punctaj: 'Punctaj', explicatie_neconcordanta: 'Explicația nu se potrivește',
  latex_formatare: 'Formulă / formatare', scriere_diacritice: 'Scriere / diacritice', figura: 'Figură', functionalitate: 'Funcționare', altceva: 'Altceva',
};
const EFFORTS = [
  { id: 'medium', label: 'Rapid', hint: 'gândește mai puțin — mai ieftin' },
  { id: 'high', label: 'Atent', hint: 'recomandat: rezolvă fiecare item cu grijă' },
  { id: 'xhigh', label: 'Foarte atent', hint: 'pentru teste grele (BAC M1, probleme lungi) — mai scump' },
];
// cât „cântărește" în medie o verificare (tokeni) — pentru estimarea costului unui lot
const AVG = { html: { in: 26000, out: 12000 }, pdf: { in: 20000, out: 11000 } };
const fmtLei = (x) => (x < 0.1 ? '< 0,1' : x.toFixed(x < 10 ? 2 : 0).replace('.', ','));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) : '');
const pill = (bg, fg) => ({ display: 'inline-block', background: bg, color: fg, borderRadius: 12, padding: '2px 9px', fontSize: '.74rem', fontWeight: 700, whiteSpace: 'nowrap' });
const smallBtn = { background: '#fff', border: '1px solid #dde1e8', borderRadius: 8, padding: '5px 10px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', color: 'var(--navy)' };

export default function AdminVerificare({ s }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [model, setModel] = useState(CHECK_AI_MODEL);
  const [effort, setEffort] = useState('high');
  const [filter, setFilter] = useState({ category: '', kind: '', status: '', q: '' });
  const [sel, setSel] = useState(() => new Set());
  const [running, setRunning] = useState(null);       // { done, total, lei, errors, current: Set }
  const [budget, setBudget] = useState(25);
  const [parallel, setParallel] = useState(1);
  const [openId, setOpenId] = useState(null);         // materialul cu raportul deschis
  const stopRef = useRef(false);

  async function load() {
    try { setData(await apiPost('/api/content-check', { action: 'overview' })); setErr(null); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const items = data?.items || [];
  const latest = data?.latest || {};
  const statusOf = (it) => (latest[it.id] ? (latest[it.id].stale ? 'vechi' : latest[it.id].status) : 'none');
  const q = filter.q.trim().toLowerCase();
  const shown = useMemo(() => items.filter((it) => (!filter.category || it.category === filter.category)
    && (!filter.kind || it.kind === filter.kind)
    && (!filter.status || (filter.status === 'probleme' ? ['critic', 'probleme', 'minore'].includes(statusOf(it)) : statusOf(it) === filter.status))
    && (!q || `${it.title} ${it.description || ''}`.toLowerCase().includes(q))), [items, latest, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const modelInfo = data?.models?.find((m) => m.id === model) || null;
  const priceOf = (kind) => {
    const p = modelInfo?.price;
    if (!p) return null;
    const a = AVG[kind] || AVG.html;
    return ((a.in * p.in + a.out * p.out) / 1e6) * (data?.usdRon || 4.6) * (effort === 'xhigh' ? 1.5 : effort === 'medium' ? 0.7 : 1);
  };
  const selItems = items.filter((it) => sel.has(it.id));
  const estimate = selItems.reduce((n, it) => n + (priceOf(it.kind) || 0), 0);
  const counts = useMemo(() => {
    const c = { total: items.length, checked: 0, problems: 0, fixed: 0 };
    for (const it of items) {
      const st = statusOf(it);
      if (st !== 'none') c.checked++;
      if (['critic', 'probleme', 'minore'].includes(st)) c.problems++;
      if (st === 'reparat') c.fixed++;
    }
    return c;
  }, [items, latest]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id) { setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function selectWhere(fn) { setSel(new Set(shown.filter(fn).map((x) => x.id))); }

  // un material verificat → actualizăm rândul din listă
  function applyLight(contentId, l) {
    setData((d) => (d ? { ...d, latest: { ...d.latest, [contentId]: l }, totals: { ...d.totals, checks: (d.totals?.checks || 0) + 1 } } : d));
  }

  async function checkOne(it, { secondOf = null, quiet = false } = {}) {
    const r = await apiPost('/api/content-check', { action: 'check', contentId: it.id, model, effort, secondOf });
    applyLight(it.id, r.light);
    if (!quiet) setOpenId(it.id);
    return r;
  }

  async function runBatch() {
    const list = selItems.slice();
    if (!list.length) return;
    if (!window.confirm(`Verific ${list.length} ${list.length === 1 ? 'material' : 'materiale'} cu ${modelInfo?.label || model}.\nCost estimat: ≈ ${fmtLei(estimate)} lei (oprire automată la ${budget} lei).\n\nContinui?`)) return;
    stopRef.current = false;
    const st = { done: 0, total: list.length, lei: 0, errors: [], current: new Set() };
    setRunning({ ...st });
    let next = 0;
    const worker = async () => {
      while (!stopRef.current && next < list.length) {
        if (st.lei >= budget) { stopRef.current = true; st.errors.push(`Bugetul de ${budget} lei a fost atins — m-am oprit.`); break; }
        const it = list[next++];
        st.current.add(it.id); setRunning({ ...st, current: new Set(st.current) });
        try {
          const r = await checkOne(it, { quiet: true });
          st.lei += r.light?.cost_lei || 0;
        } catch (e) {
          st.errors.push(`„${it.title}": ${e.message}`);
          if (e.status === 503 || e.status === 501) stopRef.current = true;     // lipsește SQL-ul / cheia: nu are rost să continuăm
        }
        st.done++; st.current.delete(it.id);
        setRunning({ ...st, current: new Set(st.current) });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(3, parallel)) }, worker));
    setRunning({ ...st, finished: true, current: new Set() });
  }

  if (err) return <div style={s.card}><div style={s.alert('error')}>{err}</div><button style={s.btnSecondary} onClick={load}>Reîncearcă</button></div>;
  if (!data) return <div style={s.card}><div style={{ textAlign: 'center', padding: 30, color: '#8e95a3' }}>Se încarcă materialele…</div></div>;

  const busyIds = running?.current || new Set();
  const openItem = openId ? items.find((x) => x.id === openId) : null;

  return (
    <div>
      <div style={s.card}>
        <div style={{ ...s.cardTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>🔎 Agentul de verificare a materialelor</span>
          <span style={{ fontSize: '.8rem', color: '#5a6170', fontFamily: 'var(--font-body)' }}>
            {counts.total} materiale · {counts.checked} verificate · <b style={{ color: '#b45309' }}>{counts.problems} cu probleme</b> · {counts.fixed} corectate · cost total {fmtLei(data.totals?.lei || 0)} lei
          </span>
        </div>
        {!data.setup && <div style={s.alert('error')}>⚠️ Tabela verificărilor lipsește: rulează <code>supabase/agenti_verificare_debug.sql</code> în Supabase → SQL Editor.</div>}
        {!data.hasKey && <div style={s.alert('error')}>⚠️ Lipsește cheia <code>ANTHROPIC_API_KEY</code> în Vercel — agentul are nevoie de ea.</div>}
        <div style={s.infoBox}>
          <b>Cum lucrează:</b> pentru fiecare material, agentul <b>rezolvă singur fiecare item</b> și îl compară cu cheia, cu explicația, cu variantele și cu punctajul;
          caută și greșeli de scriere, formule stricate, figuri care nu se potrivesc cu enunțul și JavaScript care nu rulează (acestea și fără AI, automat).
          Fiecare problemă vine cu o <b>corectură propusă</b>: o vezi înainte (diferențele + testul corectat), apoi o publici. Originalul rămâne copie de siguranță — <b>„Anulează"</b> revine la el oricând.
          La PDF-uri, textul greșit se rescrie pe loc, cu același font; ce nu se poate rescrie (formule etajate, figuri) intră într-o pagină de <b>ERATĂ</b> la final.
        </div>

        <ModelRow models={data.models} value={model} onChange={setModel} disabled={!!running && !running.finished} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 14px' }}>
          <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>🎯 Atenția:</span>
          {EFFORTS.map((e) => (
            <button key={e.id} type="button" title={e.hint} onClick={() => setEffort(e.id)} disabled={!!running && !running.finished}
              style={{ ...smallBtn, borderRadius: 20, background: effort === e.id ? 'var(--navy)' : '#fff', color: effort === e.id ? '#fff' : 'var(--navy)' }}>{e.label}</button>
          ))}
          <span style={{ fontSize: '.74rem', color: '#8e95a3' }}>{EFFORTS.find((e) => e.id === effort)?.hint}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <select style={{ ...s.select, width: 190 }} value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}>
            <option value="">Toate categoriile</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <select style={{ ...s.select, width: 160 }} value={filter.kind} onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value }))}>
            <option value="">PDF + interactive</option>
            <option value="html">🧩 Interactive (HTML)</option>
            <option value="pdf">📄 PDF</option>
          </select>
          <select style={{ ...s.select, width: 170 }} value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Orice stare</option>
            <option value="none">Neverificate</option>
            <option value="probleme">Cu probleme</option>
            <option value="critic">Doar grave</option>
            <option value="ok">Fără greșeli</option>
            <option value="reparat">Corectate</option>
            <option value="vechi">Verificare veche (fișier schimbat)</option>
          </select>
          <input style={{ ...s.input, width: 240 }} placeholder="🔍 Caută după titlu" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: '#f7f9fc', border: '1px solid #e3e8ef', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <span style={{ fontSize: '.8rem', color: '#5a6170', fontWeight: 600 }}>Selectează:</span>
          <button type="button" style={smallBtn} onClick={() => selectWhere(() => true)}>toate afișate ({shown.length})</button>
          <button type="button" style={smallBtn} onClick={() => selectWhere((it) => statusOf(it) === 'none')}>neverificate</button>
          <button type="button" style={smallBtn} onClick={() => selectWhere((it) => statusOf(it) === 'vechi')}>cu verificare veche</button>
          <button type="button" style={smallBtn} onClick={() => setSel(new Set())}>nimic</button>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: '.78rem', color: '#5a6170' }}>Buget lot <input type="number" min={1} value={budget} onChange={(e) => setBudget(Math.max(1, Number(e.target.value) || 1))} style={{ width: 60, padding: '4px 6px', border: '1px solid #dde1e8', borderRadius: 6 }} /> lei</label>
          <label style={{ fontSize: '.78rem', color: '#5a6170' }}>În paralel <select value={parallel} onChange={(e) => setParallel(Number(e.target.value))} style={{ padding: '4px 6px', border: '1px solid #dde1e8', borderRadius: 6 }}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
          {running && !running.finished
            ? <button type="button" style={{ ...s.btnDanger, padding: '8px 14px' }} onClick={() => { stopRef.current = true; }}>⏹ Oprește lotul</button>
            : <button type="button" style={s.btnPrimary} disabled={!sel.size || !data.hasKey || !data.setup} onClick={runBatch}>▶ Verifică selecția ({sel.size}){sel.size ? ` · ≈ ${fmtLei(estimate)} lei` : ''}</button>}
        </div>

        {running && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ height: 8, background: '#eef1f5', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round((100 * running.done) / Math.max(1, running.total))}%`, background: running.finished ? '#34a853' : 'var(--gold)', transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: '.8rem', color: '#5a6170', marginTop: 6 }}>
              {running.finished ? '✓ Lot terminat' : '⏳ Verific…'} {running.done} din {running.total} · cost {fmtLei(running.lei)} lei
              {running.finished && <button type="button" style={{ ...smallBtn, marginLeft: 10 }} onClick={() => setRunning(null)}>OK</button>}
            </div>
            {running.errors.length > 0 && <div style={{ ...s.alert('error'), marginTop: 8, whiteSpace: 'pre-wrap' }}>{running.errors.slice(-6).join('\n')}</div>}
          </div>
        )}

        {shown.length === 0 ? <div style={{ textAlign: 'center', padding: 30, color: '#8e95a3' }}>Niciun material pentru filtrele alese.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: 30 }}><input type="checkbox" checked={shown.length > 0 && shown.every((x) => sel.has(x.id))} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((x) => x.id)) : new Set())} /></th>
                  <th style={s.th}>Material</th>
                  <th style={s.th}>Tip</th>
                  <th style={s.th}>Verificare</th>
                  <th style={s.th}>Probleme</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map((it) => {
                  const l = latest[it.id];
                  const st = statusOf(it);
                  const look = st === 'vechi' ? { label: '↻ Fișier schimbat', bg: '#f3e8fd', fg: '#7b1fa2' } : STATUS[st] || STATUS.none;
                  const busy = busyIds.has(it.id);
                  return (
                    <tr key={it.id} style={{ background: openId === it.id ? '#f8fbff' : undefined }}>
                      <td style={s.td}><input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} /></td>
                      <td style={s.td}>
                        <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{it.title}</div>
                        <div style={{ fontSize: '.74rem', color: '#8e95a3' }}>
                          {[categoryLabel(it.category), it.subcategory ? subcategoryLabel(it.category, it.subcategory) : null, it.profile ? profileLabel(it.profile) : null].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td style={s.td}><span style={s.badge(it.kind === 'pdf' ? 'pdf' : 'interactive')}>{it.kind === 'pdf' ? 'PDF' : 'HTML'}</span></td>
                      <td style={s.td}>
                        <span style={pill(look.bg, look.fg)}>{busy ? '⏳ Se verifică…' : look.label}</span>
                        {l && <div style={{ fontSize: '.7rem', color: '#8e95a3', marginTop: 3 }}>{fmtDate(l.created_at)} · {modelLabel(data.models, l.model)} · {fmtLei(l.cost_lei || 0)} lei</div>}
                      </td>
                      <td style={{ ...s.td, fontSize: '.8rem' }}>
                        {l ? <SevCounts l={l} /> : <span style={{ color: '#bdc1c6' }}>—</span>}
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        <button type="button" style={{ ...smallBtn, marginRight: 6 }} disabled={busy || !data.hasKey || !data.setup}
                          onClick={async () => { try { await checkOne(it); } catch (e) { alert(e.message); } }}>
                          {busy ? '…' : l ? '🔁 Din nou' : '🔎 Verifică'}
                        </button>
                        {l && <button type="button" style={{ ...smallBtn, borderColor: 'var(--navy)' }} onClick={() => setOpenId(it.id)}>📋 Raport</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 400 && <div style={{ fontSize: '.8rem', color: '#8e95a3', padding: 8 }}>Se afișează primele 400 — restrânge cu filtrele.</div>}
          </div>
        )}
      </div>

      {openItem && latest[openItem.id] && (
        <ReportModal s={s} item={openItem} checkId={latest[openItem.id].id} models={data.models} model={model} effort={effort}
          onClose={() => setOpenId(null)}
          onLight={(l) => applyLight(openItem.id, l)}
          onRecheck={(secondOf) => checkOne(openItem, { secondOf })} />
      )}
    </div>
  );
}

function modelLabel(models, id) { return (models || []).find((m) => m.id === id)?.label || id || ''; }

function SevCounts({ l }) {
  const parts = [['critica', l.critica], ['majora', l.majora], ['minora', l.minora]].filter(([, n]) => n > 0);
  if (!parts.length) return <span style={{ color: '#137333' }}>{l.status === 'reparat' ? 'toate corectate' : 'niciuna'}</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {parts.map(([k, n]) => <span key={k} style={pill(SEV[k].bg, SEV[k].fg)}>{n} {PLURAL[k][n === 1 ? 0 : 1]}</span>)}
      {l.fixable > 0 && <span style={pill('#e8f0fe', '#1a56c4')}>🛠 {l.fixable} cu corectură</span>}
    </span>
  );
}

function ModelRow({ models, value, onChange, disabled }) {
  const main = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5'];
  const list = (models || []).filter((m) => main.includes(m.id)).sort((a, b) => main.indexOf(a.id) - main.indexOf(b.id));
  const cur = (models || []).find((m) => m.id === value);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>🧠 Model:</span>
        {list.map((m) => (
          <button key={m.id} type="button" disabled={disabled} title={m.note} onClick={() => onChange(m.id)}
            style={{ border: value === m.id ? '2px solid var(--navy)' : '1px solid var(--border)', background: value === m.id ? 'var(--navy)' : '#fff', color: value === m.id ? '#fff' : 'var(--navy)', borderRadius: 20, padding: '4px 12px', fontSize: '.78rem', fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }}>
            {m.label}{m.id === 'claude-opus-5-5' ? ' ★' : ''}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginBottom: 4 }}>
        {cur?.note}{cur?.price ? ` · ${cur.price.in}/${cur.price.out} $ pe milion de tokeni (intrare/ieșire)` : ''}
      </p>
      <p style={{ fontSize: '.76rem', color: '#1a56c4', marginBottom: 10 }}>
        ★ Recomandat: <b>Opus 5.5</b> — generația nouă, mai ieftin decât Opus 5 și mai sigur la calcule decât Sonnet. Pentru sute de materiale: întâi <b>Sonnet 5.5</b> (jumătate din preț), apoi <b>„A doua opinie"</b> cu Opus 5.5 doar la cele cu probleme.
      </p>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Raportul unui material: problemele, corecturile, ciorna, publicarea
// ═════════════════════════════════════════════════════════════════════════════
function ReportModal({ s, item, checkId, models, model, effort, onClose, onLight, onRecheck }) {
  const [check, setCheck] = useState(null);
  const [stale, setStale] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [pick, setPick] = useState(() => new Set());
  const [preview, setPreview] = useState(null);       // { edits, diff, failed } | { placed, errata, url }
  const [frame, setFrame] = useState(null);           // { which, html|url }
  const [msg, setMsg] = useState(null);

  async function load(id = checkId) {
    try {
      const r = await apiPost('/api/content-check', { action: 'get', checkId: id });
      setCheck(r.check); setStale(!!r.stale); setErr(null);
      const fixable = (r.check.issues || []).filter((i) => i.fix_kind === 'patch' && i.fixable !== false && !i.dismissed && !i.fixed && i.severity !== 'info').map((i) => i.id);
      setPick(new Set(fixable));
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { setPreview(null); setFrame(null); setMsg(null); load(checkId); }, [checkId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function act(action, extra = {}, label = action) {
    setBusy(label); setErr(null); setMsg(null);
    try {
      const r = await apiPost('/api/content-check', { action, checkId: check.id, ...extra });
      if (r.check) setCheck(r.check);
      if (r.light) onLight(r.light);
      return r;
    } catch (e) { setErr(e.message); return null; }
    finally { setBusy(null); }
  }

  async function prepare() {
    const r = await act('prepare_fix', { issueIds: [...pick] }, 'prepare');
    if (r) { setPreview(r.preview); setFrame(null); if (check.kind === 'pdf' && r.preview?.url) setFrame({ which: 'draft', url: r.preview.url }); }
  }
  async function showFrame(which) {
    setBusy('frame');
    try {
      const r = await apiPost('/api/content-check', { action: 'preview', checkId: check.id, which });
      setFrame({ which, html: r.html || null, url: r.url || null });
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }
  async function recheck(second) {
    setBusy(second ? 'second' : 'recheck'); setErr(null);
    try {
      const r = await onRecheck(second ? check.id : null);
      setPreview(null); setFrame(null);
      await load(r.check.id);
      setMsg(second ? 'A doua opinie e gata — problemele respinse au dispărut din listă.' : 'Verificarea nouă e gata.');
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  const issues = check?.issues || [];
  const open = issues.filter((i) => !i.dismissed && !i.fixed);
  const closed = issues.filter((i) => i.dismissed || i.fixed);
  const rep = check?.report || {};
  const draft = check?.draft;
  const fix = check?.fix && !check.fix.undone_at ? check.fix : null;
  const st = STATUS[check?.status] || STATUS.none;

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,40,.55)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(980px, 100%)', height: '100%', background: '#f7f9fc', overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,.25)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--navy)', color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '.72rem', opacity: .7, textTransform: 'uppercase', letterSpacing: '.05em' }}>Raport de verificare · {item.kind === 'pdf' ? 'PDF' : 'test interactiv'}</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
          </div>
          <button type="button" onClick={onClose} style={{ ...smallBtn, background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'rgba(255,255,255,.3)' }}>✕ Închide</button>
        </div>

        <div style={{ padding: 20 }}>
          {err && <div style={s.alert('error')}>{err}</div>}
          {msg && <div style={s.alert('success')}>{msg}</div>}
          {!check ? <div style={{ padding: 30, textAlign: 'center', color: '#8e95a3' }}>Se încarcă raportul…</div> : (<>
            {stale && <div style={s.alert('error')}>↻ Fișierul materialului s-a schimbat după această verificare — rezultatele pot fi vechi. Apasă „Verifică din nou".</div>}
            <div style={{ ...s.card, padding: '18px 20px', marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={pill(st.bg, st.fg)}>{st.label}</span>
                <span style={{ fontSize: '.8rem', color: '#5a6170' }}>
                  {new Date(check.created_at).toLocaleString('ro-RO')} · {modelLabel(models, check.model)} · atenție „{check.effort || 'high'}" · {fmtLei((check.cost_micro || 0) / 1e6)} lei
                  {rep.items_checked ? ` · ${rep.items_checked} itemi verificați` : ''}{rep.pages ? ` · ${rep.pages} pagini` : ''}{rep.barem ? ` · comparat cu „${rep.barem}"` : ''}
                </span>
                {rep.official && <span style={pill('#e8f0fe', '#1a56c4')}>document oficial</span>}
              </div>
              <div style={{ fontSize: '.92rem', color: '#202124', lineHeight: 1.55 }}>{check.summary}</div>
              {Array.isArray(rep.items) && rep.items.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                  {rep.items.map((x, k) => (
                    <span key={k} title={`${x.ref}: ${x.answer}`} style={pill(x.status === 'ok' ? '#e6f4ea' : x.status === 'problema' ? '#fce8e6' : '#f1f3f4', x.status === 'ok' ? '#137333' : x.status === 'problema' ? '#b3261e' : '#5f6368')}>
                      {x.status === 'ok' ? '✓' : x.status === 'problema' ? '✗' : '?'} {x.ref}
                    </span>
                  ))}
                </div>
              )}
              {Array.isArray(rep.previous_review) && rep.previous_review.length > 0 && (
                <div style={{ marginTop: 10, fontSize: '.8rem', color: '#5a6170' }}>
                  <b>A doua opinie:</b> {rep.previous_review.filter((p) => p.status === 'confirmat').length} confirmate, {rep.previous_review.filter((p) => p.status === 'respins').length} respinse
                  {rep.previous_review.filter((p) => p.status === 'respins').map((p) => <div key={p.id}>· respins [{p.id}]: {p.reason}</div>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button type="button" style={smallBtn} disabled={!!busy} onClick={() => recheck(false)}>{busy === 'recheck' ? '⏳ Verific…' : `🔁 Verifică din nou (${modelLabel(models, model)})`}</button>
                {open.some((i) => i.source !== 'automat') && (
                  <button type="button" style={smallBtn} disabled={!!busy} onClick={() => recheck(true)} title="Alt verificator (modelul ales sus) confirmă sau respinge fiecare problemă și caută ce a scăpat">
                    {busy === 'second' ? '⏳ A doua opinie…' : `🧑‍⚖️ A doua opinie (${modelLabel(models, model)}, ${effort})`}
                  </button>
                )}
                <button type="button" style={smallBtn} disabled={!!busy} onClick={() => showFrame('current')}>👁 Vezi materialul de acum</button>
              </div>
            </div>

            {fix && (
              <div style={{ ...s.alert('success'), display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>🛠 Corectura e publicată pe site ({new Date(fix.published_at).toLocaleString('ro-RO')}). Fișierul original e păstrat.</span>
                <button type="button" style={{ ...smallBtn, color: '#b3261e', borderColor: '#f5c6cb' }} disabled={!!busy}
                  onClick={async () => { if (window.confirm('Revin la fișierul original (corectura dispare de pe site)?')) { await act('undo_fix', {}, 'undo'); setMsg('Am revenit la fișierul original.'); } }}>
                  {busy === 'undo' ? '…' : '↩ Anulează corectura'}
                </button>
              </div>
            )}

            <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '6px 0 10px' }}>
              {open.length ? `Probleme deschise (${open.length})` : '✓ Nicio problemă deschisă'}
            </h3>
            {open.map((i) => (
              <IssueCard key={i.id} i={i} kind={check.kind} picked={pick.has(i.id)} disabled={!!busy || !!draft}
                onPick={() => setPick((x) => { const n = new Set(x); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}
                onDismiss={async () => { const note = window.prompt('De ce nu e o greșeală? (opțional — agentul nu o mai raportează)', ''); if (note !== null) await act('dismiss', { issueId: i.id, note }, 'dismiss'); }} />
            ))}

            {open.some((i) => i.fix_kind === 'patch' || (check.kind === 'pdf' && i.fix_kind === 'manual')) && !draft && (
              <div style={{ position: 'sticky', bottom: 0, background: '#f7f9fc', padding: '12px 0', borderTop: '1px solid #e3e8ef', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={s.btnPrimary} disabled={!pick.size || !!busy || stale} onClick={prepare}>
                  {busy === 'prepare' ? '⏳ Pregătesc corectura…' : `🛠 Pregătește corectura (${pick.size})`}
                </button>
                <span style={{ fontSize: '.8rem', color: '#5a6170' }}>
                  Se creează un fișier NOU, nepublicat: îl vezi întâi, apoi alegi „Publică" sau „Renunță".
                  {check.kind === 'pdf' ? ' Problemele fără corectură automată (✍ manual) intră în pagina de ERATĂ.' : ''}
                </span>
              </div>
            )}

            {draft && (
              <div style={{ ...s.card, padding: '16px 18px', border: '2px solid var(--gold)' }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', marginBottom: 8 }}>🧪 Ciorna corecturii (nepublicată) · {draft.issueIds?.length || 0} {draft.issueIds?.length === 1 ? 'problemă' : 'probleme'}</div>
                {check.kind === 'html' && preview?.edits && (
                  <div style={{ marginBottom: 10 }}>
                    {preview.edits.map((e, k) => (
                      <div key={k} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.76rem', background: '#fff', border: '1px solid #e3e8ef', borderRadius: 8, padding: '8px 10px', marginBottom: 6, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '.72rem', color: e.ok ? '#137333' : '#b3261e', marginBottom: 4 }}>{e.issue} · {e.ok ? `aplicată${e.how && e.how !== 'exact' ? ` (${e.how.replace('_', ' ')})` : ''}` : `NEAPLICATĂ: ${e.reason}`}</div>
                        <span style={{ color: '#80868b' }}>{e.prefix}</span>
                        <span style={{ background: '#fce8e6', textDecoration: 'line-through' }}>{e.before}</span>
                        <span style={{ background: '#e6f4ea' }}>{e.after}</span>
                        <span style={{ color: '#80868b' }}>{e.suffix}</span>
                      </div>
                    ))}
                  </div>
                )}
                {check.kind === 'pdf' && (preview || draft.preview) && (
                  <div style={{ fontSize: '.84rem', marginBottom: 10 }}>
                    {((preview || draft.preview).placed || []).length > 0 && <div style={{ color: '#137333', marginBottom: 4 }}>✓ Rescrise pe loc: {(preview || draft.preview).placed.map((p) => `p. ${p.page}: „${p.find}" → „${p.replace}"`).join(' · ')}</div>}
                    {((preview || draft.preview).errata || []).length > 0 && <div style={{ color: '#8a6d1a' }}>📄 În pagina de ERATĂ: {(preview || draft.preview).errata.map((x) => x.text).join(' · ')}</div>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={smallBtn} disabled={!!busy} onClick={() => showFrame('draft')}>👁 Vezi {check.kind === 'pdf' ? 'PDF-ul' : 'testul'} corectat</button>
                  <button type="button" style={smallBtn} disabled={!!busy} onClick={() => showFrame('current')}>👁 Vezi originalul</button>
                  <span style={{ flex: 1 }} />
                  <button type="button" style={{ ...smallBtn, color: '#b3261e', borderColor: '#f5c6cb' }} disabled={!!busy} onClick={async () => { await act('discard_fix', {}, 'discard'); setPreview(null); setFrame(null); }}>✕ Renunță</button>
                  <button type="button" style={s.btnPrimary} disabled={!!busy}
                    onClick={async () => { const r = await act('publish_fix', {}, 'publish'); if (r) { setPreview(null); setFrame(null); setMsg('✅ Publicat: materialul de pe site folosește acum fișierul corectat. Originalul e păstrat („Anulează" revine la el).'); } }}>
                    {busy === 'publish' ? '⏳ Public…' : '✅ Publică pe site'}
                  </button>
                </div>
                {check.kind === 'html' && preview?.diff?.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', fontSize: '.8rem', color: '#5a6170' }}>Diferențele pe rânduri ({preview.diff.length} {preview.diff.length === 1 ? 'zonă' : 'zone'})</summary>
                    <DiffView hunks={preview.diff} />
                  </details>
                )}
              </div>
            )}

            {frame && (
              <div style={{ ...s.card, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: '.8rem', color: '#5a6170' }}>
                  <span>{frame.which === 'draft' ? '🧪 Varianta corectată (nepublicată)' : '📄 Varianta de pe site acum'}</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {frame.url && <a href={frame.url} target="_blank" rel="noreferrer" style={{ ...smallBtn, textDecoration: 'none' }}>↗ Deschide separat</a>}
                    <button type="button" style={smallBtn} onClick={() => setFrame(null)}>✕</button>
                  </span>
                </div>
                {frame.html != null
                  ? <iframe title="previzualizare" sandbox="allow-scripts" srcDoc={frame.html} style={{ width: '100%', height: 620, border: '1px solid #e3e8ef', borderRadius: 8, background: '#fff' }} />
                  : frame.url ? <iframe title="previzualizare PDF" src={frame.url} style={{ width: '100%', height: 720, border: '1px solid #e3e8ef', borderRadius: 8, background: '#fff' }} /> : <div style={{ padding: 20, color: '#8e95a3' }}>Previzualizarea nu e disponibilă.</div>}
              </div>
            )}

            {closed.length > 0 && (
              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#5a6170' }}>Rezolvate / marcate „nu e o greșeală" ({closed.length})</summary>
                {closed.map((i) => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '8px 10px', background: '#fff', border: '1px solid #e3e8ef', borderRadius: 8, marginTop: 6, fontSize: '.84rem' }}>
                    <span>{i.fixed ? '🛠 corectată' : '🙈 nu e greșeală'} · <b>{i.location}</b>: {i.title}{i.dismiss_note ? ` — „${i.dismiss_note}"` : ''}</span>
                    {i.dismissed && <button type="button" style={smallBtn} onClick={() => act('dismiss', { issueId: i.id, undo: true }, 'dismiss')}>Readu</button>}
                  </div>
                ))}
              </details>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}

function IssueCard({ i, kind, picked, disabled, onPick, onDismiss }) {
  const sev = SEV[i.severity] || SEV.info;
  const canFix = i.fix_kind === 'patch' ? i.fixable !== false : kind === 'pdf' && i.fix_kind === 'manual';
  return (
    <div style={{ background: '#fff', border: '1px solid #e3e8ef', borderLeft: `4px solid ${sev.bar}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {canFix && <input type="checkbox" checked={picked} disabled={disabled} onChange={onPick} style={{ marginTop: 4 }} title="Include în corectură" />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
            <span style={pill(sev.bg, sev.fg)}>{sev.label}</span>
            <span style={pill('#f1f3f4', '#3c4043')}>{CAT[i.category] || i.category}</span>
            {i.source === 'automat' && <span style={pill('#e8f0fe', '#1a56c4')}>⚙ automat</span>}
            {i.confidence === 'probabil' && <span style={pill('#fef7e0', '#8a6d1a')}>probabil</span>}
            <b style={{ color: 'var(--navy)', fontSize: '.86rem' }}>{i.location}</b>
          </div>
          <div style={{ fontWeight: 700, color: '#202124', marginBottom: 4 }}>{i.title}</div>
          <div style={{ fontSize: '.86rem', color: '#3c4043', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{i.description}</div>
          {i.evidence && <div style={{ fontSize: '.8rem', marginTop: 6 }}><span style={{ color: '#80868b' }}>Scrie acum:</span> <code style={{ background: '#fce8e6', padding: '1px 4px', borderRadius: 4, wordBreak: 'break-word' }}>{i.evidence}</code></div>}
          {i.correct && <div style={{ fontSize: '.8rem', marginTop: 4 }}><span style={{ color: '#80868b' }}>Corect:</span> <span style={{ background: '#e6f4ea', padding: '1px 4px', borderRadius: 4 }}>{i.correct}</span></div>}
          <div style={{ fontSize: '.78rem', marginTop: 8, color: i.fix_kind === 'patch' ? (i.fixable === false ? '#b3261e' : '#1a56c4') : '#5f6368' }}>
            {i.fix_kind === 'patch'
              ? (i.fixable === false ? `⚠ Corectura propusă nu se poate aplica automat: ${i.fix_problem || 'fragment negăsit'} — corectează manual sau cere „Verifică din nou".` : `🛠 Corectură automată${i.fix_mode === 'erata' ? ' (în pagina de ERATĂ — textul nu e în stratul de text al PDF-ului)' : i.fix_mode === 'mixt' ? ' (parțial pe loc, restul în ERATĂ)' : ''}: ${i.fix_note || `${i.edits.length} ${i.edits.length === 1 ? 'modificare' : 'modificări'}`}`)
              : i.fix_kind === 'manual' ? `✍ Manual${kind === 'pdf' ? ' (sau în pagina de ERATĂ, dacă o bifezi)' : ''}: ${i.fix_note || 'se corectează de mână'}` : 'ℹ Doar semnalare'}
          </div>
          {i.fix_kind === 'patch' && i.edits?.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: '.76rem', color: '#5a6170' }}>Ce se schimbă ({i.edits.length})</summary>
              {i.edits.map((e, k) => (
                <div key={k} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.74rem', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  <div style={{ background: '#fce8e6', padding: '3px 6px', borderRadius: 4 }}>− {e.find}</div>
                  <div style={{ background: '#e6f4ea', padding: '3px 6px', borderRadius: 4, marginTop: 2 }}>+ {e.replace}</div>
                </div>
              ))}
            </details>
          )}
        </div>
        <button type="button" onClick={onDismiss} disabled={disabled} title="Nu e o greșeală — agentul nu o mai raportează" style={{ ...smallBtn, fontSize: '.72rem', color: '#5f6368', whiteSpace: 'nowrap' }}>🙈 Nu e greșeală</button>
      </div>
    </div>
  );
}

function DiffView({ hunks }) {
  return (
    <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.74rem', background: '#fff', border: '1px solid #e3e8ef', borderRadius: 8, marginTop: 6, overflowX: 'auto' }}>
      {hunks.map((h, k) => (
        <div key={k} style={{ borderBottom: '1px solid #eef1f5' }}>
          <div style={{ background: '#f1f3f4', color: '#5f6368', padding: '2px 8px' }}>@@ rândul {h.startA ?? h.startB}</div>
          {h.lines.map(([op, t], j) => (
            <div key={j} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '1px 8px', background: op === '-' ? '#fce8e6' : op === '+' ? '#e6f4ea' : undefined }}>
              {op === ' ' ? '  ' : `${op} `}{t}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
