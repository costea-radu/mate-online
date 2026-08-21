// =====================================================================
// src/components/ReviewWidget.jsx — recenzii cu stele + comentariu
//   StarPicker  — cele 5 stele (selectabile sau doar afișate)
//   RatingBadge — „★ 4,6 (23)" pe cardurile de teste (ContentCard)
//   ReviewToast — cardul „Cum ți s-a părut testul?" care apare după ce
//                 scorul s-a salvat (InteractiveViewer); nu blochează
//                 nimic, se poate închide, iar nota se poate schimba ulterior.
// Datele: src/lib/reviews.js (tabelul `reviews`, supabase/reviews_schema.sql).
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchMyReview, saveReview, formatAvg } from '../lib/reviews';

const GOLD = 'var(--gold)';
const LABELS = ['', 'Slab', 'Așa și așa', 'Bun', 'Foarte bun', 'Excelent'];

// ─── Stelele ─────────────────────────────────────────────────────────────────
export function StarPicker({ value = 0, onChange, size = 28, readOnly = false, label = 'Nota ta' }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div role={readOnly ? undefined : 'radiogroup'} aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
      onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          role={readOnly ? undefined : 'radio'}
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'stea' : 'stele'}${LABELS[n] ? ` — ${LABELS[n]}` : ''}`}
          title={LABELS[n]}
          onMouseEnter={() => !readOnly && setHover(n)}
          onFocus={() => !readOnly && setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => !readOnly && onChange?.(n)}
          style={{
            background: 'none', border: 'none', padding: 0, lineHeight: 1,
            fontSize: size, cursor: readOnly ? 'default' : 'pointer',
            color: n <= shown ? GOLD : '#d5d9e0',
            transform: !readOnly && hover === n ? 'scale(1.15)' : 'none',
            transition: 'transform .1s, color .1s',
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

// ─── Media pe card: „★ 4,6 (23)" ─────────────────────────────────────────────
export function RatingBadge({ stats, style = {} }) {
  if (!stats || !stats.n) return null;
  const note = stats.n === 1 ? '1 notă' : `${stats.n} note`;
  return (
    <span
      title={`Media ${formatAvg(stats.avg)} din 5 · ${note}${stats.nComentarii ? ` · ${stats.nComentarii} comentarii` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20,
        fontSize: '0.73rem', fontWeight: 700, background: 'rgba(232,185,49,.14)', color: 'var(--navy)',
        border: '1px solid rgba(232,185,49,.45)', whiteSpace: 'nowrap', ...style,
      }}
    >
      <span style={{ color: GOLD, fontSize: '0.9rem', lineHeight: 1 }}>★</span>
      {formatAvg(stats.avg)}
      <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>({stats.n})</span>
    </span>
  );
}

// ─── Cardul de după test ─────────────────────────────────────────────────────
// Props: targetType ('content' | 'public_item'), targetId, title (numele testului),
//        onClose(), onSaved(review), position ('top-left' implicit).
export function ReviewToast({ targetType = 'content', targetId, title, onClose, onSaved }) {
  const { user } = useAuth();
  const [stars, setStars] = useState(0);
  const [body, setBody] = useState('');
  const [existing, setExisting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 800);
  const closeTimer = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 800);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // nota deja lăsată (dacă există) → o arătăm precompletată
  useEffect(() => {
    let alive = true;
    fetchMyReview(user?.id, targetType, targetId).then((r) => {
      if (!alive || !r) return;
      setExisting(r); setStars(r.stars || 0); setBody(r.body || '');
    });
    return () => { alive = false; };
  }, [user?.id, targetType, targetId]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  async function submit() {
    if (!stars || saving) return;
    setSaving(true); setError(null);
    try {
      const saved = await saveReview({ userId: user?.id, targetType, targetId, stars, body });
      setDone(true);
      onSaved?.(saved);
      closeTimer.current = setTimeout(() => onClose?.(), 2200);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!user || !targetId) return null;

  const btn = {
    border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer',
    fontFamily: 'var(--font-body)',
  };

  return (
    <div
      role="dialog"
      aria-label="Notează testul"
      style={{
        position: 'fixed', zIndex: 1600,
        ...(isMobile ? { top: 64, left: 12, right: 12 } : { top: 70, left: 16, width: 340, maxWidth: 'calc(100vw - 32px)' }),
        background: '#fff', border: '2px solid var(--gold)', borderRadius: 14, padding: '12px 14px',
        boxShadow: '0 10px 30px rgba(0,0,0,.28)', animation: 'rvIn .3s ease',
        fontFamily: 'var(--font-body)',
      }}
    >
      <style>{'@keyframes rvIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}'}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '.92rem' }}>
            {done ? 'Mulțumim! ✨' : existing ? 'Nota ta pentru acest test' : 'Cum ți s-a părut testul?'}
          </div>
          {title && !done && (
            <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
          )}
        </div>
        <button onClick={onClose} aria-label="Închide"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7689', fontSize: '.95rem', padding: '0 2px' }}>✕</button>
      </div>

      {done ? (
        <div style={{ fontSize: '.84rem', color: 'var(--text)', marginTop: 6 }}>
          Nota ta ne ajută să găsim repede testele cu probleme și să le reparăm.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            <StarPicker value={stars} onChange={setStars} size={30} />
            <span style={{ fontSize: '.78rem', color: 'var(--text-light)', fontWeight: 600, minWidth: 70 }}>
              {stars ? LABELS[stars] : 'Alege stelele'}
            </span>
          </div>

          {stars > 0 && (
            <>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 1000))}
                rows={2}
                placeholder={stars <= 3 ? 'Ce nu a mers? (ex. „răspunsul de la 4 e greșit”) — opțional' : 'Un comentariu scurt — opțional'}
                style={{
                  width: '100%', marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px',
                  fontSize: 16, /* ≥16px: iOS nu face zoom la focus */ fontFamily: 'var(--font-body)', resize: 'vertical', lineHeight: 1.45,
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button onClick={submit} disabled={saving}
                  style={{ ...btn, background: 'var(--gold)', color: 'var(--navy)', opacity: saving ? .6 : 1 }}>
                  {saving ? 'Se salvează…' : existing ? 'Actualizează nota' : 'Trimite nota'}
                </button>
                <button onClick={onClose} style={{ ...btn, background: 'none', color: 'var(--text-light)', border: '1px solid var(--border)' }}>
                  Mai târziu
                </button>
                <span style={{ fontSize: '.68rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{body.length}/1000</span>
              </div>
            </>
          )}
          {error && <div style={{ marginTop: 8, fontSize: '.78rem', color: '#b71c1c' }}>⚠️ {error}</div>}
        </>
      )}
    </div>
  );
}
