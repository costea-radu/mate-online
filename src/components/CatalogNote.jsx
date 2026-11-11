// =====================================================================
// src/components/CatalogNote.jsx — 📒 CATALOGUL PROFESORULUI (11 nov. 2026)
//
// Cererea: „fă ca profesorii să poată da note elevilor, plusuri, minusuri,
// aprecieri". Aici:
//   CatalogDialog — fereastra profesorului (Contul meu → „Grupe / Rezultate
//                   elevi" → „📒 Notează", lângă fiecare elev): 📝 notă 1–10,
//                   ➕ plus, ➖ minus, 👏 apreciere — cu „pentru ce" la îndemână;
//   CatalogSumar  — rândul scurt de sub numele elevului („📒 9 · 10 · ➕3 ➖1 · 👏2");
//   CatalogList   — lista întreagă (data, ce, pentru ce; profesorul poate șterge);
//   MyCatalog     — ce vede ELEVUL în „Rezultatele mele" (și pe Home).
// Serverul: api/teacher-manage.js (add_mark / delete_mark / my_marks) și
// api/teacher-students.js (`marks`); tabela: supabase/catalog_profesor.sql.
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { aiClient } from '../lib/aiClient';

export const KIND_UI = {
  nota: { icon: '📝', label: 'Notă', color: '#1a3d6e', bg: 'rgba(26,61,110,.08)' },
  plus: { icon: '➕', label: 'Plus', color: '#2e7d32', bg: 'rgba(46,125,50,.09)' },
  minus: { icon: '➖', label: 'Minus', color: '#c62828', bg: 'rgba(198,40,40,.08)' },
  apreciere: { icon: '👏', label: 'Apreciere', color: '#8a6d00', bg: 'rgba(232,185,49,.16)' },
};

const PENTRU = {
  nota: ['Lucrare', 'Test', 'Răspuns oral', 'Temă', 'Activitate la oră', 'Proiect'],
  plus: ['Activitate la oră', 'Temă bine făcută', 'Răspuns bun', 'Ajutor dat colegilor'],
  minus: ['Temă nefăcută', 'Neatenție la oră', 'Lipsa caietului', 'Întârziere'],
  apreciere: [],
};
const APRECIERI = [
  'Bravo! Ai lucrat foarte bine.',
  'Progres frumos — continuă tot așa!',
  'Muncă excelentă la temă.',
  'Ai fost foarte activ(ă) la oră.',
  'Rezolvare clară și ordonată. Felicitări!',
];

export function fmtNotaCatalog(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}
const fmtData = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; }
};
const culoareNota = (v) => (v >= 8 ? '#2e7d32' : v >= 5 ? '#e65100' : '#c62828');

// { note: [rânduri], media, plusuri, minusuri, aprecieri } — aceeași regulă ca pe server
export function rezumatCatalog(list = []) {
  const rows = Array.isArray(list) ? list : [];
  const note = rows.filter((m) => m && m.kind === 'nota' && Number.isFinite(Number(m.value)));
  const media = note.length ? Math.round((note.reduce((a, m) => a + Number(m.value), 0) / note.length) * 100) / 100 : null;
  return {
    note, media,
    plusuri: rows.filter((m) => m && m.kind === 'plus').length,
    minusuri: rows.filter((m) => m && m.kind === 'minus').length,
    aprecieri: rows.filter((m) => m && m.kind === 'apreciere').length,
  };
}

// „📒 9 · 10 · ➕3 ➖1 · 👏2" — sub numele elevului (profesor / părinte)
export function CatalogSumar({ marks = [], style = null }) {
  const r = useMemo(() => rezumatCatalog(marks), [marks]);
  if (!marks || !marks.length) return null;
  const ultimele = [...r.note].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(-4);
  return (
    <span className="catalog-sumar" title="Catalogul: notele, plusurile, minusurile și aprecierile de la profesor"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '.74rem', fontWeight: 700, color: 'var(--navy)', ...(style || {}) }}>
      <span aria-hidden="true">📒</span>
      {ultimele.map((m) => (
        <span key={m.id} style={{ color: culoareNota(Number(m.value)), background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '0 6px' }}>{fmtNotaCatalog(m.value)}</span>
      ))}
      {r.plusuri > 0 && <span style={{ color: KIND_UI.plus.color }}>➕{r.plusuri}</span>}
      {r.minusuri > 0 && <span style={{ color: KIND_UI.minus.color }}>➖{r.minusuri}</span>}
      {r.aprecieri > 0 && <span style={{ color: KIND_UI.apreciere.color }}>👏{r.aprecieri}</span>}
    </span>
  );
}

