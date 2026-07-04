// =====================================================================
// src/components/AIAdminPanel.jsx
// Panou pentru administrarea bazei de cunoștințe a Profesorului Virtual.
// Se montează în pagina de Admin (vezi ghidul de integrare).
// =====================================================================
import { useState, useEffect } from 'react';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';

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
        // procesăm restul cozii automat, lot cu lot
        let guard = 0;
        let remaining = r.firstBatch?.remaining ?? 0;
        while (remaining > 0 && guard < 100) {
          const p = await aiClient.ingest('process');
          remaining = p.remaining;
          setLog((l) => l + `\n…procesat lot, rămase: ${remaining}`);
          guard++;
        }
        setLog((l) => l + '\n✅ Indexare completă.');
      } else if (action === 'process') {
        const p = await aiClient.ingest('process');
        setLog(JSON.stringify(p, null, 2));
      }
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const box = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20 };

  return (
    <>
    <div style={box}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
        🎓 Profesor Virtual — Bază de cunoștințe
      </h3>
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
        </div>
      )}

      {stats && (
        <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
          Embeddings: <strong>{stats.embeddings_provider}</strong> · Model chat: <strong>{stats.chat_model}</strong>
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => run('reindex')} disabled={busy}>
          {busy ? 'Se lucrează...' : '🔄 Reindexează tot'}
        </button>
        <button className="btn btn-outline" onClick={() => run('process')} disabled={busy}>
          ⚙️ Procesează coada
        </button>
        <button className="btn btn-outline" onClick={refresh} disabled={busy}>↻ Reîmprospătează</button>
      </div>

      {error && <div style={{ marginTop: 14, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {log && <pre style={{ marginTop: 14, padding: 12, background: '#f7f9fc', borderRadius: 8, fontSize: '.78rem', color: 'var(--text)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>{log}</pre>}
    </div>

    <InteractiveGenerator box={box} />
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

// ─── Generator de exerciții INTERACTIVE (HTML) + salvare în conținut ─────────
const GEN_CATS = ['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'evaluare-nationala', 'bacalaureat'];

function InteractiveGenerator({ box }) {
  const [category, setCategory] = useState('clasa-5');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('mediu');
  const [isFree, setIsFree] = useState(false);
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [warning, setWarning] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  async function gen() {
    setLoading(true); setError(null); setMsg(null); setWarning(null); setHtml('');
    try {
      const res = await aiClient.generateInteractive({ category, topic, difficulty });
      setHtml(res.html); setTitle(res.title || `Exercițiu interactiv · ${topic || category}`);
      setWarning(res.warning || null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!html || !title) { setError('Generează întâi exercițiul și pune un titlu.'); return; }
    setSaving(true); setError(null); setMsg(null);
    try {
      const bucket = isFree ? 'content-files-free' : 'content-files';
      const path = `interactive/${category}/${Date.now()}_ai_generat.html`;
      const blob = new Blob([html], { type: 'text/html' });
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'text/html' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const { error: dbErr } = await supabase.from('content').insert({
        title, description: `Generat cu AI · ${topic || category}`,
        category, content_type: 'interactive', is_free: isFree,
        file_url: urlData?.publicUrl || path,
        interactive_data: { type: 'exercise', html: true, ai_generated: true },
      });
      if (dbErr) throw dbErr;
      setMsg('✅ Salvat în conținut! Se va indexa automat pentru Profesorul Virtual.');
      setHtml('');
    } catch (e) { setError('Salvare eșuată: ' + e.message); }
    finally { setSaving(false); }
  }

  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4 };

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>🧩 Generează exercițiu interactiv (AI)</h3>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>
        AI-ul creează un exercițiu interactiv (HTML) în stilul celor din baza de date. Îl previzualizezi și, dacă e bun, îl salvezi în conținut ca exercițiu real.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>Categorie
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
            {GEN_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>Subiect
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="ex: fracții, ecuații" style={inp} />
        </label>
        <label style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>Dificultate
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={inp}>
            {['ușor', 'mediu', 'greu'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>Acces
          <select value={isFree ? 'free' : 'premium'} onChange={(e) => setIsFree(e.target.value === 'free')} style={inp}>
            <option value="premium">Premium</option>
            <option value="free">Gratuit</option>
          </select>
        </label>
      </div>

      <button className="btn btn-primary" onClick={gen} disabled={loading}>
        {loading ? 'Se generează... (~20s)' : '✨ Generează exercițiu interactiv'}
      </button>

      {error && <div style={{ marginTop: 12, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {msg && <div style={{ marginTop: 12, padding: 12, background: 'rgba(39,174,96,.1)', color: '#1e7e34', borderRadius: 8, fontSize: '.85rem' }}>{msg}</div>}
      {warning && <div style={{ marginTop: 12, padding: 12, background: '#fff4e5', color: '#8a6d00', borderRadius: 8, fontSize: '.82rem' }}>{warning}</div>}

      {html && (
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: '.82rem', color: 'var(--text-light)' }}>Titlu (pentru conținut)
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inp, marginBottom: 10 }} />
          </label>
          <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>Previzualizare (interacționează cu ea ca să testezi):</div>
          <iframe title="preview" srcDoc={html} style={{ width: '100%', height: 460, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Se salvează...' : '💾 Salvează în conținut'}</button>
            <button className="btn btn-outline" onClick={gen} disabled={loading}>🔄 Regenerează</button>
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
