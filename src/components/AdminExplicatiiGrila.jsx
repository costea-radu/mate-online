// =====================================================================
// src/components/AdminExplicatiiGrila.jsx — Admin → „💡 Explicații grilă" (18 nov. 2026)
//
// Cererea: „Pune barem cu explicații pt grila la evaluare națională. Baremul oficial
// oferă doar rezolvarea grilei fără explicații. În baremul oficial pune buton pentru
// explicații la grilă. Explicația la grilă o să fie generată ulterior și încărcată."
//
// Lista baremelor de Evaluare Națională, fiecare cu PDF-ul explicațiilor lui: ⬆ încarcă
// (sau înlocuiește), 👁 deschide, 🗑 șterge. După încărcare, elevii văd în barem butonul
// „💡 Explicații la grilă" (src/components/ExplicatiiGrila.jsx). PDF-ul urcă din browser
// în Storage (content-files, privat — pdf/evaluare-nationala/…_explicatii-grila_….pdf),
// apoi serverul îl leagă de barem: api/bareme.js → explicatii_* (api/_lib/explicatiiGrila.js).
// Tabela: supabase/explicatii_grila.sql.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost } from '../lib/api';
import { supabase } from '../lib/supabase';
import { safeFileName } from '../lib/contentMeta';
import { uitaExplicatii } from './ExplicatiiGrila';

