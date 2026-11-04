// =====================================================================
// src/components/PdfOverlay.jsx — fereastra PDF a site-ului, peste pagină
// (4 nov. 2026). O deschide src/lib/pdfOpen.js (evenimentul PDF_EVENT) acolo
// unde browserul n-are vizualizator PDF: tablele interactive (Samsung Flip /
// Tizen, Android), telefoanele cu Android — sau când s-a ales „🖥️ Vizualizatorul
// ExamenMate". Paginile le desenează PdfCanvasViewer (pdf.js).
//
// PdfOverlayHost stă în App.jsx (mic, mereu încărcat); fereastra propriu-zisă
// se încarcă abia la primul PDF deschis.
// =====================================================================
import { Suspense, lazy, useEffect, useState } from 'react';
import { PDF_EVENT } from '../lib/pdfOpen';

const PdfCanvasViewer = lazy(() => import('./PdfCanvasViewer'));

function slug(t) {
  return String(t || 'document').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'document';
}

export function PdfOverlayHost() {
  const [doc, setDoc] = useState(null);   // { data, title, fileName, url }
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {};
      if (!d.data) return;
      setDoc((old) => {
        if (old?.url) URL.revokeObjectURL(old.url);
        return { ...d, url: URL.createObjectURL(new Blob([d.data], { type: 'application/pdf' })), seq: Date.now() };
      });
      setFailed(false);
    };
    window.addEventListener(PDF_EVENT, on);
    return () => window.removeEventListener(PDF_EVENT, on);
  }, []);
  useEffect(() => {
    if (!doc) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  function close() {
    setDoc((old) => { if (old?.url) URL.revokeObjectURL(old.url); return null; });
  }
  if (!doc) return null;

  const btn = {
    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff',
    borderRadius: 10, padding: '7px 14px', cursor: 'pointer', fontSize: '.85rem', fontWeight: 700,
    whiteSpace: 'nowrap', textDecoration: 'none', flexShrink: 0,
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={doc.title || 'PDF'}
      style={{ position: 'fixed', inset: 0, zIndex: 100050, background: '#1a1a2e', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--navy, #0f2b44)', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,.3)' }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '.95rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📄 {doc.title || 'PDF'}
        </span>
        <a href={doc.url} download={doc.fileName || `${slug(doc.title)}.pdf`} style={btn} title="Salvează PDF-ul pe dispozitiv">⬇ Descarcă</a>
        <button type="button" onClick={close} style={{ ...btn, background: 'var(--gold, #e8b931)', color: 'var(--navy, #0f2b44)', border: 'none' }}>✕ Închide</button>
      </div>
      {failed ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: 'rgba(255,255,255,.75)', lineHeight: 1.6 }}>
          Vizualizatorul PDF nu s-a putut încărca (rețeaua blochează CDN-ul?). Folosește „⬇ Descarcă".
        </div>
      ) : (
        <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
          <PdfCanvasViewer key={doc.seq} data={doc.data} blobUrl={null} onFail={() => setFailed(true)} />
        </Suspense>
      )}
    </div>
  );
}

export default PdfOverlayHost;
