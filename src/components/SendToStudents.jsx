// =====================================================================
// src/components/SendToStudents.jsx
// Buton pentru profesor: creează o temă din exercițiul curent și arată
// linkul de trimis elevilor (cu buton de copiere).
// `create` = funcție async care întoarce { url, title }.
// =====================================================================
import { useState } from 'react';

export default function SendToStudents({ create, label = '📤 Trimite elevilor' }) {
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  async function go() {
    setLoading(true); setError(null); setCopied(false);
    try {
      const r = await create();
      const full = `${window.location.origin}${r.url}`;
      setLink(full);
    } catch (e) { setError(e.premium ? 'Această funcție e disponibilă cu abonament.' : e.message); }
    finally { setLoading(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* fallback: selectare manuală */ }
  }

  if (link) {
    return (
      <div style={{ marginTop: 10, padding: 12, background: 'rgba(39,174,96,.08)', border: '1px solid rgba(39,174,96,.3)', borderRadius: 10 }}>
        <div style={{ fontSize: '.82rem', color: '#1e7e34', fontWeight: 600, marginBottom: 6 }}>✅ Temă creată! Trimite acest link elevilor:</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input readOnly value={link} onFocus={(e) => e.target.select()}
            style={{ flex: 1, minWidth: 200, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '.82rem', color: 'var(--text)' }} />
          <button className="btn btn-sm btn-primary" onClick={copy}>{copied ? '✓ Copiat' : 'Copiază'}</button>
        </div>
        <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 6 }}>Rezultatele elevilor vor apărea în „Raport AI – activități cu Prof. Virtual".</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn btn-outline btn-sm" onClick={go} disabled={loading}>{loading ? 'Se creează...' : label}</button>
      {error && <div style={{ fontSize: '.8rem', color: '#b71c1c', marginTop: 6 }}>⚠️ {error}</div>}
    </div>
  );
}
