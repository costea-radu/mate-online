// =====================================================================
// src/components/AgentScheduledTasks.jsx — „Create scheduled task" pentru
// agentul Claude de exerciții (admin), ca task-urile programate din
// Claude.ai, dar cu RUBRICA site-ului pe post de context: alegi clasa /
// tipul de examen în care lucrează agentul, iar el generează SINGUR, după
// program (zilnic / săptămânal / lunar, la ora aleasă — ora României), și:
//   • postează AUTOMAT pe site în rubrica aleasă (dacă bifezi asta), sau
//   • lasă rezultatul „în așteptare" — îl previzualizezi și îl postezi
//     cu un click de aici (+ primești email la fiecare rulare).
// Serverul: api/agent-tasks.js (CRUD + rulare manuală) și api/agent-cron.js
// (cronul orar Vercel). Tabelele: supabase/agent_tasks.sql.
// =====================================================================
import { useState, useEffect, useRef } from 'react';
import { aiClient } from '../lib/aiClient';
import { renderExercise } from '../lib/exerciseRender';
import { DEFAULT_AI_MODEL } from '../lib/aiModels';
import AIModelPicker from './AIModelPicker';

const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4, boxSizing: 'border-box' };
const lbl = { fontSize: '.82rem', color: 'var(--text-light)' };
const smallBtn = { background: '#f7f9fc', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600 };
const chip = (bg, fg) => ({ fontSize: '.72rem', fontWeight: 700, background: bg, color: fg, borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' });

const WEEKDAYS = ['luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă', 'duminică']; // 1..7

const EMPTY_FORM = {
  name: '', rubricKey: '', schedule_kind: 'weekly', run_hour: 7, run_weekday: 1, run_monthday: 1,
  result_kind: 'auto', data_mode: 'modify', instructions: '', ai_model: DEFAULT_AI_MODEL,
  auto_post: false, is_free: false, post_type: 'test', notify: true,
  extraKeys: [],            // context suplimentar: alte rubrici (ex. baremele), max 3
  formatFile: null,         // model de format NOU încărcat: {name, html?|pdf?}
  existingFormatName: null, // numele modelului de format deja salvat (la editare)
  removeFormat: false,      // la editare: scoate modelul de format existent
};

const rubricKeyOf = (t) => `${t.category}||${t.subcategory || ''}||${t.profile || ''}||${t.ctype}`;

function scheduleText(t) {
  const h = `${String(t.run_hour).padStart(2, '0')}:00`;
  if (t.schedule_kind === 'daily') return `zilnic la ${h}`;
  if (t.schedule_kind === 'monthly') return `pe ${t.run_monthday} ale lunii la ${h}`;
  return `în fiecare ${WEEKDAYS[(t.run_weekday || 1) - 1]} la ${h}`;
}

// Următoarea rulare estimată (afișare; ora exactă o decide cronul, ora României)
function nextRunText(t) {
  if (!t.enabled) return 'oprit';
  const now = new Date();
  for (let d = 0; d < 63; d++) {
    const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, t.run_hour, 0, 0, 0);
    if (c <= now) continue;
    const wd = ((c.getDay() + 6) % 7) + 1; // 1=luni…7=duminică
    if (t.schedule_kind === 'weekly' && wd !== (t.run_weekday || 1)) continue;
    if (t.schedule_kind === 'monthly' && c.getDate() !== (t.run_monthday || 1)) continue;
    return c.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) + ` ${String(t.run_hour).padStart(2, '0')}:00`;
  }
  return '—';
}

function statusChip(status) {
  if (status === 'posted') return <span style={chip('rgba(39,174,96,.12)', '#1e7e34')}>✅ postat pe site</span>;
  if (status === 'pending_review') return <span style={chip('#fff4e5', '#8a6d00')}>🕓 așteaptă aprobare</span>;
  if (status === 'error') return <span style={chip('#fdecea', '#b71c1c')}>⚠️ eroare</span>;
  return <span style={chip('#eef1f6', '#5a6379')}>—</span>;
}

