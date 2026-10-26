// =====================================================================
// src/components/LiveQaBot.jsx — Admin → 🎥 Meditații live → „🤖 Botul de verificare"
//
// Cererea lui Radu (26 oct. 2026): „fă un bot care să verifice dacă o lecție generată
// are sunet, întrebări pentru exerciții". Botul (api/_lib/lessonCheck.js) verifică
// fiecare lecție generată — singur, după ce se pregătește, și la 15 minute (cronul) —:
//   🔊 SUNETUL: fiecare frază are vocea generată, iar fișierul ei chiar e în Storage;
//   ❓ ÎNTREBĂRILE: fiecare exercițiu are întrebări pentru elev (grilele pe ecran, la
//      Subiectele II–III câte una la fiecare subpunct), toate valide;
//   🧩 ITEMII: toți itemii subiectului, enunțuri citibile, formule care se afișează.
// Aici: rezumatul, lecțiile cu probleme (cele mai grave întâi) și reparațiile, cu un clic
// (aceleași pregătiri ca butoanele din „Lecțiile recente" — continuă până la „gata").
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { liveApi } from '../lib/live/api';

const box = { background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 20 };
const btn = { padding: '6px 12px', borderRadius: 8, border: '1px solid #d0d7e2', background: '#f6f8fb', fontSize: '.82rem', cursor: 'pointer', whiteSpace: 'nowrap' };
const btnMain = { ...btn, background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' };
const LEVEL = {
  grav: { label: 'grav', color: '#b3261e', bg: '#fdecea' },
  major: { label: 'important', color: '#8a4b00', bg: '#fff3e0' },
  minor: { label: 'mărunt', color: '#5f6673', bg: '#f1f3f4' },
  info: { label: 'info', color: '#1f5faa', bg: '#e8f0fe' },
};
// reparațiile, ca argumente pentru admin_prepare (aceleași ca la cronul botului)
const FIXES = {
  voce_refa: { label: '🔊 Refă fișierele de voce', title: 'Fișierele de voce pierdute din Storage și frazele cu sunet gol se generează din nou (doar ele).', args: (r) => ({ voiceFix: 'refa', dropAudio: r?.sound?.brokenIds || [] }) },
  voce: { label: '🔊 Generează vocea care lipsește', title: 'Frazele fără voce o primesc (costă cât vocea obișnuită, o singură dată). Lecția merge între timp.', args: (r) => ({ voiceFix: true, dropAudio: r?.sound?.brokenIds || [] }) },
  pasi: { label: '❓ Întrebări din barem', title: 'Subpunctele fără întrebare primesc una făcută din rândurile scrise pe tablă — fără AI, gratuit. Celelalte întrebări rămân.', args: () => ({ stepsGaps: true, stepsAi: false }) },
  pasi_ai: { label: '✨ Întrebări cu AI', title: 'Subpunctele fără întrebare primesc întrebări scrise de AI (≈ 0,5–1 leu); ce nu iese, din barem.', args: () => ({ stepsGaps: true, stepsAi: true }) },
  itemi: { label: '🧩 Completează itemii lipsă', title: 'Se scriu doar itemii care lipsesc (AI); explicațiile și vocea celorlalți rămân.', args: () => ({ fill: true }) },
  figuri: { label: '🖼 Refă desenele', title: 'Desenele din PDF se decupează din nou (gratuit, câteva secunde).', args: () => ({ figures: true }) },
};
const order = (r) => (r ? (r.counts?.grav || 0) * 100 + (r.counts?.major || 0) * 10 + (r.counts?.minor || 0) : -1);

export default function LiveQaBot({ prepareLoop, busy = '', onRegenerate = null, refreshKey = 0, onReports = null }) {
  const [list, setList] = useState(null);         // [{ lessonId, title, status, report, checkedAt }]
  const [setup, setSetup] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [scan, setScan] = useState(null);         // { done, total } cât verifică toate
  const [open, setOpen] = useState({});
  const [showOk, setShowOk] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await liveApi.adminQa({ list: true });
      setSetup(r.setup !== false);
      setList(r.reports || []);
      onReports?.(Object.fromEntries((r.reports || []).filter((x) => x.report).map((x) => [x.lessonId, x.report])));
    } catch (e) { setErr(e.message); }
  }, [onReports]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function checkAll() {
    setErr(''); setMsg('');
    let after = 0, done = 0, total = null, bad = 0;
    setScan({ done: 0, total: list?.length || 0 });
    try {
      for (let round = 0; round < 60 && after != null; round++) {
        const r = await liveApi.adminQa({ after, limit: 12 });
        total = r.total; done += (r.reports || []).length;
        bad += (r.reports || []).filter((x) => x.report && !x.report.ok).length;
        setScan({ done, total });
        after = r.next;
      }
      setMsg(`Am verificat ${done} ${done === 1 ? 'lecție' : 'lecții'}: ${bad ? `${bad} cu probleme` : 'toate în regulă'}.`);
    } catch (e) { setErr(e.message); }
    finally { setScan(null); await load(); }
  }

  async function checkOne(lessonId) {
    setErr('');
    try { await liveApi.adminQa({ lessonId }); await load(); }
    catch (e) { setErr(e.message); }
  }

  async function fix(row, code) {
    const f = FIXES[code];
    if (!f || !prepareLoop) return;
    await prepareLoop(`qa-${row.lessonId}-${code}`, { lessonId: row.lessonId, ...f.args(row.report), qa: true }, `${f.label.replace(/^\S+\s/, '')} — ${row.title || 'lecția'}`);
    await checkOne(row.lessonId);
  }

  // „Repară tot ce se poate fără AI": vocea refăcută + întrebările din barem + desenele, pe rând
  async function fixAllFree() {
    const todo = (list || []).filter((x) => x.report && !x.report.ok && (x.report.fixes || []).some((c) => ['voce_refa', 'pasi', 'figuri'].includes(c)));
    if (!todo.length) { setMsg('Nimic de reparat fără AI.'); return; }
    if (!window.confirm(`Repar ${todo.length} ${todo.length === 1 ? 'lecție' : 'lecții'}: fișierele de voce pierdute, întrebările lipsă din barem (fără AI) și desenele? Vocea frazelor noi costă cât vocea obișnuită.`)) return;
    for (const row of todo) {
      for (const code of ['voce_refa', 'pasi', 'figuri']) {
        if ((row.report.fixes || []).includes(code)) await fix(row, code);
      }
    }
    setMsg(`Am trecut prin ${todo.length} ${todo.length === 1 ? 'lecție' : 'lecții'} — rapoartele sunt reîmprospătate mai jos.`);
  }

  const stats = useMemo(() => {
    const all = list || [];
    const checked = all.filter((x) => x.report);
    return {
      total: all.length, checked: checked.length,
      ok: checked.filter((x) => x.report.ok).length,
      bad: checked.filter((x) => !x.report.ok).length,
      noSound: checked.filter((x) => x.report.sound && !x.report.sound.ok && x.report.sound.mode !== 'generat').length,
      noQuestions: checked.filter((x) => x.report.questions && !x.report.questions.ok).length,
    };
  }, [list]);
  const rows = useMemo(() => (list || []).filter((x) => x.report && (showOk || !x.report.ok)).sort((a, b) => order(b.report) - order(a.report)), [list, showOk]);
  const unchecked = (list || []).filter((x) => !x.report);

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ color: 'var(--navy)' }}>🤖 Botul de verificare a lecțiilor</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btnMain} disabled={!!scan || !!busy} onClick={checkAll}>{scan ? `Verific… ${scan.done}/${scan.total || '?'}` : '🔎 Verifică toate acum'}</button>
          <button type="button" style={btn} disabled={!!scan || !!busy || !stats.bad} onClick={fixAllFree} title="Fișierele de voce pierdute, întrebările lipsă din barem (fără AI), desenele — la toate lecțiile cu probleme">🔧 Repară tot fără AI</button>
        </div>
      </div>
      <p style={{ color: '#5f6673', fontSize: '.84rem', margin: '6px 0 10px', lineHeight: 1.55 }}>
        Verifică fiecare lecție generată, exact cum o primesc elevii: <b>🔊 sunetul</b> (fiecare frază are vocea generată, iar fișierul ei e în Storage),
        <b> ❓ întrebările la exerciții</b> (grilele au întrebarea pe ecran; la Subiectele II–III, fiecare subpunct are întrebarea lui; răspunsurile corecte se pot verifica)
        și <b>🧩 itemii</b> (toți itemii subiectului, enunțuri citibile). Rulează singur după fiecare lecție nouă și la 15 minute; fișierele de voce pierdute
        le reface singur (LIVE_BOT_REPARA). Restul se repară de aici, cu un clic.
      </p>
      {!setup && (
        <div style={{ background: '#fff3e0', color: '#8a4b00', borderRadius: 8, padding: '8px 12px', fontSize: '.84rem', marginBottom: 10 }}>
          ⚠ Rapoartele nu se pot salva încă: rulează o dată <code>supabase/notificari_lectii.sql</code> în Supabase → SQL Editor. Verificarea de acum merge oricum, doar că nu rămâne.
        </div>
      )}
      {err && <div style={{ color: '#b3261e', fontSize: '.86rem', marginBottom: 8 }}>⚠ {err}</div>}
      {msg && <div style={{ color: '#137333', fontSize: '.86rem', marginBottom: 8 }}>✓ {msg}</div>}
      {!list && !err && <div className="spinner" />}
      {list && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            ['Lecții', stats.total, '#374151'],
            ['✓ fără probleme', stats.ok, '#137333'],
            ['⚠ cu probleme', stats.bad, stats.bad ? '#b3261e' : '#374151'],
            ['🔊 fără sunet complet', stats.noSound, stats.noSound ? '#8a4b00' : '#374151'],
            ['❓ exerciții fără întrebări', stats.noQuestions, stats.noQuestions ? '#8a4b00' : '#374151'],
            ['neverificate încă', unchecked.length, '#6b7280'],
          ].map(([k, v, c]) => (
            <div key={k} style={{ border: '1px solid #eef1f5', borderRadius: 10, padding: '8px 12px', minWidth: 120 }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: c }}>{v}</div>
              <div style={{ fontSize: '.74rem', color: '#6b7280' }}>{k}</div>
            </div>
          ))}
        </div>
      )}
      {list && (
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '.82rem', color: '#5f6673', marginBottom: 8 }}>
          <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} /> arată și lecțiile fără probleme
        </label>
      )}
      {list && !rows.length && <div style={{ color: '#137333', fontSize: '.88rem' }}>{stats.checked ? '✓ Nicio lecție cu probleme.' : 'Încă nicio lecție verificată — apasă „🔎 Verifică toate acum".'}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => {
          const r = row.report;
          const isOpen = !!open[row.lessonId];
          const top = (r.issues || []).filter((i) => i.level !== 'info');
          return (
            <div key={row.lessonId} style={{ border: `1px solid ${r.ok ? '#d7eedd' : r.counts?.grav ? '#f5c6c2' : '#f1dfb7'}`, borderRadius: 10, padding: '10px 12px', background: r.ok ? '#fbfefc' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ color: 'var(--navy)' }}>{row.title || r.title || '(fără titlu)'}</b>
                  <span style={{ marginLeft: 8, fontSize: '.78rem', color: r.ok ? '#137333' : '#8a4b00' }}>{r.summary}</span>
                  <div style={{ fontSize: '.74rem', color: '#9aa1ad' }}>scor {r.score}/100 · verificată {new Date(r.at).toLocaleString('ro-RO')} · {row.status}{r.sound && !r.sound.filesChecked && r.sound.voiced ? ' · fișierele din Storage neverificate' : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(r.fixes || []).filter((c) => FIXES[c]).map((c) => (
                    <button key={c} type="button" style={c === 'voce_refa' || c === 'voce' ? btnMain : btn} disabled={!!busy || !!scan} title={FIXES[c].title} onClick={() => fix(row, c)}>
                      {busy === `qa-${row.lessonId}-${c}` ? '…' : FIXES[c].label}
                    </button>
                  ))}
                  {(r.fixes || []).includes('pasi') && (
                    <button type="button" style={btn} disabled={!!busy || !!scan} title={FIXES.pasi_ai.title} onClick={() => fix(row, 'pasi_ai')}>{busy === `qa-${row.lessonId}-pasi_ai` ? '…' : FIXES.pasi_ai.label}</button>
                  )}
                  {(r.fixes || []).includes('regenereaza') && onRegenerate && (
                    <button type="button" style={btn} disabled={!!busy || !!scan} title="Unele probleme le repară doar o lecție scrisă din nou (costă din nou)" onClick={() => onRegenerate(row.lessonId)}>↻ Regenerează</button>
                  )}
                  <button type="button" style={btn} disabled={!!busy || !!scan} onClick={() => checkOne(row.lessonId)} title="Verifică din nou această lecție">🔎</button>
                  <button type="button" style={btn} onClick={() => setOpen((o) => ({ ...o, [row.lessonId]: !isOpen }))}>{isOpen ? 'Ascunde' : `Detalii (${(r.issues || []).length})`}</button>
                </div>
              </div>
              {!isOpen && top.length > 0 && (
                <div style={{ fontSize: '.8rem', color: '#5f6673', marginTop: 4 }}>{top[0].text}{top.length > 1 ? ` (+${top.length - 1})` : ''}</div>
              )}
              {isOpen && (
                <div style={{ marginTop: 8 }}>
                  {r.sound && (
                    <div style={{ fontSize: '.82rem', marginBottom: 6 }}>
                      🔊 Sunet: <b>{r.sound.voiced}/{r.sound.total}</b> fraze cu vocea generată ({r.sound.pct}%)
                      {r.sound.lostFiles ? <span style={{ color: '#b3261e' }}> · {r.sound.lostFiles} fișiere lipsă</span> : null}
                      {r.sound.zero ? <span style={{ color: '#b3261e' }}> · {r.sound.zero} cu sunet gol</span> : null}
                      {r.sound.silentItems?.length ? <span style={{ color: '#8a4b00' }}> · fără voce: {r.sound.silentItems.join(', ')}</span> : null}
                    </div>
                  )}
                  {r.questions && (
                    <div style={{ fontSize: '.82rem', marginBottom: 6 }}>
                      ❓ Întrebări: {r.questions.tries} „încercați singuri", {r.questions.steps} pe pași, {r.questions.checks} de verificare — la <b>{r.questions.withQuestion}/{r.questions.items}</b> exerciții
                      {r.questions.noQuestion?.length ? <span style={{ color: '#8a4b00' }}> · fără nicio întrebare: {r.questions.noQuestion.join(', ')}</span> : null}
                    </div>
                  )}
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
                    {(r.issues || []).map((i, k) => (
                      <li key={k} style={{ fontSize: '.8rem', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontSize: '.68rem', fontWeight: 800, textTransform: 'uppercase', color: LEVEL[i.level]?.color, background: LEVEL[i.level]?.bg, borderRadius: 6, padding: '1px 6px', whiteSpace: 'nowrap' }}>{LEVEL[i.level]?.label || i.level}</span>
                        <span>{i.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// eticheta scurtă din „Lecțiile recente": „🤖 ✓" / „🤖 ⚠ 3"
export function QaBadge({ report }) {
  if (!report) return null;
  const n = (report.counts?.grav || 0) + (report.counts?.major || 0);
  return (
    <span title={report.summary} style={{ marginLeft: 6, fontSize: '.72rem', fontWeight: 700, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap',
      color: report.ok ? '#137333' : report.counts?.grav ? '#b3261e' : '#8a4b00', background: report.ok ? '#e6f4ea' : report.counts?.grav ? '#fdecea' : '#fff3e0' }}>
      🤖 {report.ok ? '✓ verificată' : `⚠ ${n} ${n === 1 ? 'problemă' : 'probleme'}`}
    </span>
  );
}
