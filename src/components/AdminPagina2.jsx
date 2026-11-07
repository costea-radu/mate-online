// =====================================================================
// src/components/AdminPagina2.jsx — Admin → „📚 Bot examene" → ⬜ Dreptunghiul de pe pagina 2
//
// Pe pagina 2 a testelor de Evaluare Națională (Variante date + modele, Simulări)
// e un dreptunghi negru — spatele „colțului secretizat" de pe foaia de examen.
// Botul face o COPIE a fiecărui test cu un dreptunghi ALB lipit peste el (spațiu gol,
// alb). Originalul rămâne neatins, la adresa lui: același nume, aceleași proprietăți,
// același barem. În vizualizatorul PDF se deschide varianta albă, iar butonul
// „⬛ Original" / „⬜ Fără suprafață neagră" din bară trece de la una la alta.
// Serverul: api/exam-bot.js (pagina2_*) → api/_lib/pagina2Run.js → api/_lib/pagina2.js.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../lib/api';

const API = '/api/exam-bot';
const pill = (bg, fg) => ({ display: 'inline-block', background: bg, color: fg, borderRadius: 12, padding: '2px 9px', fontSize: '.74rem', fontWeight: 700, whiteSpace: 'nowrap' });
const smallBtn = { background: '#fff', border: '1px solid #dde1e8', borderRadius: 8, padding: '5px 10px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', color: 'var(--navy)', whiteSpace: 'nowrap' };
const muted = { fontSize: '.76rem', color: 'var(--text-muted)' };
const rowBox = { display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 4px', borderBottom: '1px solid #f0f4f8' };
const logBox = { marginTop: 8, maxHeight: 180, overflow: 'auto', background: '#0f2b44', color: '#d7e3f0', borderRadius: 8, padding: '8px 10px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '.74rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export const P2_ST = {
  curatat: { label: '⬜ are varianta albă', bg: '#e6f4ea', fg: '#137333' },
  ascuns: { label: '🙈 varianta albă ascunsă', bg: '#fdecd8', fg: '#b45309' },
  de_curatat: { label: '🔍 de făcut', bg: '#e8f0fe', fg: '#1a56c4' },
  neverificat: { label: 'neverificat', bg: '#f1f3f4', fg: '#5f6368' },
  fara: { label: 'fără dreptunghi', bg: '#f1f3f4', fg: '#5f6368' },
  nesigur: { label: '⚠ nesigur — doar originalul', bg: '#fef7e0', fg: '#8a6d1a' },
  eroare: { label: '⚠ eroare', bg: '#fce8e6', fg: '#b3261e' },
};
const SUB = { variante: 'Variante + modele', simulari: 'Simulări' };
// grupele din care se filtrează lista (dalele de sus)
const GROUPS = { curatat: ['curatat'], todo: ['de_curatat', 'neverificat'], fara: ['fara'], probleme: ['nesigur', 'eroare'], ascuns: ['ascuns'] };

function Tile({ icon, label, value, sub, tone = 'navy', active, onClick }) {
  const colors = { navy: 'var(--navy)', green: '#137333', red: '#b3261e', amber: '#8a6d1a', blue: '#1a56c4', gray: '#5f6368' };
  return (
    <button type="button" onClick={onClick}
      style={{ textAlign: 'left', background: active ? '#eef3fb' : '#f7f9fc', border: `1px solid ${active ? '#9db8e0' : '#e6eaf0'}`, borderRadius: 12, padding: '10px 12px', cursor: 'pointer', minWidth: 0 }}>
      <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#5a6170', textTransform: 'uppercase', letterSpacing: '.04em' }}>{icon} {label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: colors[tone] || colors.navy, lineHeight: 1.2, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ ...muted, marginTop: 2 }}>{sub}</div>}
    </button>
  );
}

export default function AdminPagina2({ s, otherBusy = false, onBusy, onRunEnd }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const [running, setRunning] = useState(null);     // { dry, steps, log, progress, finished, error, stopped }
  const [filter, setFilter] = useState(null);       // null = lista ascunsă · '' = toate · o grupă din GROUPS
  const [rowBusy, setRowBusy] = useState({});
  const [rowMsg, setRowMsg] = useState({});
  const [savingAuto, setSavingAuto] = useState(false);
  const stopRef = useRef(false);
  const logRef = useRef(null);

  async function load() {
    try { setSt(await apiPost(API, { action: 'pagina2_status' })); setErr(null); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [running?.log?.length]);

  const busy = !!(running && !running.finished);
  const c = st?.counts;

  async function run(dry, extra = {}) {
    if (busy || otherBusy) return;
    stopRef.current = false;
    let runId = null, steps = 0;
    setRunning({ dry, steps: 0, log: [], progress: null, finished: false });
    if (onBusy) onBusy(true);
    try {
      while (!stopRef.current && steps < 60) {
        const r = await apiPost(API, { action: 'pagina2_step', runId, dry, ...extra });
        runId = r.runId; steps++;
        setRunning((p) => ({ ...p, runId, steps, log: [...(p?.log || []), ...(r.log || [])].slice(-300), progress: r.progress, total: r.total }));
        if (r.done) break;
      }
      if (stopRef.current && runId) await apiPost(API, { action: 'stop', runId }).catch(() => {});
      setRunning((p) => ({ ...p, finished: true, stopped: stopRef.current }));
    } catch (e) {
      setRunning((p) => ({ ...(p || {}), finished: true, error: e.message }));
    }
    if (onBusy) onBusy(false);
    await load();
    if (onRunEnd) onRunEnd();
  }

  async function toggleAuto() {
    if (!st) return;
    setSavingAuto(true);
    try {
      const r = await apiPost(API, { action: 'pagina2_settings', value: { auto: !st.settings.auto } });
      setSt((x) => ({ ...x, settings: r.settings }));
    } catch (e) { setErr(e.message); }
    setSavingAuto(false);
  }

  // linkul vine de la server (semnat, 10 minute); fereastra se deschide imediat (altfel o blochează browserul)
  async function openFile(id, which) {
    const w = window.open('', '_blank');
    try {
      const r = await apiPost(API, { action: 'pagina2_link', contentId: id, which });
      if (w) w.location.href = r.url; else window.location.href = r.url;
    } catch (e) {
      if (w) w.close();
      setRowMsg((m) => ({ ...m, [id]: { ok: false, text: e.message } }));
    }
  }

  // 🙈 / 👁 varianta albă în vizualizator (originalul rămâne oricum la locul lui)
  async function setHidden(r, on) {
    setRowBusy((b) => ({ ...b, [r.id]: on ? '🙈 o ascund…' : '👁 o arăt…' }));
    setRowMsg((m) => ({ ...m, [r.id]: null }));
    try {
      await apiPost(API, { action: 'pagina2_hide', contentId: r.id, on });
      setRowMsg((m) => ({ ...m, [r.id]: { ok: true, text: on ? 'Vizualizatorul arată acum doar originalul.' : 'Vizualizatorul deschide din nou varianta albă.' } }));
      await load();
    } catch (e) { setRowMsg((m) => ({ ...m, [r.id]: { ok: false, text: e.message } })); }
    setRowBusy((b) => { const n = { ...b }; delete n[r.id]; return n; });
  }

  const rows = (st?.rows || []).filter((r) => !filter || (GROUPS[filter] || [filter]).includes(r.status));
  const pickFilter = (g) => setFilter(filter === g ? null : g);
  const totals = running?.total || {};
  const summary = [['p2_curatate', 'variante albe făcute'], ['p2_de_curatat', 'de făcut'], ['p2_fara', 'fără dreptunghi'], ['p2_nesigure', 'nesigure (doar originalul)'], ['p2_originale', 'originale puse la loc'], ['p2_erori', 'erori']]
    .filter(([k]) => totals[k]).map(([k, l]) => `${totals[k]} ${l}`).join(' · ');

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>⬜ Dreptunghiul negru de pe pagina 2 — testele de Evaluare Națională</div>
      {err && <div style={s.alert('error')}>{err}</div>}
      {st && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <span style={{ ...(st.settings.auto ? pill('#e6f4ea', '#137333') : pill('#fef7e0', '#8a6d1a')), whiteSpace: 'normal' }}>
            {st.settings.auto ? '⏱ face singur varianta albă a testelor noi (la 2 ore)' : '⏱ oprit — doar din butoanele de aici'}
          </span>
          <button type="button" style={smallBtn} disabled={savingAuto} onClick={toggleAuto}>{st.settings.auto ? 'Oprește automat' : 'Pornește automat'}</button>
        </div>
      )}
      {c && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }}>
          <Tile icon="📄" label="Teste EN" value={c.total} sub="variante + simulări" active={filter === ''} onClick={() => pickFilter('')} />
          <Tile icon="⬜" label="Cu varianta albă" value={c.curatat} tone="green" sub="+ originalul" active={filter === 'curatat'} onClick={() => pickFilter('curatat')} />
          <Tile icon="🔍" label="De făcut" value={(c.de_curatat || 0) + (c.neverificat || 0)} tone="blue" sub={c.neverificat ? `${c.neverificat} încă neverificate` : null} active={filter === 'todo'} onClick={() => pickFilter('todo')} />
          <Tile icon="·" label="Fără dreptunghi" value={c.fara} tone="gray" sub="pe pagina 2" active={filter === 'fara'} onClick={() => pickFilter('fara')} />
          <Tile icon="⚠" label="Nesigure / erori" value={(c.nesigur || 0) + (c.eroare || 0)} tone={(c.nesigur || 0) + (c.eroare || 0) ? 'amber' : 'gray'} sub="rămân doar cu originalul" active={filter === 'probleme'} onClick={() => pickFilter('probleme')} />
          {c.ascuns ? <Tile icon="🙈" label="Ascunse" value={c.ascuns} tone="amber" sub="doar originalul" active={filter === 'ascuns'} onClick={() => pickFilter('ascuns')} /> : null}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" style={s.btnSecondary} disabled={!st || busy || otherBusy} onClick={() => run(true)}>🔍 Caută dreptunghiul (fără modificări)</button>
        <button type="button" style={s.btnPrimary} disabled={!st || busy || otherBusy} onClick={() => run(false)}>⬜ Pune alb peste dreptunghi acum</button>
      </div>
      <div style={{ ...muted, marginTop: 8, lineHeight: 1.6 }}>
        Pe pagina 2 a subiectelor de EN e un dreptunghi negru (spatele colțului secretizat al foii de examen). Botul face o
        {' '}<strong style={{ color: 'var(--navy)' }}>copie</strong> a testului cu un dreptunghi alb lipit peste el — acolo rămâne spațiu gol, alb.
        {' '}<strong style={{ color: 'var(--navy)' }}>Originalul nu se atinge</strong>: același nume, aceleași proprietăți (rubrică, gratuit / premium, ordine), același barem.
        În vizualizatorul PDF se deschide varianta albă; butonul <strong style={{ color: 'var(--navy)' }}>„⬛ Original"</strong> din bară arată originalul și devine
        {' '}<strong style={{ color: 'var(--navy)' }}>„⬜ Fără suprafață neagră"</strong>. Restul paginii e verificat prin randare, pixel cu pixel.
      </div>

      {running && (
        <div style={{ marginTop: 12, border: '1px solid #e6eaf0', borderRadius: 12, padding: 12, background: '#fbfcfe' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--navy)' }}>
              {running.dry ? '🔍 Caut dreptunghiul (fără modificări)' : '⬜ Pun alb peste dreptunghi'} {running.finished ? (running.error ? '— oprit de o eroare' : running.stopped ? '— oprit' : '— gata') : `— pasul ${running.steps + 1}…`}
            </strong>
            {!running.finished ? <button type="button" style={smallBtn} onClick={() => { stopRef.current = true; }}>■ Oprește după pasul curent</button>
              : <button type="button" style={smallBtn} onClick={() => setRunning(null)}>✕ Închide</button>}
          </div>
          {running.error && <div style={{ ...s.alert('error'), marginTop: 8 }}>{running.error}</div>}
          {(summary || running.progress) && (
            <div style={{ ...muted, marginTop: 6 }}>
              {summary || 'nimic nou încă'}
              {running.progress && running.progress.left ? ` · mai sunt ${running.progress.left}` : ''}
            </div>
          )}
          <div ref={logRef} style={logBox}>{(running.log || []).length ? running.log.join('\n') : 'Pornesc…'}</div>
        </div>
      )}

      {st && (
        <div style={{ marginTop: 12 }}>
          <button type="button" style={{ ...smallBtn, borderRadius: 999 }} onClick={() => setFilter(filter === null ? '' : null)}>
            {filter === null ? `▸ Arată testele (${c ? c.total : 0})` : '▾ Ascunde lista'}
          </button>
          {filter !== null && (
            <div style={{ marginTop: 8 }}>
              {!rows.length && <div style={{ ...muted, padding: '8px 4px' }}>Niciun test aici.</div>}
              {rows.map((r) => {
                const lab = P2_ST[r.status] || P2_ST.neverificat;
                const canMake = ['nesigur', 'eroare', 'de_curatat', 'neverificat'].includes(r.status);
                return (
                  <div key={r.id} style={rowBox}>
                    <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                      <a href={`/pdf-viewer?id=${r.id}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: 'var(--navy)' }}>{r.title}</a>
                      <div style={muted}>{SUB[r.subcategory] || r.subcategory}{r.is_free ? ' · gratuit' : ' · premium'}{r.at ? ` · ${r.by === 'cron' ? 'automat' : 'din Admin'}, ${fmtDate(r.at)}` : ''}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                        <span style={pill(lab.bg, lab.fg)}>{lab.label}</span>
                      </div>
                      {r.error && <div style={{ ...muted, color: '#8a6d1a', marginTop: 3 }}>{r.error}</div>}
                      {r.notes && r.notes.length ? <div style={{ ...muted, marginTop: 3 }}>{r.notes.join(' · ')}</div> : null}
                      {rowMsg[r.id] && <div style={{ ...muted, marginTop: 3, color: rowMsg[r.id].ok ? '#137333' : '#b3261e' }}>{rowMsg[r.id].text}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {rowBusy[r.id] ? <span style={muted}>{rowBusy[r.id]}</span> : (
                        <>
                          <button type="button" style={smallBtn} onClick={() => openFile(r.id, 'original')}>⬛ Originalul</button>
                          {r.alb && <button type="button" style={smallBtn} onClick={() => openFile(r.id, 'alb')}>⬜ Varianta albă</button>}
                          {r.status === 'curatat' && <button type="button" style={{ ...smallBtn, color: '#b45309' }} onClick={() => setHidden(r, true)}>🙈 Ascunde varianta albă</button>}
                          {r.status === 'ascuns' && <button type="button" style={smallBtn} onClick={() => setHidden(r, false)}>👁 Arată varianta albă</button>}
                          {canMake && <button type="button" style={smallBtn} disabled={busy || otherBusy} onClick={() => run(false, { ids: [r.id], force: true })}>⬜ Fă varianta albă</button>}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
