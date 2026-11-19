// =====================================================================
// src/components/FileUploadZone.jsx — zona „trage fișierul aici sau apasă" din Admin
// (Adaugă PDF / Interactiv, 📋 Încarcă bareme, 🤖 Variante AI). Mutată din Admin.jsx
// (19 nov. 2026) ca s-o folosească și filele noi; stilul (`s.uploadZone`) vine din Admin.
// =====================================================================
import { useRef, useState } from 'react';

export default function FileUploadZone({ s, accept, label, hint, file, onFile, icon }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();

  function handleFile(f) {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    const accepted = accept.replace('.', '').split(',').map(a => a.trim().replace('.', ''));
    if (!accepted.includes(ext)) {
      alert(`Selectează un fișier ${accept}.`);
      return;
    }
    onFile(f);
  }

  return (
    <div>
      <div
        style={s.uploadZone(drag)}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => ref.current.click()}
      >
        {file ? (
          <div>
            <div style={{ fontSize: '2rem' }}>{icon}</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>{file.name}</div>
            <div style={{ color: '#8e95a3', fontSize: '0.82rem' }}>{(file.size / 1024).toFixed(0)} KB</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '2rem' }}>☁️</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>{label}</div>
            <div style={{ color: '#8e95a3', fontSize: '0.82rem', marginTop: 4 }}>{hint}</div>
          </div>
        )}
      </div>
      <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
    </div>
  );
}