// lista întreagă — cele mai noi primele
export function CatalogList({ marks = [], onDelete = null, showTeacher = false, limit = 50, gol = 'Nimic în catalog încă.' }) {
  const [toate, setToate] = useState(false);
  const list = useMemo(() => [...(marks || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [marks]);
  if (!list.length) return <p style={{ fontSize: '.82rem', color: 'var(--text-muted)', margin: 0 }}>{gol}</p>;
  const vizibile = toate ? list : list.slice(0, limit);
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {vizibile.map((m) => {
        const k = KIND_UI[m.kind] || KIND_UI.apreciere;
        return (
          <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: k.bg, borderRadius: 8, padding: '6px 9px', fontSize: '.8rem' }}>
            <span aria-hidden="true" style={{ fontSize: '1rem', lineHeight: 1.3 }}>{k.icon}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: k.color }}>
                {m.kind === 'nota' ? <>nota <span style={{ fontSize: '.95rem', color: culoareNota(Number(m.value)) }}>{fmtNotaCatalog(m.value)}</span></> : k.label.toLowerCase()}
              </strong>
              {m.title && <span style={{ color: 'var(--text)' }}> · {m.title}</span>}
              {m.comment && <span style={{ display: 'block', color: 'var(--text)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{m.kind === 'apreciere' ? `„${m.comment}"` : m.comment}</span>}
              <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '.7rem', marginTop: 2 }}>
                {fmtData(m.created_at)}{showTeacher && m.teacher_name ? ` · prof. ${m.teacher_name}` : ''}
              </span>
            </span>
            {onDelete && (
              <button type="button" onClick={() => onDelete(m)} title="Șterge din catalog" aria-label="Șterge din catalog"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '.85rem', padding: '0 2px' }}>🗑</button>
            )}
          </div>
        );
      })}
      {list.length > limit && (
        <button type="button" onClick={() => setToate((v) => !v)}
          style={{ justifySelf: 'start', background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 700, fontSize: '.78rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
          {toate ? 'Arată mai puține' : `Arată toate (${list.length})`}
        </button>
      )}
    </div>
  );
}

