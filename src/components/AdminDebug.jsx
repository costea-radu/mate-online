// =====================================================================
// src/components/AdminDebug.jsx — Admin → „🐞 Agent debug"
//
// „▶ Rulează": agentul (implicit Claude Opus 5.5) citește codul site-ului de pe
// GitHub, pornește de la erorile reale (browserele vizitatorilor, testele
// automate, commiturile recente), verifică zona aleasă și propune corecturi.
// Nimic nu se schimbă fără acordul tău: aprobi corecturile → „Aplică" face un
// pull request pe GitHub → testele și build-ul rulează automat → „Publică" le
// pune pe site (merge → Vercel). Fără token GitHub: raportul + fișier .patch.
// Serverul: api/admin-debug.js + api/_lib/debugAgent.js + api/_lib/github.js.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '../lib/api';

const SEV = {
  critica: { label: 'Gravă', bg: '#fce8e6', fg: '#b3261e', bar: '#d93025' },
  majora: { label: 'Majoră', bg: '#fdecd8', fg: '#b45309', bar: '#e8710a' },
  minora: { label: 'Minoră', bg: '#fef7e0', fg: '#8a6d1a', bar: '#f9ab00' },
  info: { label: 'Info', bg: '#f1f3f4', fg: '#5f6368', bar: '#9aa0a6' },
};
const KIND = { bug: '🐞 Bug', securitate: '🔒 Securitate', plati: '💳 Plăți', date: '🗄 Date', performanta: '⚡ Performanță', ux: '📱 Interfață', cost_ai: '💰 Cost AI', imbunatatire: '✨ Îmbunătățire' };
const STATUS = {
  ruleaza: { label: '⏳ Rulează', bg: '#e8f0fe', fg: '#1a56c4' },
  gata: { label: '✓ Gata', bg: '#e6f4ea', fg: '#137333' },
  oprit: { label: '⏹ Oprit', bg: '#f1f3f4', fg: '#5f6368' },
  eroare: { label: '⛔ Eroare', bg: '#fce8e6', fg: '#b3261e' },
};
const EFFORTS = [
  { id: 'high', label: 'Atent', hint: 'recomandat' },
  { id: 'xhigh', label: 'Foarte atent', hint: 'citește și verifică mai mult — mai scump' },
  { id: 'max', label: 'Maxim', hint: 'pentru o problemă grea, greu de găsit' },
];
const pill = (bg, fg) => ({ display: 'inline-block', background: bg, color: fg, borderRadius: 12, padding: '2px 9px', fontSize: '.74rem', fontWeight: 700, whiteSpace: 'nowrap' });
const smallBtn = { background: '#fff', border: '1px solid #dde1e8', borderRadius: 8, padding: '5px 10px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer', color: 'var(--navy)' };
const fmtLei = (x) => (x == null ? '—' : x < 0.1 ? '< 0,1' : x.toFixed(2).replace('.', ','));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

