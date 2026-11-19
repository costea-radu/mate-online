// =====================================================================
// src/components/ExplicatiiGrila.jsx — „💡 Explicații la grilă" în baremul oficial
// de Evaluare Națională (18 nov. 2026)
//
// Cererea: „Pune barem cu explicații pt grila la evaluare națională. Baremul oficial
// oferă doar rezolvarea grilei fără explicații. În baremul oficial pune buton pentru
// explicații la grilă. Explicația la grilă o să fie generată ulterior și încărcată."
//
// În vizualizatorul PDF (src/pages/PDFViewer.jsx), cât se vede un barem de EN — baremul
// deschis cu „📋 Barem", baremul inclus în același PDF sau baremul deschis direct:
//   • elevul vede butonul „💡 Explicații la grilă" doar când explicațiile au fost
//     încărcate; adminul îl vede mereu („lipsesc" → Admin → 💡 Explicații grilă);
//   • butonul deschide PDF-ul explicațiilor peste vizualizator (✕ / Esc îl închide),
//     cu regulile baremului: gratuit → oricine; Premium → abonații.
// Serverul: api/bareme.js → explicatii / explicatii_url (api/_lib/explicatiiGrila.js).
// Încărcarea: src/components/AdminExplicatiiGrila.jsx.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { authHeaders } from '../lib/api';
import PdfCanvasViewer from './PdfCanvasViewer';

async function postBareme(body) {
  const res = await fetch('/api/bareme', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(d.error || `Eroare server (${res.status})`); e.status = res.status; throw e; }
  return d;
}

// starea pe barem, ținută cât e deschisă pagina (revenirea la barem nu mai întreabă)
const memorie = new Map();
export function uitaExplicatii(baremId) { if (baremId) memorie.delete(baremId); else memorie.clear(); }

export function useExplicatiiGrila(baremId) {
  const [stare, setStare] = useState(() => (baremId && memorie.get(baremId)) || null);
  useEffect(() => {
    if (!baremId) { setStare(null); return undefined; }
    if (memorie.has(baremId)) { setStare(memorie.get(baremId)); return undefined; }
    let viu = true;
    setStare(null);
    postBareme({ action: 'explicatii', baremId })
      .then((d) => { memorie.set(baremId, d); if (viu) setStare(d); })
      .catch(() => { if (viu) setStare(null); });
    return () => { viu = false; };
  }, [baremId]);
  return stare;
}

// Butonul: în bara de sus a vizualizatorului (`loc="bara"`) sau în antetul verde al
// baremului (`loc="antet"`). Nimic până nu știm; elevului — doar dacă există explicații.
export function ButonExplicatii({ stare, admin = false, onDeschide, loc = 'bara', tiny = false }) {
  if (!stare || !stare.en) return null;
  if (!stare.exista && !admin) return null;
  const stil = loc === 'antet'
    ? { background: stare.exista ? 'var(--gold)' : '#fff', border: `1px solid ${stare.exista ? 'var(--gold-dim, #c49a1a)' : '#cfe8d4'}`, color: 'var(--navy)', borderRadius: 8, padding: '3px 10px', fontSize: '.74rem', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }
    : { background: stare.exista ? 'var(--gold)' : 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.3)', color: stare.exista ? 'var(--navy)' : '#fff', borderRadius: tiny ? 10 : 14, padding: tiny ? '0 9px' : '6px 12px', height: tiny ? 34 : undefined, fontSize: tiny ? '0.74rem' : '0.82rem', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 };
  if (!stare.exista) {
    // doar adminul: explicațiile lipsesc (sau scriptul SQL nu e rulat) → unde le încarcă
    return (
      <Link to="/admin?tab=explicatii" style={{ ...stil, opacity: 0.85 }} title={stare.setup === false ? 'Rulează supabase/explicatii_grila.sql, apoi încarcă explicațiile' : 'Explicațiile la grila acestui barem lipsesc — încarcă-le din Admin'}>
        💡 {tiny ? 'lipsesc' : 'Explicații la grilă · lipsesc'}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onDeschide} style={stil} title="Explicațiile răspunsurilor de la grilă (Subiectele I și II)">
      💡 {tiny ? 'Explicații' : 'Explicații la grilă'}
    </button>
  );
}

// PDF-ul explicațiilor, peste vizualizator
export function ExplicatiiOverlay({ baremId, titluBarem = '', onClose }) {
  const [st, setSt] = useState({ status: 'loading', data: null, url: null, titlu: '', err: null });
  const [esuat, setEsuat] = useState(false);
  const inchide = useRef(null);
  useEffect(() => {
    let viu = true;
    let blob = null;
    (async () => {
      try {
        const d = await postBareme({ action: 'explicatii_url', baremId });
        const resp = await fetch(d.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        blob = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        if (viu) setSt({ status: 'ok', data: buf, url: blob, titlu: d.titlu || '', err: null });
      } catch (e) {
        if (viu) setSt({ status: 'err', data: null, url: null, titlu: '', err: e });
      }
    })();
    return () => { viu = false; if (blob) URL.revokeObjectURL(blob); };
  }, [baremId]);
  // Esc închide; focusul pe „✕" o singură dată, la deschidere (pagina se mai redesenează)
  const laInchidere = useRef(onClose);
  laInchidere.current = onClose;
  useEffect(() => {
    try { inchide.current?.focus(); } catch { /* ignore */ }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); laInchidere.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const err = st.err;
  return (
    <div role="dialog" aria-modal="true" aria-label="Explicații la grilă"
      style={{ position: 'fixed', inset: 0, zIndex: 2500, display: 'flex', flexDirection: 'column', background: '#1a1a2e' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))', flexShrink: 0, background: '#fff8e1', color: '#7a5b00', borderBottom: '1px solid #f1dfa6', fontSize: '.82rem', fontWeight: 800 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          💡 Explicații la grilă{titluBarem ? ` — ${titluBarem}` : ''}
        </span>
        <button ref={inchide} type="button" onClick={onClose}
          style={{ background: '#fff', border: '1px solid #f1dfa6', color: 'var(--navy)', borderRadius: 8, padding: '4px 12px', fontSize: '.78rem', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          ✕ Înapoi la barem
        </button>
      </div>
      {st.status === 'loading' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div className="spinner" />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>Se încarcă explicațiile…</span>
        </div>
      )}
      {st.status === 'err' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: '2.6rem' }}>{err && err.status === 403 ? '⭐' : err && err.status === 401 ? '🔒' : '💡'}</div>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.5 }}>{(err && err.message) || 'Nu am putut deschide explicațiile.'}</p>
          {err && err.status === 403 && <Link to="/preturi" className="btn btn-primary">Vezi abonamentele</Link>}
          {err && err.status === 401 && <Link to="/autentificare" className="btn btn-primary">Autentificare</Link>}
        </div>
      )}
      {st.status === 'ok' && !esuat && (
        <PdfCanvasViewer key={st.url} data={st.data} blobUrl={st.url} onFail={() => setEsuat(true)} />
      )}
      {st.status === 'ok' && esuat && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem' }}>💡</div>
          <a href={st.url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', padding: '12px 28px', background: 'var(--gold)', color: 'var(--navy-dark)', borderRadius: 10, fontWeight: 700, textDecoration: 'none' }}>
            📂 Deschide explicațiile
          </a>
        </div>
      )}
    </div>
  );
}