// ─── Fereastra profesorului: 📝 notă · ➕ plus · ➖ minus · 👏 apreciere ─────────
export function CatalogDialog({ student, onClose, onSaved }) {
  const [kind, setKind] = useState('nota');
  const [value, setValue] = useState(null);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [trimise, setTrimise] = useState([]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!student) return null;
  const prenume = String(student.name || 'elevului').split(' ')[0];
  const gata = kind === 'nota' ? value != null : kind === 'apreciere' ? comment.trim().length > 0 : true;

  async function trimite() {
    if (!gata || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await aiClient.catalogAdd({
        studentId: student.id, kind,
        value: kind === 'nota' ? value : null,
        title: title.trim() || null,
        comment: comment.trim() || null,
      });
      setTrimise((l) => [...l, r.mark]);
      onSaved?.(r.mark);
      setValue(null); setTitle(''); setComment('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const k = KIND_UI[kind];
  const pill = (activ, culoare = 'var(--navy)') => ({
    padding: '8px 12px', borderRadius: 10, fontWeight: 800, fontSize: '.86rem', cursor: 'pointer',
    border: `2px solid ${activ ? culoare : 'var(--border)'}`, background: activ ? culoare : '#fff', color: activ ? '#fff' : culoare,
  });
  const chip = { padding: '4px 10px', borderRadius: 14, border: '1px solid var(--border)', background: '#fff', color: 'var(--navy)', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer' };

  const body = (
    <div role="dialog" aria-modal="true" aria-label={`Catalog — ${student.name}`} className="catalog-dialog-bg"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(10,25,45,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div className="catalog-dialog" style={{ background: '#fff', borderRadius: 16, width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 28px)', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div style={{ background: 'var(--navy)', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderRadius: '16px 16px 0 0' }}>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.02rem' }}>📒 Notează — {student.name}</strong>
          <button type="button" onClick={onClose} aria-label="Închide"
            style={{ background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 8, padding: '3px 10px', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(KIND_UI).map(([id, u]) => (
              <button key={id} type="button" aria-pressed={kind === id} onClick={() => { setKind(id); setError(null); }} style={pill(kind === id, u.color)}>
                {u.icon} {u.label}
              </button>
            ))}
          </div>

          {kind === 'nota' && (
            <div>
              <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--text-light)', marginBottom: 6 }}>Nota</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} type="button" aria-pressed={value === n} onClick={() => setValue(n)}
                    style={{ padding: '10px 0', borderRadius: 10, fontWeight: 800, fontSize: '1.05rem', cursor: 'pointer', border: `2px solid ${value === n ? culoareNota(n) : 'var(--border)'}`, background: value === n ? culoareNota(n) : '#fff', color: value === n ? '#fff' : culoareNota(n) }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind !== 'apreciere' ? (
            <div>
              <label htmlFor="catalog-pentru" style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--text-light)' }}>Pentru ce <span style={{ fontWeight: 500 }}>(opțional)</span></label>
              <input id="catalog-pentru" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                placeholder={kind === 'nota' ? 'ex. Lucrare — ecuații' : kind === 'plus' ? 'ex. Activitate la oră' : 'ex. Temă nefăcută'}
                style={{ width: '100%', marginTop: 6, padding: '9px 11px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 16, fontFamily: 'var(--font-body)' }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                {PENTRU[kind].map((t) => <button key={t} type="button" style={chip} onClick={() => setTitle(t)}>{t}</button>)}
              </div>
              {kind === 'nota' && (
                <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 600))} rows={2}
                  placeholder="Un cuvânt pentru elev (opțional)"
                  style={{ width: '100%', marginTop: 10, padding: '9px 11px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 16, fontFamily: 'var(--font-body)', resize: 'vertical' }} />
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="catalog-apreciere" style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--text-light)' }}>Aprecierea ta pentru {prenume}</label>
              <textarea id="catalog-apreciere" value={comment} onChange={(e) => setComment(e.target.value.slice(0, 600))} rows={3}
                placeholder="ex. Bravo! Ai lucrat foarte bine azi."
                style={{ width: '100%', marginTop: 6, padding: '9px 11px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 16, fontFamily: 'var(--font-body)', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
                {APRECIERI.map((t) => <button key={t} type="button" style={chip} onClick={() => setComment(t)}>{t}</button>)}
              </div>
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="Pentru ce (opțional), ex. Tema de azi"
                style={{ width: '100%', marginTop: 10, padding: '8px 11px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 16, fontFamily: 'var(--font-body)' }} />
            </div>
          )}

          {error && <div style={{ background: '#fce4ec', color: 'var(--danger)', borderRadius: 8, padding: '8px 11px', fontSize: '.82rem' }}>⚠️ {error}</div>}
          {trimise.length > 0 && (
            <div style={{ background: '#e8f5e9', color: '#2e7d32', borderRadius: 8, padding: '8px 11px', fontSize: '.82rem', fontWeight: 600 }}>
              ✓ Trimis: {trimise.map((m) => (m.kind === 'nota' ? `nota ${fmtNotaCatalog(m.value)}` : KIND_UI[m.kind]?.label.toLowerCase())).join(', ')} — {prenume} și părinții lui au primit o notificare.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" onClick={onClose}
              style={{ padding: '9px 16px', borderRadius: 9, border: '1.5px solid var(--border)', background: '#fff', color: 'var(--text-light)', fontWeight: 700, cursor: 'pointer' }}>
              {trimise.length ? 'Gata' : 'Renunță'}
            </button>
            <button type="button" onClick={trimite} disabled={!gata || busy}
              style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: gata ? k.color : 'var(--border)', color: '#fff', fontWeight: 800, cursor: gata && !busy ? 'pointer' : 'default', opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Se trimite…' : `${k.icon} Dă ${kind === 'nota' ? (value != null ? `nota ${value}` : 'nota') : kind === 'plus' ? 'un plus' : kind === 'minus' ? 'un minus' : 'aprecierea'}`}
            </button>
          </div>
          <p style={{ fontSize: '.72rem', color: 'var(--text-muted)', margin: 0 }}>
            Elevul și părinții lui primesc o notificare. Notele intră în mediile elevului („🔒 Încheie media").
          </p>
        </div>
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(body, document.body) : body;
}

// ─── ELEVUL: „📒 De la profesori" (Contul meu → Rezultatele mele) ────────────────
export function useMyCatalog(enabled = true) {
  const [marks, setMarks] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let viu = true;
    aiClient.catalogMine().then((r) => { if (viu) setMarks(r.marks || []); }).catch(() => { if (viu) setMarks([]); });
    return () => { viu = false; };
  }, [enabled]);
  return marks;
}

export function MyCatalog({ marks }) {
  const r = useMemo(() => rezumatCatalog(marks || []), [marks]);
  if (!marks || !marks.length) return null;
  return (
    <div id="catalog" style={{ background: '#fff', border: '1.5px solid rgba(232,185,49,.55)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ color: 'var(--navy)', fontSize: '.92rem' }}>📒 De la profesori — note, plusuri, minusuri, aprecieri</strong>
        <span style={{ display: 'inline-flex', gap: 10, fontSize: '.78rem', fontWeight: 700, flexWrap: 'wrap' }}>
          {r.media != null && <span style={{ color: culoareNota(r.media) }}>media notelor: {fmtNotaCatalog(r.media)}</span>}
          {r.plusuri > 0 && <span style={{ color: KIND_UI.plus.color }}>➕ {r.plusuri}</span>}
          {r.minusuri > 0 && <span style={{ color: KIND_UI.minus.color }}>➖ {r.minusuri}</span>}
          {r.aprecieri > 0 && <span style={{ color: KIND_UI.apreciere.color }}>👏 {r.aprecieri}</span>}
        </span>
      </div>
      <CatalogList marks={marks} showTeacher limit={6} />
    </div>
  );
}