export default function AdminDebug({ s }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const [scope, setScope] = useState('general');
  const [focus, setFocus] = useState('');
  const [model, setModel] = useState('claude-opus-5-5');
  const [effort, setEffort] = useState('high');
  const [budget, setBudget] = useState(20);
  const [run, setRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [driving, setDriving] = useState(false);
  const [busy, setBusy] = useState(null);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [clientErrors, setClientErrors] = useState(null);
  const stopRef = useRef(false);
  const logRef = useRef(null);

  async function loadStatus() {
    try {
      const r = await apiPost('/api/admin-debug', { action: 'status' });
      setSt(r); setErr(null);
      if (r.defaults?.budgetLei) setBudget((b) => (b === 20 ? r.defaults.budgetLei : b));
    } catch (e) { setErr(e.message); }
  }
  async function loadRuns(openLatest = false) {
    try {
      const r = await apiPost('/api/admin-debug', { action: 'list' });
      setRuns(r.runs || []);
      if (openLatest && r.runs?.length && !run) {
        const g = await apiPost('/api/admin-debug', { action: 'get', runId: r.runs[0].id });
        setRun(g.run);
      }
    } catch { /* tabela lipsește: se vede în stare */ }
  }
  useEffect(() => { loadStatus(); loadRuns(true); return () => { stopRef.current = true; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [run?.log?.length]);

  // pașii rulării: fiecare cerere durează câteva minute; continuăm până e „gata"
  async function drive(id) {
    stopRef.current = false;
    setDriving(true);
    let fails = 0;
    try {
      for (;;) {
        if (stopRef.current) break;
        let r;
        try { r = await apiPost('/api/admin-debug', { action: 'step', runId: id }); fails = 0; }
        catch (e) {
          fails++;
          setErr(`Pasul a eșuat (${e.message}) — reîncerc (${fails}/4)…`);
          if (fails >= 4 || e.status === 403 || e.status === 503) break;
          await sleep(5000 * fails);
          continue;
        }
        setErr(null);
        setRun(r.run);
        if (r.run.status !== 'ruleaza') break;
        if (r.busy) await sleep(6000);
      }
    } finally {
      setDriving(false);
      loadRuns();
    }
  }

  async function start() {
    setBusy('start'); setErr(null);
    try {
      const r = await apiPost('/api/admin-debug', { action: 'start', scope, focus, model, effort, budgetLei: budget });
      setRun(r.run);
      loadRuns();
      drive(r.run.id);
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  async function act(action, extra = {}, label = action) {
    setBusy(label); setErr(null);
    try {
      const r = await apiPost('/api/admin-debug', { action, runId: run.id, ...extra });
      if (r.run) setRun(r.run);
      return r;
    } catch (e) { setErr(e.message); return null; }
    finally { setBusy(null); }
  }

  async function downloadPatch() {
    const r = await act('patch', {}, 'patch');
    if (!r?.patch) return;
    const url = URL.createObjectURL(new Blob([r.patch], { type: 'text/x-diff' }));
    const a = document.createElement('a');
    a.href = url; a.download = r.name || 'agent-debug.patch';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // starea PR-ului se reîmprospătează singură cât rulează testele
  useEffect(() => {
    if (!run?.pr?.number || run.pr.merged || run.pr.closed) return undefined;
    let alive = true;
    const tick = async () => {
      try { const r = await apiPost('/api/admin-debug', { action: 'pr_status', runId: run.id }); if (alive) setRun(r.run); } catch { /* reîncercăm */ }
    };
    tick();
    const t = setInterval(tick, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [run?.id, run?.pr?.number, run?.pr?.merged, run?.pr?.closed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openRun(id) {
    try { const r = await apiPost('/api/admin-debug', { action: 'get', runId: id }); setRun(r.run); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { setErr(e.message); }
  }
  async function loadErrors() {
    setErrorsOpen(true);
    try { const r = await apiPost('/api/admin-debug', { action: 'errors' }); setClientErrors(r.errors || []); }
    catch (e) { setClientErrors([]); setErr(e.message); }
  }

  const ready = st && st.hasKey && st.setup && !st.githubError;
  const approved = (run?.fixes || []).filter((f) => f.decision === 'aprobat').length;
  const prOpen = run?.pr && !run.pr.merged && !run.pr.closed;
  const cur = st?.models?.find((m) => m.id === model);

  return (
    <div>
      <div style={s.card}>
        <div style={s.cardTitle}>🐞 Agentul de debug</div>
        <div style={s.infoBox}>
          La <b>„▶ Rulează"</b>, agentul citește <b>codul real</b> al site-ului (de pe GitHub), pornește de la <b>erorile reale</b> (din browserele vizitatorilor, din testele automate, din commiturile recente)
          și verifică zona aleasă: erori, logică greșită, securitate, plăți, telefon, costuri AI. Îți dă un raport și <b>propune corecturi</b>, fiecare cu diferențele exacte.
          <b> Nimic nu se schimbă fără acordul tău:</b> aprobi corecturile → „Aplică" face un pull request pe GitHub → testele și build-ul rulează automat → <b>„Publică"</b> le pune pe site.
        </div>
        {st && <SetupRow st={st} onErrors={loadErrors} />}
        {st && (!st.token || st.ciWorkflow === false || !st.setup) && <SetupHelp st={st} />}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 14, marginTop: 14 }}>
          <div>
            <label style={s.label}>Ce să verifice</label>
            <select style={s.select} value={scope} onChange={(e) => setScope(e.target.value)} disabled={driving}>
              {Object.entries(st?.scopes || { general: 'Verificare generală' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Detalii (opțional)</label>
            <textarea style={{ ...s.textarea, minHeight: 64 }} value={focus} disabled={driving} onChange={(e) => setFocus(e.target.value)}
              placeholder={'ex. „Un elev spune că la 1-la-1, după ⏭, sala rămâne neagră pe iPhone.” sau „Verifică plățile pentru biletele de grup.”'} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0 4px' }}>
          <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>🧠 Model:</span>
          {(st?.models || []).filter((m) => ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5'].includes(m.id)).map((m) => (
            <button key={m.id} type="button" disabled={driving} title={m.note} onClick={() => setModel(m.id)}
              style={{ border: model === m.id ? '2px solid var(--navy)' : '1px solid var(--border)', background: model === m.id ? 'var(--navy)' : '#fff', color: model === m.id ? '#fff' : 'var(--navy)', borderRadius: 20, padding: '4px 12px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer' }}>
              {m.label}{m.id === 'claude-opus-5-5' ? ' ★' : ''}
            </button>
          ))}
          <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginLeft: 10 }}>🎯 Atenția:</span>
          {EFFORTS.map((e) => (
            <button key={e.id} type="button" title={e.hint} disabled={driving} onClick={() => setEffort(e.id)}
              style={{ ...smallBtn, borderRadius: 20, background: effort === e.id ? 'var(--navy)' : '#fff', color: effort === e.id ? '#fff' : 'var(--navy)' }}>{e.label}</button>
          ))}
        </div>
        <p style={{ fontSize: '.76rem', color: '#1a56c4', margin: '2px 0 12px' }}>
          ★ <b>Opus 5.5</b> e alegerea potrivită aici: e făcut pentru sesiuni lungi de citit și reparat cod (și e mai ieftin decât Opus 5). {cur?.price ? `${cur.price.in}/${cur.price.out} $ pe milion de tokeni; ` : ''}o rulare obișnuită costă câțiva lei (cache-ul de prompt ieftinește pașii repetați).
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...s.btnPrimary, fontSize: '1rem', padding: '12px 28px' }} disabled={!ready || driving || !!busy || (scope === 'custom' && !focus.trim())} onClick={start}>
            {busy === 'start' ? 'Pornesc…' : driving ? '⏳ Rulează…' : '▶ Rulează'}
          </button>
          <label style={{ fontSize: '.8rem', color: '#5a6170' }}>Buget maxim <input type="number" min={1} max={200} value={budget} disabled={driving} onChange={(e) => setBudget(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64, padding: '5px 6px', border: '1px solid #dde1e8', borderRadius: 6 }} /> lei</label>
          {run?.status === 'ruleaza' && !driving && <button type="button" style={smallBtn} onClick={() => drive(run.id)}>▶ Continuă rularea</button>}
          {driving && <button type="button" style={s.btnDanger} onClick={async () => { stopRef.current = true; await act('stop', {}, 'stop'); }}>⏹ Oprește</button>}
        </div>
        {err && <div style={{ ...s.alert('error'), marginTop: 12 }}>{err}</div>}
      </div>

      {run && (
        <div style={s.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={pill((STATUS[run.status] || STATUS.gata).bg, (STATUS[run.status] || STATUS.gata).fg)}>{(STATUS[run.status] || STATUS.gata).label}</span>
            <b style={{ color: 'var(--navy)' }}>{st?.scopes?.[run.scope] || run.scope}{run.scope === 'general' && run.area ? ` → ${st?.scopes?.[run.area] || run.area}` : ''}</b>
            <span style={{ fontSize: '.8rem', color: '#5a6170' }}>
              {new Date(run.created_at).toLocaleString('ro-RO')} · {st?.models?.find((m) => m.id === run.model)?.label || run.model} · {run.turns} pași · {fmtLei(run.cost_lei)} lei{run.budget_lei ? ` din ${run.budget_lei}` : ''} · commit {String(run.base_sha || '').slice(0, 7)}
            </span>
          </div>
          {run.focus && <div style={{ fontSize: '.85rem', color: '#3c4043', marginBottom: 10 }}>📝 „{run.focus}"</div>}
          {run.error && <div style={s.alert('error')}>{run.error}</div>}

          <div ref={logRef} style={{ maxHeight: 220, overflowY: 'auto', background: '#0f1b2b', color: '#cfd8e3', borderRadius: 10, padding: '10px 12px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.76rem', lineHeight: 1.55, marginBottom: 14 }}>
            {(run.log || []).length === 0 && <div style={{ opacity: .6 }}>Pornesc…</div>}
            {(run.log || []).map((l, k) => (
              <div key={k} style={{ color: l.kind === 'finding' ? '#ffb4a9' : l.kind === 'fix' ? '#a8dab5' : l.kind === 'error' ? '#ff8a80' : l.kind === 'think' ? '#9fb3c8' : undefined }}>
                <span style={{ opacity: .45 }}>{String(l.t || '').slice(11, 19)} </span>{l.text}
              </div>
            ))}
            {driving && <div style={{ opacity: .6 }}>… (fiecare pas durează până la câteva minute)</div>}
          </div>

          {run.report && (
            <div style={{ background: '#f7f9fc', border: '1px solid #e3e8ef', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <Markdown text={run.report} />
            </div>
          )}

          {(run.findings || []).length > 0 && (
            <>
              <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '4px 0 8px' }}>Probleme găsite ({run.findings.length})</h3>
              {run.findings.map((f) => (
                <div key={f.id} style={{ background: '#fff', border: '1px solid #e3e8ef', borderLeft: `4px solid ${(SEV[f.severity] || SEV.info).bar}`, borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
                    <b style={{ color: '#5f6368' }}>{f.id}</b>
                    <span style={pill((SEV[f.severity] || SEV.info).bg, (SEV[f.severity] || SEV.info).fg)}>{(SEV[f.severity] || SEV.info).label}</span>
                    <span style={pill('#f1f3f4', '#3c4043')}>{KIND[f.kind] || f.kind}</span>
                    <code style={{ fontSize: '.76rem', color: '#1a56c4' }}>{f.file}{f.line ? `:${f.line}` : ''}</code>
                  </div>
                  <div style={{ fontWeight: 700, color: '#202124' }}>{f.title}</div>
                  <div style={{ fontSize: '.85rem', color: '#3c4043', whiteSpace: 'pre-wrap', marginTop: 4 }}>{f.details}</div>
                  {f.suggestion && <div style={{ fontSize: '.82rem', color: '#137333', marginTop: 4 }}>💡 {f.suggestion}</div>}
                </div>
              ))}
            </>
          )}

          {(run.fixes || []).length > 0 && (
            <>
              <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '14px 0 8px' }}>Corecturi propuse ({run.fixes.length}) · aprobate: {approved}</h3>
              {run.fixes.map((f) => (
                <FixCard key={f.id} f={f} finding={(run.findings || []).find((x) => x.id === f.finding_id)} locked={!!(run.pr && !run.pr.closed)} busy={!!busy}
                  onDecide={(decision) => act('decide', { fixId: f.id, decision }, `decide-${f.id}`)} />
              ))}
              {!(run.pr && !run.pr.closed) && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                  <button type="button" style={s.btnPrimary} disabled={!approved || !!busy || run.status === 'ruleaza' || !st?.token}
                    onClick={async () => { if (window.confirm(`Creez un pull request pe GitHub cu ${approved} ${approved === 1 ? 'corectură' : 'corecturi'}? Site-ul NU se schimbă până nu apeși „Publică".`)) await act('apply', {}, 'apply'); }}>
                    {busy === 'apply' ? '⏳ Creez pull request-ul…' : `🚀 Aplică corecturile aprobate (${approved})`}
                  </button>
                  <button type="button" style={smallBtn} disabled={!approved || !!busy} onClick={downloadPatch}>⬇ Descarcă .patch</button>
                  {!st?.token && <span style={{ fontSize: '.78rem', color: '#8a6d1a' }}>Fără GITHUB_TOKEN: descarcă .patch și aplică-l cu <code>git apply</code>, sau pune tokenul (ghidul).</span>}
                </div>
              )}
            </>
          )}

          {run.pr && <PrPanel s={s} pr={run.pr} busy={busy}
            onRefresh={() => act('pr_status', {}, 'pr')}
            onMerge={async () => {
              const pending = run.pr.ci === 'in_lucru' || run.pr.ci === 'fara';
              const msg = run.pr.ci === 'trecut' ? 'Testele și build-ul au trecut. Public corecturile pe site (merge în main → Vercel)?' : `Atenție: verificările automate sunt „${run.pr.ci || 'necunoscute'}". Public totuși?`;
              if (window.confirm(msg)) await act('merge', pending || run.pr.ci === 'esuat' ? { force: true } : {}, 'merge');
            }}
            onClose={async () => { if (window.confirm('Închid pull request-ul? Nimic nu se schimbă pe site.')) await act('close_pr', {}, 'close'); }} />}
          {prOpen && run.pr.ci === 'esuat' && <div style={{ ...s.alert('error'), marginTop: 10 }}>Testele sau build-ul au picat pe acest PR. Deschide verificarea picată pe GitHub ca să vezi de ce, sau închide PR-ul și rulează agentul din nou cu detaliile erorii.</div>}
        </div>
      )}

      {runs.length > 0 && (
        <div style={s.card}>
          <div style={s.cardTitle}>📜 Rulările anterioare</div>
          <table style={s.table}>
            <thead><tr><th style={s.th}>Data</th><th style={s.th}>Zona</th><th style={s.th}>Stare</th><th style={s.th}>Probleme</th><th style={s.th}>Corecturi</th><th style={s.th}>PR</th><th style={s.th}>Cost</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => openRun(r.id)} style={{ cursor: 'pointer', background: run?.id === r.id ? '#f8fbff' : undefined }}>
                  <td style={s.td}>{new Date(r.created_at).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td style={{ ...s.td, fontSize: '.82rem' }}>{st?.scopes?.[r.scope === 'general' ? r.area : r.scope] || r.area || r.scope}{r.focus ? ` · „${r.focus.slice(0, 40)}${r.focus.length > 40 ? '…' : ''}"` : ''}</td>
                  <td style={s.td}><span style={pill((STATUS[r.status] || STATUS.gata).bg, (STATUS[r.status] || STATUS.gata).fg)}>{(STATUS[r.status] || STATUS.gata).label}</span></td>
                  <td style={s.td}>{r.findings}{r.critical ? <span style={{ color: '#b3261e', fontWeight: 700 }}> ({r.critical} grave)</span> : ''}</td>
                  <td style={s.td}>{r.fixes}{r.approved ? ` · ${r.approved} aprobate` : ''}</td>
                  <td style={s.td}>{r.pr ? <a href={r.pr.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>#{r.pr.number}</a> : '—'}{r.pr?.merged ? ' ✅' : ''}</td>
                  <td style={s.td}>{fmtLei(r.cost_lei)} lei</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errorsOpen && (
        <div style={s.card}>
          <div style={{ ...s.cardTitle, display: 'flex', justifyContent: 'space-between' }}>
            <span>🧯 Erorile din browserele vizitatorilor</span>
            <button type="button" style={smallBtn} onClick={() => setErrorsOpen(false)}>✕</button>
          </div>
          {!clientErrors ? <div style={{ color: '#8e95a3' }}>Se încarcă…</div> : clientErrors.length === 0 ? <div style={{ color: '#137333' }}>Nicio eroare raportată. 🎉</div> : (
            <table style={s.table}>
              <thead><tr><th style={s.th}>De câte ori</th><th style={s.th}>Eroarea</th><th style={s.th}>Pagina</th><th style={s.th}>Ultima dată</th></tr></thead>
              <tbody>
                {clientErrors.map((e) => (
                  <tr key={e.fingerprint}>
                    <td style={{ ...s.td, fontWeight: 700 }}>{e.count}×</td>
                    <td style={{ ...s.td, fontSize: '.8rem' }}><div style={{ fontWeight: 600 }}>{e.message}</div>{e.stack && <details><summary style={{ cursor: 'pointer', color: '#5f6368' }}>stiva</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: '.72rem', margin: 0 }}>{e.stack}</pre></details>}</td>
                    <td style={{ ...s.td, fontSize: '.8rem' }}>{e.url}</td>
                    <td style={{ ...s.td, fontSize: '.8rem' }}>{new Date(e.last_seen).toLocaleString('ro-RO')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: '.78rem', color: '#8e95a3', marginTop: 8 }}>Le folosește automat agentul (zona „Erorile reale din site"). Se șterg singure după 60 de zile.</p>
        </div>
      )}
    </div>
  );
}

function SetupRow({ st, onErrors }) {
  const item = (ok, text, title = '') => (
    <span title={title} style={pill(ok === true ? '#e6f4ea' : ok === false ? '#fce8e6' : '#f1f3f4', ok === true ? '#137333' : ok === false ? '#b3261e' : '#5f6368')}>{ok === true ? '✓' : ok === false ? '✗' : '?'} {text}</span>
  );
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {item(st.hasKey, 'Claude (ANTHROPIC_API_KEY)')}
      {item(!st.githubError, `GitHub: ${st.repo}@${st.branch}${st.head?.sha ? ` · ${st.head.sha.slice(0, 7)}` : ''}`, st.githubError || st.head?.message || '')}
      {item(st.token, st.token ? 'Token GitHub (pull request-uri)' : 'Fără token GitHub — doar raport + .patch')}
      {item(st.ciWorkflow, st.ciWorkflow ? 'Teste automate (GitHub Actions)' : 'Fără teste automate pe GitHub')}
      {item(st.setup, st.setup ? 'Tabelele' : 'Lipsește SQL-ul')}
      {st.errors7d != null && <button type="button" onClick={onErrors} style={{ ...smallBtn, padding: '2px 9px', borderRadius: 12, fontSize: '.74rem' }}>🧯 {st.errors7d} {st.errors7d === 1 ? 'eroare' : 'erori'} din site (7 zile) →</button>}
    </div>
  );
}

function SetupHelp({ st }) {
  return (
    <details style={{ marginTop: 10, background: '#fffbe6', border: '1px solid #f3e1a6', borderRadius: 10, padding: '10px 14px' }} open={!st.setup}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#7a5b00' }}>Ce mai trebuie configurat (o singură dată)</summary>
      <ol style={{ fontSize: '.84rem', color: '#3c4043', lineHeight: 1.6, margin: '8px 0 0 18px' }}>
        {!st.setup && <li>Supabase → SQL Editor: rulează <code>supabase/agenti_verificare_debug.sql</code>.</li>}
        {!st.token && <li>GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> → Generate: doar depozitul <code>{st.repo}</code>, permisiuni <b>Contents: Read and write</b> și <b>Pull requests: Read and write</b> (plus, doar citire: <b>Actions</b>, <b>Checks</b>, <b>Commit statuses</b> — pentru rezultatul testelor). Pune tokenul în Vercel → Settings → Environment Variables ca <code>GITHUB_TOKEN</code>, apoi Redeploy.</li>}
        {st.ciWorkflow === false && <li>Fișierul <code>.github/workflows/verificare.yml</code> (e în livrare) trebuie urcat pe GitHub, ca testele și build-ul să ruleze la fiecare pull request.</li>}
      </ol>
    </details>
  );
}

function FixCard({ f, finding, locked, busy, onDecide }) {
  const [open, setOpen] = useState(false);
  const color = f.decision === 'aprobat' ? '#137333' : f.decision === 'respins' ? '#b3261e' : '#e3e8ef';
  return (
    <div style={{ background: '#fff', border: `1px solid ${f.decision ? color : '#e3e8ef'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ color: '#5f6368' }}>{f.id}</b>
        <span style={pill(f.risk === 'mic' ? '#e6f4ea' : f.risk === 'mare' ? '#fce8e6' : '#fef7e0', f.risk === 'mic' ? '#137333' : f.risk === 'mare' ? '#b3261e' : '#8a6d1a')}>risc {f.risk}</span>
        <span style={{ fontWeight: 700, color: '#202124', flex: 1, minWidth: 200 }}>{f.title}</span>
        <span style={{ fontSize: '.76rem', color: '#5f6368' }}>{(f.files || []).map((x) => x.path + (x.created ? ' (nou)' : '')).join(', ')} · <span style={{ color: '#137333' }}>+{f.added}</span> <span style={{ color: '#b3261e' }}>−{f.removed}</span></span>
      </div>
      {finding && <div style={{ fontSize: '.78rem', color: '#5f6368', marginTop: 3 }}>repară {finding.id}: {finding.title}</div>}
      <div style={{ fontSize: '.85rem', color: '#3c4043', whiteSpace: 'pre-wrap', marginTop: 6 }}>{f.explanation}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" style={smallBtn} onClick={() => setOpen(!open)}>{open ? '▾ Ascunde diferențele' : '▸ Vezi diferențele'}</button>
        <span style={{ flex: 1 }} />
        {f.decision === 'aprobat'
          ? <span style={{ ...pill('#e6f4ea', '#137333'), alignSelf: 'center' }}>✓ Aprobată</span>
          : f.decision === 'respins' ? <span style={{ ...pill('#fce8e6', '#b3261e'), alignSelf: 'center' }}>✕ Respinsă</span> : null}
        {!locked && (<>
          {f.decision !== 'aprobat' && <button type="button" disabled={busy} style={{ ...smallBtn, borderColor: '#137333', color: '#137333' }} onClick={() => onDecide('aprobat')}>✓ Aprob</button>}
          {f.decision !== 'respins' && <button type="button" disabled={busy} style={{ ...smallBtn, borderColor: '#f5c6cb', color: '#b3261e' }} onClick={() => onDecide('respins')}>✕ Resping</button>}
          {f.decision && <button type="button" disabled={busy} style={smallBtn} onClick={() => onDecide(null)}>↺</button>}
        </>)}
      </div>
      {open && (f.diff || []).map((d) => (
        <div key={d.path} style={{ marginTop: 8 }}>
          <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.76rem', fontWeight: 700, color: 'var(--navy)' }}>{d.path}{d.created ? ' (fișier nou)' : ''}</div>
          <div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '.74rem', background: '#fff', border: '1px solid #e3e8ef', borderRadius: 8, overflowX: 'auto' }}>
            {(d.hunks || []).map((h, k) => (
              <div key={k} style={{ borderBottom: '1px solid #eef1f5' }}>
                <div style={{ background: '#f1f3f4', color: '#5f6368', padding: '2px 8px' }}>@@ rândul {h.startA ?? h.startB}</div>
                {h.lines.map(([op, t], j) => (
                  <div key={j} style={{ whiteSpace: 'pre', padding: '0 8px', background: op === '-' ? '#fce8e6' : op === '+' ? '#e6f4ea' : undefined }}>{op === ' ' ? ' ' : op} {t}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PrPanel({ s, pr, busy, onRefresh, onMerge, onClose }) {
  const ci = pr.ci || (pr.merged ? 'trecut' : 'in_lucru');
  const ciLook = { trecut: ['✅ Testele și build-ul au trecut', '#e6f4ea', '#137333'], esuat: ['❌ Testele sau build-ul au picat', '#fce8e6', '#b3261e'], in_lucru: ['⏳ Testele rulează…', '#e8f0fe', '#1a56c4'], fara: ['ℹ Fără verificări automate', '#f1f3f4', '#5f6368'] }[ci] || ['…', '#f1f3f4', '#5f6368'];
  return (
    <div style={{ marginTop: 14, border: '2px solid var(--gold)', borderRadius: 12, padding: '12px 16px', background: '#fffdf5' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ color: 'var(--navy)' }}>Pull request <a href={pr.url} target="_blank" rel="noreferrer">#{pr.number}</a></b>
        {pr.merged ? <span style={pill('#e6f4ea', '#137333')}>✅ Publicat pe site</span> : pr.closed ? <span style={pill('#f1f3f4', '#5f6368')}>Închis</span> : <span style={pill(ciLook[1], ciLook[2])}>{ciLook[0]}</span>}
        {pr.preview && !pr.merged && <a href={pr.preview} target="_blank" rel="noreferrer" style={{ fontSize: '.8rem' }}>↗ Previzualizare Vercel</a>}
        <span style={{ flex: 1 }} />
        {!pr.merged && !pr.closed && (<>
          <button type="button" style={smallBtn} disabled={!!busy} onClick={onRefresh}>{busy === 'pr' ? '…' : '↻'}</button>
          <button type="button" style={{ ...smallBtn, color: '#b3261e', borderColor: '#f5c6cb' }} disabled={!!busy} onClick={onClose}>✕ Închide PR</button>
          <button type="button" style={s.btnPrimary} disabled={!!busy || ci === 'esuat'} onClick={onMerge}>{busy === 'merge' ? '⏳ Public…' : '✅ Publică pe site'}</button>
        </>)}
      </div>
      {(pr.checks || []).length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {pr.checks.map((c, k) => {
            const ok = c.status === 'completed' && ['success', 'neutral', 'skipped'].includes(c.conclusion);
            const bad = c.status === 'completed' && !ok;
            return <a key={k} href={c.url || pr.url} target="_blank" rel="noreferrer" style={{ ...pill(ok ? '#e6f4ea' : bad ? '#fce8e6' : '#e8f0fe', ok ? '#137333' : bad ? '#b3261e' : '#1a56c4'), textDecoration: 'none' }}>{ok ? '✓' : bad ? '✗' : '⏳'} {c.name}</a>;
          })}
        </div>
      )}
      {pr.merged && <div style={{ fontSize: '.82rem', color: '#137333', marginTop: 6 }}>Vercel publică versiunea nouă în 1–2 minute. (Pe telefoane, aplicația se actualizează la următoarea deschidere.)</div>}
    </div>
  );
}

// raportul agentului (titluri ##, liste, **bold**, `cod`) — fără HTML din model
function Markdown({ text }) {
  const inline = (t, key) => {
    const parts = String(t).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={`${key}-${i}`}>{p.slice(2, -2)}</b>
      : p.startsWith('`') && p.endsWith('`') ? <code key={`${key}-${i}`} style={{ background: '#eef1f5', padding: '0 4px', borderRadius: 4, fontSize: '.85em' }}>{p.slice(1, -1)}</code> : p));
  };
  const lines = String(text || '').split('\n');
  return (
    <div style={{ fontSize: '.88rem', color: '#202124', lineHeight: 1.55 }}>
      {lines.map((l, k) => {
        if (/^#{1,4}\s/.test(l)) return <div key={k} style={{ fontWeight: 800, color: 'var(--navy)', marginTop: k ? 10 : 0, marginBottom: 4 }}>{inline(l.replace(/^#+\s*/, ''), k)}</div>;
        if (/^\s*[-*•]\s/.test(l)) return <div key={k} style={{ paddingLeft: 16, textIndent: -10 }}>• {inline(l.replace(/^\s*[-*•]\s/, ''), k)}</div>;
        if (!l.trim()) return <div key={k} style={{ height: 6 }} />;
        return <div key={k}>{inline(l, k)}</div>;
      })}
    </div>
  );
}