export default function AgentScheduledTasks({ rubrics = [], box = {} }) {
  const [tasks, setTasks] = useState([]);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [f, setF] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState(null);   // task în „Rulează acum"
  const [openRuns, setOpenRuns] = useState(null);      // taskId cu istoricul deschis
  const [runs, setRuns] = useState([]);
  const [runsBusy, setRunsBusy] = useState(false);
  const [preview, setPreview] = useState(null);        // {title, html}
  const [busyRun, setBusyRun] = useState(null);        // runId în postare/ștergere
  const formatFileRef = useRef(null);                  // inputul de fișier al modelului de format

  const patch = (p) => setF((x) => ({ ...x, ...p }));

  // Modelul de format (rezultat „după modelul de format"): fișier local PDF/HTML
  async function onFormatFile(file) {
    setError(null);
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) { setError('Modelul de format e prea mare (max 2,5 MB).'); return; }
    if (/\.pdf$/i.test(file.name)) {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      patch({ formatFile: { name: file.name, pdf: b64, html: null }, removeFormat: false });
    } else if (/\.html?$/i.test(file.name)) {
      const raw = await file.text();
      patch({ formatFile: { name: file.name, html: raw.slice(0, 250000), pdf: null }, removeFormat: false });
    } else {
      setError('Modelul de format: doar fișiere PDF sau HTML.');
    }
    if (formatFileRef.current) formatFileRef.current.value = '';
  }

  async function load() {
    setError(null);
    try {
      const r = await aiClient.agentTasks({ action: 'list' });
      setTasks(r.tasks || []);
      setWarning(r.warning || null);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditId(null);
    setF({ ...EMPTY_FORM, rubricKey: rubrics[0] ? rubricKeyOf(rubrics[0]) : '' });
    setFormOpen(true); setMsg(null); setError(null);
  }
  function openEdit(t) {
    setEditId(t.id);
    setF({
      name: t.name, rubricKey: rubricKeyOf(t), schedule_kind: t.schedule_kind,
      run_hour: t.run_hour, run_weekday: t.run_weekday, run_monthday: t.run_monthday,
      result_kind: t.result_kind, data_mode: t.data_mode, instructions: t.instructions || '',
      ai_model: t.ai_model || DEFAULT_AI_MODEL, auto_post: !!t.auto_post, is_free: !!t.is_free,
      post_type: t.post_type || 'test', notify: t.notify !== false,
      extraKeys: (t.extra_rubrics || []).map(rubricKeyOf),
      formatFile: null,
      existingFormatName: t.format_model?.name || null,
      removeFormat: false,
    });
    setFormOpen(true); setMsg(null); setError(null);
  }

  // Contextul suplimentar: adaugă/scoate o rubrică din lista de chips (max 3)
  function addExtraKey(key) {
    if (!key) return;
    setF((x) => {
      if (key === x.rubricKey || x.extraKeys.includes(key) || x.extraKeys.length >= 3) return x;
      return { ...x, extraKeys: [...x.extraKeys, key] };
    });
  }
  const delExtraKey = (key) => setF((x) => ({ ...x, extraKeys: x.extraKeys.filter((k) => k !== key) }));
  const rubricByKey = (key) => rubrics.find((r) => rubricKeyOf(r) === key) || null;

  async function save() {
    const r = rubrics.find((x) => rubricKeyOf(x) === f.rubricKey);
    if (!f.name.trim()) { setError('Dă-i task-ului un nume.'); return; }
    if (!r) { setError('Alege rubrica (clasa / tipul de examen).'); return; }
    if (f.result_kind === 'format' && !f.formatFile && (!f.existingFormatName || f.removeFormat)) {
      setError('Rezultatul „după modelul de format” cere un fișier: apasă «📎 Alege modelul de format» și încarcă un HTML sau PDF.');
      return;
    }
    setSaving(true); setError(null);
    const task = {
      name: f.name.trim(),
      schedule_kind: f.schedule_kind, run_hour: Number(f.run_hour), run_weekday: Number(f.run_weekday), run_monthday: Number(f.run_monthday),
      category: r.category, subcategory: r.subcategory, profile: r.profile, ctype: r.ctype,
      extra_rubrics: f.extraKeys
        .map(rubricByKey).filter(Boolean)
        .map((x) => ({ category: x.category, subcategory: x.subcategory, profile: x.profile, ctype: x.ctype })),
      result_kind: f.result_kind, data_mode: f.data_mode, instructions: f.instructions.trim() || null,
      ai_model: f.ai_model, auto_post: f.auto_post, is_free: f.is_free, post_type: f.post_type, notify: f.notify,
    };
    const payload = editId
      ? { action: 'update', id: editId, patch: task, format_file: f.formatFile || null, remove_format: f.removeFormat || false }
      : { action: 'create', task, format_file: f.formatFile || null };
    try {
      await aiClient.agentTasks(payload);
      setFormOpen(false); setEditId(null);
      setMsg(editId ? '✅ Task actualizat.' : '✅ Task creat. Va rula automat conform programului (sau apasă ▶️ ca să-l testezi acum).');
      load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function toggle(t) {
    try { await aiClient.agentTasks({ action: 'toggle', id: t.id, enabled: !t.enabled }); load(); }
    catch (e) { setError(e.message); }
  }
  async function remove(t) {
    if (!window.confirm(`Ștergi task-ul „${t.name}”? (istoricul rulărilor se șterge și el; materialele deja postate pe site RĂMÂN)`)) return;
    try { await aiClient.agentTasks({ action: 'delete', id: t.id }); if (openRuns === t.id) setOpenRuns(null); load(); }
    catch (e) { setError(e.message); }
  }
  async function runNow(t) {
    setRunningId(t.id); setError(null); setMsg(null);
    try {
      const r = await aiClient.agentTasks({ action: 'run_now', id: t.id });
      const st = r.run?.status;
      setMsg(st === 'posted'
        ? `✅ „${r.run.title}” a fost generat și POSTAT pe site (task „${t.name}”).`
        : st === 'pending_review'
          ? `🕓 „${r.run.title}” a fost generat și așteaptă aprobarea ta (istoricul task-ului „${t.name}”).`
          : `⚠️ Rularea a eșuat: ${r.run?.error || 'eroare necunoscută'}`);
      load();
      if (openRuns === t.id) loadRuns(t.id);
    } catch (e) { setError(e.message); }
    finally { setRunningId(null); }
  }

  async function loadRuns(taskId) {
    setRunsBusy(true);
    try {
      const r = await aiClient.agentTasks({ action: 'runs', taskId });
      setRuns(r.runs || []);
    } catch (e) { setError(e.message); }
    finally { setRunsBusy(false); }
  }
  function toggleRuns(t) {
    if (openRuns === t.id) { setOpenRuns(null); setRuns([]); return; }
    setOpenRuns(t.id); setRuns([]);
    loadRuns(t.id);
  }

  async function previewRun(run) {
    setBusyRun(run.id); setError(null);
    try {
      const r = await aiClient.agentTasks({ action: 'run_result', runId: run.id });
      const html = r.result?.html || (r.result?.exercise ? renderExercise(r.result.exercise) : null);
      if (!html) { setError('Rularea nu mai are rezultatul salvat (probabil a fost deja postată).'); return; }
      setPreview({ title: run.title || 'Previzualizare', html });
    } catch (e) { setError(e.message); }
    finally { setBusyRun(null); }
  }
  async function approveRun(run, t) {
    if (!window.confirm(`Postezi „${run.title}” pe site, în rubrica task-ului „${t.name}”?`)) return;
    setBusyRun(run.id); setError(null);
    try {
      await aiClient.agentTasks({ action: 'post_run', runId: run.id });
      setMsg(`✅ „${run.title}” e acum pe site.`);
      loadRuns(t.id); load();
    } catch (e) { setError(e.message); }
    finally { setBusyRun(null); }
  }
  async function removeRun(run, t) {
    if (!window.confirm('Ștergi această rulare din istoric?')) return;
    setBusyRun(run.id);
    try { await aiClient.agentTasks({ action: 'delete_run', runId: run.id }); loadRuns(t.id); }
    catch (e) { setError(e.message); }
    finally { setBusyRun(null); }
  }

  const rubricLabel = (t) => {
    const r = rubrics.find((x) => rubricKeyOf(x) === rubricKeyOf(t));
    return r ? `${r.group} · ${r.label}` : `${t.category}${t.subcategory ? ' / ' + t.subcategory : ''}${t.profile ? ' · ' + t.profile : ''} (${t.ctype})`;
  };

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0 }}>
          🗓 Task-uri programate — agentul de exerciții
        </h3>
        <button className="btn btn-primary" onClick={() => (formOpen && !editId ? setFormOpen(false) : openCreate())} style={{ fontSize: '.85rem' }}>
          {formOpen && !editId ? '✕ Închide' : '➕ Creează task programat'}
        </button>
      </div>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
        Ca „scheduled tasks” din Claude.ai, dar contextul e o <strong>rubrică a site-ului</strong> (clasă sau tip de examen), nu un folder:
        agentul generează singur, după program, testul următor al rubricii alese și îl poate <strong>posta automat</strong> acolo —
        sau ți-l lasă la aprobat aici (primești și email). Poți adăuga <strong>rubrici suplimentare drept context</strong> (ex. baremele testelor)
        și poți cere rezultatul <strong>după modelul tău de format</strong> (fișier HTML/PDF încărcat de pe calculator).
        Orele sunt <strong>ora României</strong>. Task-urile de mai jos se pot edita oricând (✏️) sau șterge (🗑).
      </p>

      {warning && <div style={{ marginBottom: 10, padding: 12, background: '#fff7e0', color: '#8a6d00', borderRadius: 8, fontSize: '.85rem' }}>🔧 {warning}</div>}
      {error && <div style={{ marginBottom: 10, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {msg && <div style={{ marginBottom: 10, padding: 12, background: 'rgba(39,174,96,.1)', color: '#1e7e34', borderRadius: 8, fontSize: '.85rem' }}>{msg}</div>}

      {/* Formularul de creare / editare */}
      {formOpen && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14, background: '#fbfcfe' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 10 }}>{editId ? '✏️ Editează task-ul' : '➕ Task programat nou'}</div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ ...lbl, flex: 2, minWidth: 220 }}>Numele task-ului
              <input value={f.name} onChange={(e) => patch({ name: e.target.value })}
                placeholder="ex: Test nou EN în fiecare luni" style={inp} />
            </label>
            <label style={{ ...lbl, flex: 3, minWidth: 260 }}>Contextul — rubrica principală (aici lucrează și POSTEAZĂ)
              <select value={f.rubricKey} onChange={(e) => patch({ rubricKey: e.target.value })} style={inp}>
                <option value="">— alege rubrica —</option>
                {[...new Set(rubrics.map((r) => r.group))].map((g) => (
                  <optgroup key={g} label={g}>
                    {rubrics.filter((r) => r.group === g).map((r) => (
                      <option key={rubricKeyOf(r)} value={rubricKeyOf(r)}>{r.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          {/* Context suplimentar: alte rubrici-referință (ex. baremele testelor), max 3 */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ ...lbl, display: 'block' }}>Context suplimentar (opțional) — alte rubrici, ex. baremele testelor (max 3)
              <select value="" disabled={f.extraKeys.length >= 3}
                onChange={(e) => { addExtraKey(e.target.value); e.target.value = ''; }} style={inp}>
                <option value="">➕ adaugă o rubrică drept context…</option>
                {[...new Set(rubrics.map((r) => r.group))].map((g) => (
                  <optgroup key={g} label={g}>
                    {rubrics.filter((r) => r.group === g).map((r) => (
                      <option key={rubricKeyOf(r)} value={rubricKeyOf(r)}
                        disabled={rubricKeyOf(r) === f.rubricKey || f.extraKeys.includes(rubricKeyOf(r))}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {f.extraKeys.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {f.extraKeys.map((k) => {
                  const r = rubricByKey(k);
                  return (
                    <span key={k} style={{ ...chip('#eef2fb', 'var(--navy)'), display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 12px' }}>
                      📚 {r ? `${r.group} · ${r.label}` : k}
                      <button onClick={() => delExtraKey(k)} title="Scoate din context"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontWeight: 800, fontSize: '.8rem', padding: 0 }}>✕</button>
                    </span>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Din fiecare rubrică suplimentară agentul primește câteva materiale ca REFERINȚĂ (ex. stilul baremelor) — nu le combină ca teste-sursă și nu postează în ele.
            </div>
          </div>

          {/* Programul */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ ...lbl, minWidth: 160 }}>Frecvența
              <select value={f.schedule_kind} onChange={(e) => patch({ schedule_kind: e.target.value })} style={inp}>
                <option value="daily">Zilnic</option>
                <option value="weekly">Săptămânal</option>
                <option value="monthly">Lunar</option>
              </select>
            </label>
            {f.schedule_kind === 'weekly' && (
              <label style={{ ...lbl, minWidth: 160 }}>Ziua săptămânii
                <select value={f.run_weekday} onChange={(e) => patch({ run_weekday: Number(e.target.value) })} style={inp}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                </select>
              </label>
            )}
            {f.schedule_kind === 'monthly' && (
              <label style={{ ...lbl, minWidth: 160 }}>Ziua lunii
                <select value={f.run_monthday} onChange={(e) => patch({ run_monthday: Number(e.target.value) })} style={inp}>
                  {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </select>
              </label>
            )}
            <label style={{ ...lbl, minWidth: 140 }}>Ora (România)
              <select value={f.run_hour} onChange={(e) => patch({ run_hour: Number(e.target.value) })} style={inp}>
                {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label style={{ ...lbl, minWidth: 200 }}>Rezultatul
              <select value={f.result_kind} onChange={(e) => patch({ result_kind: e.target.value })} style={inp}>
                <option value="auto">După rubrică (implicit)</option>
                <option value="interactive">Test interactiv (format standard)</option>
                <option value="exam">Subiect de examen (structurat)</option>
                <option value="format">După modelul de format (fișierul meu)</option>
              </select>
            </label>
          </div>

          {/* Rezultat „după modelul de format": fișier HTML/PDF de pe calculator */}
          {f.result_kind === 'format' && (
            <div style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: 10, marginBottom: 10, background: '#fff' }}>
              <input ref={formatFileRef} type="file" accept=".pdf,.html,.htm" style={{ display: 'none' }}
                onChange={(e) => onFormatFile(e.target.files?.[0])} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>🗂 Modelul de format:</span>
                {(f.formatFile || (f.existingFormatName && !f.removeFormat)) ? (
                  <span style={{ fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {(f.formatFile?.pdf || /\.pdf$/i.test(f.existingFormatName || '')) ? '📕' : '📄'} {f.formatFile?.name || f.existingFormatName}
                    {!f.formatFile && f.existingFormatName && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>(deja salvat)</span>}
                    <button style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5c6cb' }}
                      onClick={() => patch(f.formatFile ? { formatFile: null } : { removeFormat: true })}>✕ scoate</button>
                    <button style={smallBtn} onClick={() => formatFileRef.current?.click()}>↻ înlocuiește</button>
                  </span>
                ) : (
                  <button className="btn btn-outline" style={{ fontSize: '.82rem' }} onClick={() => formatFileRef.current?.click()}>
                    📎 Alege modelul de format (PDF / HTML, max 2,5 MB)
                  </button>
                )}
              </div>
              <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                Ca „modelul de format” de la generarea manuală: <strong>HTML</strong> → rezultatul clonează EXACT designul și funcționalitatea fișierului, doar cu exerciții noi din rubrică; <strong>PDF</strong> → structura testului (itemi, secțiuni, barem) se potrivește cu el. Fișierul se salvează pe server și se refolosește la fiecare rulare programată.
              </div>
            </div>
          )}

          <label style={{ ...lbl, display: 'block', marginBottom: 10 }}>Instrucțiuni pentru agent (opțional)
            <input value={f.instructions} onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="ex: dificultate medie; accent pe geometrie; grile la Subiectul I…" style={inp} />
          </label>

          <AIModelPicker value={f.ai_model} onChange={(m) => patch({ ai_model: m })} />

          <div style={{ display: 'flex', gap: 14, fontSize: '.78rem', color: 'var(--text-light)', flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}>
              <input type="radio" checked={f.data_mode === 'keep'} onChange={() => patch({ data_mode: 'keep' })} />
              <span><strong>păstrează datele problemelor</strong></span>
            </label>
            <label style={{ display: 'flex', gap: 6, cursor: 'pointer' }}>
              <input type="radio" checked={f.data_mode === 'modify'} onChange={() => patch({ data_mode: 'modify' })} />
              <span><strong>modifică numerele și notațiile</strong> (verifică problemele — poate greși!)</span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, fontSize: '.82rem' }}>
            <label style={{ display: 'flex', gap: 7, cursor: 'pointer', alignItems: 'center', fontWeight: 700, color: 'var(--navy)' }}>
              <input type="checkbox" checked={f.auto_post} onChange={(e) => patch({ auto_post: e.target.checked })} />
              📤 Postează AUTOMAT pe site după generare
            </label>
            {!f.auto_post && <span style={{ color: 'var(--text-muted)', fontSize: '.76rem' }}>(altfel rezultatul așteaptă aprobarea ta în istoricul task-ului)</span>}
            <label style={{ ...lbl, minWidth: 130 }}>Acces
              <select value={f.is_free ? 'free' : 'premium'} onChange={(e) => patch({ is_free: e.target.value === 'free' })} style={inp}>
                <option value="free">🟢 Gratuit</option>
                <option value="premium">⭐ Premium</option>
              </select>
            </label>
            <label style={{ ...lbl, minWidth: 130 }}>Tip material
              <select value={f.post_type} onChange={(e) => patch({ post_type: e.target.value })} style={inp}>
                <option value="test">Test</option>
                <option value="exercise">Exercițiu</option>
              </select>
            </label>
            <label style={{ display: 'flex', gap: 7, cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" checked={f.notify} onChange={(e) => patch({ notify: e.target.checked })} />
              📨 Email după fiecare rulare
            </label>
          </div>

          <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            Rezultatul se postează ca <strong>material interactiv</strong> în rubrica aleasă (rubricile PDF: sursele sunt subiectele PDF,
            iar testul rezultat apare pe tab-ul „interactiv” al rubricii). Publicarea de PDF-uri noi rămâne pe fluxul manual («Adaugă PDF»).
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving} style={{ fontSize: '.85rem' }}>
              {saving ? 'Se salvează…' : editId ? '💾 Salvează modificările' : '✅ Creează task-ul'}
            </button>
            <button className="btn btn-outline" onClick={() => { setFormOpen(false); setEditId(null); }} style={{ fontSize: '.85rem' }}>Renunță</button>
          </div>
        </div>
      )}

      {/* Lista task-urilor */}
      {tasks.length === 0 && !formOpen && (
        <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', padding: '8px 2px' }}>
          Niciun task programat încă. Creează unul — de exemplu: „în fiecare luni la 07:00, generează testul următor la
          Evaluare Națională · Teste Interactive și postează-l automat”.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map((t) => (
          <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: t.enabled ? '#fff' : '#f7f9fc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--navy)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {t.enabled ? '🟢' : '⏸'} {t.name}
                  {t.auto_post ? <span style={chip('#e8f5e9', '#1e7e34')}>postare automată</span> : <span style={chip('#fff4e5', '#8a6d00')}>cu aprobare</span>}
                  {t.ai_model && <span style={chip('#eef2fb', 'var(--navy)')}>{t.ai_model.replace('claude-', '')}</span>}
                  {t.extra_rubrics?.length > 0 && <span style={chip('#e8f0fe', '#1a4b8c')} title={t.extra_rubrics.map((r) => `${r.category}${r.subcategory ? ' / ' + r.subcategory : ''} (${r.ctype})`).join(' · ')}>📚 +{t.extra_rubrics.length} context</span>}
                  {t.result_kind === 'format' && t.format_model && <span style={chip('#f3e5f5', '#4a148c')} title={t.format_model.name}>🗂 {t.format_model.name}</span>}
                </div>
                <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {rubricLabel(t)} · {scheduleText(t)} · următoarea: {nextRunText(t)}
                  {t.last_run_at && <> · ultima: {new Date(t.last_run_at).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} {statusChip(t.last_status)}</>}
                </div>
                {t.last_status === 'error' && t.last_error && (
                  <div style={{ fontSize: '.74rem', color: '#b71c1c', marginTop: 2 }}>⚠️ {t.last_error}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button style={smallBtn} onClick={() => runNow(t)} disabled={runningId === t.id} title="Execută task-ul chiar acum (test)">
                  {runningId === t.id ? '⏳ Rulează… (~30-90s)' : '▶️ Rulează acum'}
                </button>
                <button style={smallBtn} onClick={() => toggleRuns(t)}>📜 Istoric</button>
                <button style={smallBtn} onClick={() => toggle(t)}>{t.enabled ? '⏸ Oprește' : '▶ Pornește'}</button>
                <button style={smallBtn} onClick={() => openEdit(t)}>✏️</button>
                <button style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5c6cb' }} onClick={() => remove(t)}>🗑</button>
              </div>
            </div>

            {/* Istoricul rulărilor */}
            {openRuns === t.id && (
              <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {runsBusy && <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>Se încarcă istoricul…</div>}
                {!runsBusy && runs.length === 0 && <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>Nicio rulare încă — apasă ▶️ „Rulează acum” ca să testezi task-ul.</div>}
                {runs.map((r) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#f7f9fc', borderRadius: 8, padding: '7px 10px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--navy)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {statusChip(r.status)} {r.title || '(fără titlu)'}
                      </div>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                        {new Date(r.created_at).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {' · '}{r.trigger_kind === 'manual' ? 'manuală' : 'programată'}
                        {r.provider ? ` · ${r.provider}` : ''}
                        {r.error ? ` · ${r.error}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.status === 'pending_review' && (
                        <>
                          <button style={smallBtn} disabled={busyRun === r.id} onClick={() => previewRun(r)}>👁 Previzualizare</button>
                          <button style={{ ...smallBtn, background: 'var(--navy)', color: '#fff' }} disabled={busyRun === r.id} onClick={() => approveRun(r, t)}>
                            {busyRun === r.id ? '…' : '✅ Postează pe site'}
                          </button>
                        </>
                      )}
                      <button style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5c6cb' }} disabled={busyRun === r.id} onClick={() => removeRun(r, t)}>🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal de previzualizare a unei rulări „așteaptă aprobare" */}
      {preview && (
        <div onClick={() => setPreview(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,48,.55)', zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 14, width: 'min(880px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b style={{ color: 'var(--navy)', fontSize: '.9rem' }}>👁 {preview.title}</b>
              <button onClick={() => setPreview(null)} style={smallBtn}>✕ Închide</button>
            </div>
            <iframe title="preview-task-run" sandbox="allow-scripts" srcDoc={preview.html}
              style={{ width: '100%', height: '72vh', border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
          </div>
        </div>
      )}
    </div>
  );
}
