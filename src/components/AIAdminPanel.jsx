// =====================================================================
// src/components/AIAdminPanel.jsx
// Panou pentru administrarea bazei de cunoștințe a Profesorului Virtual.
// Se montează în pagina de Admin (vezi ghidul de integrare).
// =====================================================================
import { useState, useEffect } from 'react';
import { aiClient } from '../lib/aiClient';
import Rolldown from './Rolldown';
import AIExerciseAgent from './AIExerciseAgent';
import AISEOAgent from './AISEOAgent';
import SEOActionsQueue from './SEOActionsQueue';
import SEORankTracker from './SEORankTracker';
import SocialQueue from './SocialQueue';

export default function AIAdminPanel() {
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const [error, setError] = useState(null);

  async function refresh() {
    try { setStats(await aiClient.ingest('stats')); } catch (e) { setError(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function run(action) {
    setBusy(true); setError(null); setLog('');
    try {
      if (action === 'reindex') {
        const r = await aiClient.ingest('reindex');
        setLog(`Puse în coadă: ${r.enqueued} materiale. Primul lot: ${JSON.stringify(r.firstBatch)}`);
        // Procesăm restul cozii automat, lot cu lot. Un lot picat (504 de la
        // platformă pe un material greu, o pană de rețea) NU mai oprește toată
        // reindexarea: coada e idempotentă, deci reîncercăm lotul de 3 ori
        // înainte să renunțăm — altfel trebuia apăsat butonul din nou manual.
        let guard = 0, fails = 0;
        let remaining = r.firstBatch?.remaining ?? 0;
        while (remaining > 0 && guard < 400) {
          try {
            const p = await aiClient.ingest('process');
            remaining = p.remaining;
            fails = 0;
            setLog((l) => l + `\n…procesat lot, rămase: ${remaining}${p.badRows ? ` (${p.badRows} fragmente sărite)` : ''}`);
          } catch (e) {
            fails++;
            setLog((l) => l + `\n⚠️ lot picat (${e.message}) — reîncerc (${fails}/3)`);
            if (fails >= 3) { setLog((l) => l + '\n⛔ Prea multe loturi picate. Coada a rămas la mijloc — apasă „Procesează coada" ca să continui de unde s-a oprit.'); break; }
            await new Promise((res) => setTimeout(res, 2000 * fails));
          }
          guard++;
        }
        if (remaining === 0) setLog((l) => l + '\n✅ Indexare completă.');
      } else if (action === 'process') {
        // Golim coada în întregime, cu aceeași toleranță la loturi picate.
        let guard = 0, fails = 0, remaining = null;
        do {
          try {
            const p = await aiClient.ingest('process');
            remaining = p.remaining;
            fails = 0;
            setLog((l) => (l ? l + '\n' : '') + `…procesat lot, rămase: ${remaining}${p.badRows ? ` (${p.badRows} fragmente sărite)` : ''}`);
          } catch (e) {
            fails++;
            setLog((l) => (l ? l + '\n' : '') + `⚠️ lot picat (${e.message}) — reîncerc (${fails}/3)`);
            if (fails >= 3) { setLog((l) => l + '\n⛔ Prea multe loturi picate — apasă din nou ca să continui de unde s-a oprit.'); break; }
            await new Promise((res) => setTimeout(res, 2000 * fails));
          }
          guard++;
        } while (remaining !== 0 && guard < 400);
        if (remaining === 0) setLog((l) => l + '\n✅ Coada e goală.');
      } else if (action === 'normalize_topics') {
        // Etapa 3 (5.1): aceeași competență = o singură etichetă în „stăpânire"
        const p = await aiClient.ingest('normalize_topics');
        setLog(`Subiecte unificate: ${p.merged ?? 0} din ${p.toMerge ?? 0} (total ${p.total ?? 0} rânduri).${p.note ? '\n' + p.note : ''}`);
      }
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const box = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 };

  return (
    <>
    {/* Rolldown: baza de cunoștințe (conținutul rămâne montat și închis) */}
    <Rolldown box={box} storageKey="kb" title="🤖 Profesor Virtual — Bază de cunoștințe">
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 16 }}>
        Conținutul nou se indexează automat. Folosește „Reindexează tot" o singură dată după instalare
        sau dacă vrei să reconstruiești complet baza de cunoștințe.
      </p>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
          <Mini label="Total fragmente" value={stats.total} />
          <Mini label="Cu embedding" value={stats.embedded} />
          <Mini label="În coadă" value={stats.pending_queue} highlight={stats.pending_queue > 0} />
          <Mini label="Exerciții" value={stats.knowledge.exercise} />
          <Mini label="Rezolvări" value={stats.knowledge.solution} />
          <Mini label="Manuale" value={stats.knowledge.manual} />
          {/* Pre-generarea explicațiilor (pasul 3 din GHID_LIMITE_AI.md) */}
          <Mini label="Explicații pre-generate" value={stats.pregen_total} />
          <Mini label="De pre-generat" value={stats.pregen_pending == null ? '—' : stats.pregen_pending}
            highlight={stats.pregen_pending > 0} />
        </div>
      )}

      {stats && (
        <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
          Embeddings: <strong>{stats.embeddings_provider}</strong> · Model chat: <strong>{stats.chat_model}</strong>
          {/* modelele pe moduri (Etapa 2, 1.4): AI_TUTOR_MODEL / AI_PDF_CHAT_MODEL / AI_GEN_CHAT_MODEL / AI_REASONING_EFFORT */}
          {stats.tutor_model && stats.tutor_model !== stats.chat_model ? <> · Explicații (tutor): <strong>{stats.tutor_model}</strong></> : null}
          {stats.pdf_model ? <> · PDF: <strong>{stats.pdf_model}</strong></> : null}
          {stats.gen_model && stats.gen_model !== stats.chat_model ? <> · Generare: <strong>{stats.gen_model}</strong></> : null}
          {stats.reasoning_effort && stats.reasoning_effort !== 'implicit' ? <> · Raționament: <strong>{stats.reasoning_effort}</strong></> : null}
          {/* Etapa 3 (1.5): câte fragmente au capitolul din programă */}
          {stats.with_chapter == null
            ? <> · Capitole în RAG: <strong>inactiv</strong> — rulează supabase/ai_rag_v2.sql</>
            : <> · Fragmente cu capitol: <strong>{stats.with_chapter}</strong></>}
          {stats.pregen_pending == null
            ? <> · Pre-generare: <strong>inactivă</strong> — rulează supabase/ai_pregen.sql</>
            : <> · Pre-generarea rulează automat (cron), câte puține, după ce coada de indexare ajunge la 0 — sau apasă „Procesează coada"</>}
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => run('reindex')} disabled={busy}>
          {busy ? 'Se lucrează...' : '🔄 Reindexează tot'}
        </button>
        <button className="btn btn-outline" onClick={() => run('process')} disabled={busy}>
          ⚙️ Procesează coada
        </button>
        <button className="btn btn-outline" onClick={() => run('normalize_topics')} disabled={busy}
          title={'Aduce subiectele din „stăpânirea competențelor” la etichetele din programă (o singură dată, după actualizare)'}>
          🏷 Unifică subiectele
        </button>
        <button className="btn btn-outline" onClick={refresh} disabled={busy}>↻ Reîmprospătează</button>
      </div>

      {error && <div style={{ marginTop: 14, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {log && <pre style={{ marginTop: 14, padding: 12, background: '#f7f9fc', borderRadius: 8, fontSize: '.78rem', color: 'var(--text)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{log}</pre>}
    </Rolldown>

    <AIExerciseAgent box={box} />
    <AISEOAgent box={box} />
    <SEOActionsQueue box={box} />
    <SEORankTracker box={box} />
    <SocialQueue box={box} />
    <BroadcastBox box={box} />
    </>
  );
}

// ─── Trimite un anunț către toți utilizatorii (apare la clopoțel) ────────────
function BroadcastBox({ box }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);
  const [sent, setSent] = useState([]);
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4, marginBottom: 10 };

  async function loadSent() {
    try { const { broadcasts } = await aiClient.broadcastList(); setSent(broadcasts || []); } catch { /* ignore */ }
  }
  useEffect(() => { loadSent(); }, []);

  async function send() {
    if (!title.trim()) { setMsg('Pune un titlu.'); return; }
    setSending(true); setMsg(null);
    try {
      await aiClient.sendBroadcast({ title, body: body || null, url: url || null, type: 'update' });
      setMsg('✅ Anunț trimis tuturor.'); setTitle(''); setBody(''); setUrl(''); loadSent();
    } catch (e) { setMsg('Eroare: ' + e.message); }
    finally { setSending(false); }
  }

  async function del(id) {
    if (!window.confirm('Ștergi acest anunț?')) return;
    try { await aiClient.broadcastDelete({ id }); setSent((s) => s.filter((x) => x.id !== id)); } catch { /* ignore */ }
  }

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>📣 Trimite un anunț</h3>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
        Apare la clopoțelul tuturor utilizatorilor (ex: „Am adăugat o funcție nouă la Profesorul Virtual"). Opțional, un link care se deschide la clic.
      </p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titlu (ex: Noutăți la Profesorul Virtual)" style={inp} />
      <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Detalii (opțional)" style={inp} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (opțional, ex: /profesor-virtual)" style={inp} />
      <button className="btn btn-primary" onClick={send} disabled={sending}>{sending ? 'Se trimite...' : 'Trimite anunțul'}</button>
      {msg && <div style={{ marginTop: 10, fontSize: '.85rem', color: msg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{msg}</div>}

      {sent.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 8 }}>Anunțuri trimise</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sent.map((b) => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f7f9fc', borderRadius: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{new Date(b.created_at).toLocaleString('ro-RO')}</div>
                </div>
                <button onClick={() => del(b.id)} style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 7, padding: '4px 9px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>🗑 Șterge</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, highlight }) {
  return (
    <div style={{ background: highlight ? 'rgba(232,185,49,.12)' : '#f7f9fc', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--navy)' }}>{value ?? 0}</div>
      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}
