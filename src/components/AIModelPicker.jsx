// =====================================================================
// src/components/AIModelPicker.jsx — rândul de butoane „🧠 Model AI"
// folosit de agenții din admin (SEO, generator exerciții, task-uri
// programate). Lista modelelor: src/lib/aiModels.js (oglinda serverului).
// =====================================================================
import { AI_MODELS } from '../lib/aiModels';

export default function AIModelPicker({ value, onChange, disabled = false, showHint = true, label = '🧠 Model AI:' }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>{label}</span>
        {AI_MODELS.map((m) => (
          <button key={m.id} type="button" disabled={disabled} title={m.hint}
            onClick={() => onChange?.(m.id)}
            style={{
              border: value === m.id ? '2px solid var(--navy)' : '1px solid var(--border)',
              background: value === m.id ? 'var(--navy)' : '#fff',
              color: value === m.id ? '#fff' : 'var(--navy)',
              borderRadius: 20, padding: '4px 12px', fontSize: '.78rem', fontWeight: 600,
              cursor: disabled ? 'default' : 'pointer',
            }}>
            {m.label}
          </button>
        ))}
      </div>
      {showHint && (
        <p style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          {AI_MODELS.find((m) => m.id === value)?.hint || 'modelul implicit al serverului'}
        </p>
      )}
    </>
  );
}