const fmtData = (d) => { try { return new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const FILTRE = [
  { id: 'toate', label: 'Toate' },
  { id: 'lipsa', label: '— Fără explicații' },
  { id: 'cu', label: '✅ Cu explicații' },
];

export default function AdminExplicatiiGrila({ s }) {
  const [st, setSt] = useState({ loading: true, setup: true, bareme: [], err: null });
  const [cauta, setCauta] = useState('');
  const [filtru, setFiltru] = useState('toate');
  const [lucru, setLucru] = useState({});          // baremId → 'urca' | 'sterge' | 'deschide'
  const [msg, setMsg] = useState(null);
  const fisier = useRef(null);
  const tinta = useRef(null);                       // baremul pentru care s-a deschis alegerea fișierului

  const load = useCallback(async () => {
    setSt((x) => ({ ...x, loading: true, err: null }));
    try {
      const r = await apiPost('/api/bareme', { action: 'explicatii_lista' });
      setSt({ loading: false, setup: r.setup !== false, bareme: r.bareme || [], err: null });
    } catch (e) { setSt((x) => ({ ...x, loading: false, err: e.message || 'Lista nu s-a putut încărca.' })); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const vazute = useMemo(() => {
    const q = cauta.trim().toLowerCase();
    return st.bareme.filter((b) => {
      if (filtru === 'lipsa' && b.explicatie) return false;
      if (filtru === 'cu' && !b.explicatie) return false;
      return !q || String(b.title || '').toLowerCase().includes(q);
    });
  }, [st.bareme, cauta, filtru]);
  const cu = st.bareme.filter((b) => b.explicatie).length;

  const actualizeaza = (baremId, stare) => setSt((x) => ({
    ...x,
    bareme: x.bareme.map((b) => (b.id === baremId ? { ...b, explicatie: stare && stare.exista ? { titlu: stare.titlu, actualizat: stare.actualizat } : null } : b)),
  }));

  function alege(b) {
    tinta.current = b;
    if (fisier.current) { fisier.current.value = ''; fisier.current.click(); }
  }

  async function incarca(file) {
    const b = tinta.current;
    if (!b || !file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setMsg({ type: 'error', text: 'Explicațiile se încarcă ca PDF.' }); return; }
    setLucru((l) => ({ ...l, [b.id]: 'urca' }));
    setMsg(null);
    try {
      const path = `pdf/evaluare-nationala/${Date.now()}_explicatii-grila_${safeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from('content-files').upload(path, file, { contentType: 'application/pdf' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('content-files').getPublicUrl(path);
      const titlu = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
      const r = await apiPost('/api/bareme', { action: 'explicatii_salveaza', baremId: b.id, fileUrl: urlData?.publicUrl || path, titlu });
      uitaExplicatii(b.id);
      actualizeaza(b.id, r);
      setMsg({ type: 'success', text: `💡 Explicațiile pentru „${b.title}" au fost încărcate — elevii văd acum butonul în barem.` });
    } catch (e) {
      setMsg({ type: 'error', text: `Nu am putut încărca explicațiile: ${e.message}` });
    } finally {
      setLucru((l) => { const n = { ...l }; delete n[b.id]; return n; });
    }
  }

  async function sterge(b) {
    if (!window.confirm(`Ștergi explicațiile la grilă pentru „${b.title}"?`)) return;
    setLucru((l) => ({ ...l, [b.id]: 'sterge' }));
    try {
      const r = await apiPost('/api/bareme', { action: 'explicatii_sterge', baremId: b.id });
      uitaExplicatii(b.id);
      actualizeaza(b.id, r);
      setMsg({ type: 'success', text: `Explicațiile pentru „${b.title}" au fost șterse.` });
    } catch (e) { setMsg({ type: 'error', text: e.message }); }
    finally { setLucru((l) => { const n = { ...l }; delete n[b.id]; return n; }); }
  }

  async function deschide(b) {
    // fereastra se deschide în clic (altfel browserul o blochează), apoi primește linkul
    const w = window.open('', '_blank');
    setLucru((l) => ({ ...l, [b.id]: 'deschide' }));
    try {
      const r = await apiPost('/api/bareme', { action: 'explicatii_url', baremId: b.id });
      if (w) w.location.href = r.url; else window.location.href = r.url;
    } catch (e) {
      if (w) w.close();
      setMsg({ type: 'error', text: e.message });
    } finally { setLucru((l) => { const n = { ...l }; delete n[b.id]; return n; }); }
  }

  const btn = { padding: '6px 12px', borderRadius: 8, fontSize: '.8rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', border: '1.5px solid var(--border, #dde1e8)', background: '#fff', color: 'var(--navy)' };
  return (
    <div style={s.card}>
      <div style={s.cardTitle}>💡 Explicații la grilă — Evaluarea Națională</div>
      <div style={s.infoBox}>
        Baremul oficial dă doar răspunsurile grilei (Subiectele I și II). Aici încarci, pentru fiecare barem, <strong>PDF-ul cu explicațiile</strong>.
        După încărcare, elevii văd în barem butonul <strong>„💡 Explicații la grilă"</strong> — în vizualizator, la „📋 Barem" sau când deschid baremul direct.
        Accesul e ca la barem: gratuit → oricine, Premium → abonații.
      </div>
      {!st.setup && (
        <div style={s.alert('error')}>Rulează întâi <code>supabase/explicatii_grila.sql</code> în Supabase → SQL Editor (tabela explicațiilor lipsește).</div>
      )}
      {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}
      {st.err && <div style={s.alert('error')}>{st.err}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input style={{ ...s.input, flex: '1 1 240px', marginBottom: 0 }} value={cauta} onChange={(e) => setCauta(e.target.value)} placeholder="Caută baremul (an, județ, variantă…)" aria-label="Caută baremul" />
        {FILTRE.map((f) => (
          <button key={f.id} type="button" onClick={() => setFiltru(f.id)} aria-pressed={filtru === f.id}
            style={{ ...btn, borderColor: filtru === f.id ? 'var(--gold)' : 'var(--border, #dde1e8)', background: filtru === f.id ? 'rgba(232,185,49,.12)' : '#fff' }}>
            {f.label}
          </button>
        ))}
        <button type="button" style={btn} onClick={load} disabled={st.loading}>{st.loading ? 'Se încarcă…' : '↻'}</button>
      </div>
      <div style={{ fontSize: '.82rem', color: 'var(--text-light)', marginBottom: 8 }}>
        {st.loading ? 'Se încarcă baremele…' : `${cu} din ${st.bareme.length} bareme au explicații · ${vazute.length} afișate`}
      </div>

      <input ref={fisier} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={(e) => incarca(e.target.files && e.target.files[0])} />
      <div style={{ display: 'grid', gap: 8 }}>
        {vazute.map((b) => {
          const ocupat = lucru[b.id];
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '1.5px solid #eef0f4', borderRadius: 10, background: b.explicatie ? '#fbfdf9' : '#fff' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.88rem' }}>
                  {b.title}
                  <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 20, fontSize: '.68rem', fontWeight: 800, background: b.is_free ? '#e8f5e9' : '#fff3e0', color: b.is_free ? '#2e7d32' : '#e65100' }}>{b.is_free ? 'Gratuit' : 'Premium'}</span>
                  {!b.barem && <span style={{ marginLeft: 6, fontSize: '.68rem', color: 'var(--text-muted)' }}>(subiecte + barem)</span>}
                </div>
                <div style={{ fontSize: '.76rem', color: b.explicatie ? '#2e7d32' : 'var(--text-muted)', marginTop: 2 }}>
                  {b.explicatie ? `✅ ${b.explicatie.titlu} · ${fmtData(b.explicatie.actualizat)}` : '— fără explicații'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Link to={`/pdf-viewer?id=${b.id}`} style={{ ...btn, textDecoration: 'none' }} title="Deschide baremul în vizualizator (acolo apare butonul)">📋 Baremul</Link>
                <button type="button" style={{ ...btn, background: b.explicatie ? '#fff' : 'var(--gold)', borderColor: b.explicatie ? 'var(--border, #dde1e8)' : 'var(--gold)' }}
                  disabled={!!ocupat || !st.setup} onClick={() => alege(b)}>
                  {ocupat === 'urca' ? '⏳ Se încarcă…' : b.explicatie ? '🔁 Înlocuiește PDF' : '⬆ Încarcă PDF'}
                </button>
                {b.explicatie && (
                  <>
                    <button type="button" style={btn} disabled={!!ocupat} onClick={() => deschide(b)}>{ocupat === 'deschide' ? '⏳' : '👁 Deschide'}</button>
                    <button type="button" style={{ ...btn, color: '#c62828' }} disabled={!!ocupat} onClick={() => sterge(b)}>{ocupat === 'sterge' ? '⏳' : '🗑'}</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {!st.loading && !vazute.length && <div style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Niciun barem nu se potrivește.</div>}
      </div>
    </div>
  );
}
