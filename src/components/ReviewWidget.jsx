// =====================================================================
// src/components/ReviewWidget.jsx — recenzii cu stele + comentariu
//   StarPicker     — cele 5 stele (selectabile sau doar afișate)
//   RatingBadge    — „★ 4,6 (23)" pe cardurile de teste (ContentCard, Bibliotecă)
//   ReviewToast    — cardul „Cum ți s-a părut testul?" care apare după ce
//                    scorul s-a salvat (InteractiveViewer, ExercitiuAIViewer);
//                    nu blochează nimic, se poate închide, nota se poate schimba
//   ReviewCard     — o recenzie afișată (autor, rol, stele, dată, text)
//   ReviewList     — lista recenziilor unei ținte, cu „Încarcă mai multe"
//   SiteReviewForm — „Părerea ta despre ExamenMate" (Profil, /recenzii);
//                    apare public doar după aprobare în Admin
//   Testimonials   — secțiunea „Ce spun elevii, părinții și profesorii" (Home);
//                    nu randează nimic cât timp nu există recenzii aprobate
// Datele: src/lib/reviews.js (tabelul `reviews`, supabase/reviews_schema.sql).
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  fetchMyReview, saveReview, deleteReview, fetchReviews, fetchSiteStats, formatAvg, ROLE_LABEL,
} from '../lib/reviews';

const GOLD = 'var(--gold)';
const LABELS = ['', 'Slab', 'Așa și așa', 'Bun', 'Foarte bun', 'Excelent'];
export const STAR_LABELS = LABELS;

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

// ─── Utilitare afișare ───────────────────────────────────────────────────────
function initialsOf(name) {
  return (name || '?').split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}
function dateRo(d) {
  try { return new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return ''; }
}

// ─── O recenzie afișată ──────────────────────────────────────────────────────
// `compact` = variantă mică (sub cardurile de teste); altfel card complet.
export function ReviewCard({ r, compact = false, actions = null }) {
  const name = r.author_name || 'Utilizator';
  const role = ROLE_LABEL[r.author_role] || null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #eef0f4', borderRadius: 12,
      padding: compact ? '10px 12px' : '16px 18px', boxShadow: compact ? 'none' : '0 1px 4px rgba(15,43,68,.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: compact ? 28 : 36, height: compact ? 28 : 36, borderRadius: '50%', background: 'var(--navy)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: compact ? '.7rem' : '.85rem', flexShrink: 0,
        }}>{initialsOf(name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: compact ? '.82rem' : '.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div style={{ fontSize: '.72rem', color: '#aab0bb' }}>{role ? `${role} · ` : ''}{dateRo(r.created_at)}</div>
        </div>
        <StarPicker value={r.stars} readOnly size={compact ? 14 : 18} label={`${r.stars} din 5 stele`} />
      </div>
      {r.body && (
        <p style={{ marginTop: 8, fontSize: compact ? '.84rem' : '.92rem', color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {r.body}
        </p>
      )}
      {r.reply && <TeamReply reply={r.reply} at={r.reply_at} compact={compact} />}
      {actions && <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
    </div>
  );
}

// ─── Răspunsul echipei (sub comentariu) ──────────────────────────────────────
export function TeamReply({ reply, at, compact = false }) {
  if (!reply) return null;
  return (
    <div style={{
      marginTop: 10, padding: compact ? '8px 10px' : '10px 14px', borderRadius: 10,
      background: 'rgba(232,185,49,.10)', borderLeft: '3px solid var(--gold)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? '.74rem' : '.78rem', fontWeight: 700, color: 'var(--navy)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: 'var(--navy)', color: 'var(--gold)', fontSize: '.62rem' }}>EM</span>
        Răspunsul echipei ExamenMate
        {at && <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>· {dateRo(at)}</span>}
      </div>
      <p style={{ marginTop: 4, fontSize: compact ? '.82rem' : '.88rem', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{reply}</p>
    </div>
  );
}

// ─── Lista recenziilor unei ținte ────────────────────────────────────────────
// Props: targetType, targetId (null pentru 'site'), pageSize, onlyWithBody,
//        orderByStars, compact, emptyText, reloadKey (schimbă-l ca să reîncarce)
export function ReviewList({
  targetType, targetId = null, pageSize = 10, onlyWithBody = false, orderByStars = false,
  compact = false, emptyText = 'Încă nu există păreri.', reloadKey = 0,
}) {
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load(offset = 0) {
    setLoading(true);
    const r = await fetchReviews(targetType, targetId, { limit: pageSize, offset, onlyWithBody, orderByStars });
    setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    setHasMore(r.hasMore);
    setLoading(false);
  }
  useEffect(() => { load(0); /* eslint-disable-next-line */ }, [targetType, targetId, onlyWithBody, orderByStars, reloadKey]);

  if (loading && items.length === 0) return <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: '.82rem' }}>Se încarcă părerile…</div>;
  if (!loading && items.length === 0) return <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: '.85rem' }}>{emptyText}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 10 }}>
      {items.map((r) => <ReviewCard key={r.id} r={r} compact={compact} />)}
      {hasMore && (
        <button onClick={() => load(items.length)} disabled={loading}
          style={{ alignSelf: 'center', background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px', fontSize: '.8rem', fontWeight: 600, color: 'var(--navy)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
          {loading ? 'Se încarcă…' : 'Încarcă mai multe'}
        </button>
      )}
    </div>
  );
}

// ─── „Părerea ta despre ExamenMate" (recenzie de site) ───────────────────────
// Oricine e autentificat poate lăsa UNA; apare public doar după aprobare în
// Admin. Arată starea (în așteptare / publicată), permite editarea și ștergerea.
// Props: compact (în Profil), onSaved(review)
export function SiteReviewForm({ compact = false, onSaved }) {
  const { user } = useAuth();
  const [existing, setExisting] = useState(null);
  const [stars, setStars] = useState(0);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!user?.id) { setExisting(null); return; }
    fetchMyReview(user.id, 'site', null).then((r) => {
      if (!alive) return;
      setExisting(r); if (r) { setStars(r.stars || 0); setBody(r.body || ''); }
    });
    return () => { alive = false; };
  }, [user?.id]);

  async function submit() {
    if (!stars || saving) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      // rândul întors reflectă valorile de după trigger (approved rămâne cum
      // l-a lăsat adminul la editare; false la o recenzie nouă)
      const saved = await saveReview({ userId: user.id, targetType: 'site', targetId: null, stars, body });
      setExisting(saved);
      setEditing(false);
      setMsg(saved.approved ? 'Recenzia ta a fost actualizată.' : 'Mulțumim! Recenzia ta apare pe site după o scurtă verificare.');
      onSaved?.(saved);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!existing || !window.confirm('Ștergi recenzia ta?')) return;
    try { await deleteReview(existing.id); setExisting(null); setStars(0); setBody(''); setEditing(false); setMsg('Recenzia a fost ștearsă.'); }
    catch (e) { setError(e.message); }
  }

  const btn = { border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', fontFamily: 'var(--font-body)' };
  const ghost = { ...btn, background: 'none', color: 'var(--text-light)', border: '1px solid var(--border)' };

  if (!user) {
    return (
      <div style={{ fontSize: '.9rem', color: 'var(--text-light)' }}>
        <Link to="/autentificare" style={{ color: 'var(--navy)', fontWeight: 700 }}>Autentifică-te</Link> ca să lași o recenzie despre ExamenMate.
      </div>
    );
  }

  // recenzie existentă, needitată → rezumat + stare
  if (existing && !editing) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <StarPicker value={existing.stars} readOnly size={compact ? 20 : 24} />
          <span style={{
            fontSize: '.74rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: existing.approved ? '#e8f5e9' : '#fff3e0', color: existing.approved ? '#2e7d32' : '#e65100',
          }}>
            {existing.approved ? '✓ Publicată pe site' : '⏳ În așteptarea verificării'}
          </span>
        </div>
        {existing.body && <p style={{ marginTop: 8, fontSize: '.9rem', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{existing.body}</p>}
        {existing.reply && <TeamReply reply={existing.reply} at={existing.reply_at} />}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button onClick={() => { setEditing(true); setMsg(null); }} style={ghost}>✎ Modifică</button>
          <button onClick={remove} style={{ ...ghost, color: '#c0392b', borderColor: '#f5c6cb' }}>🗑 Șterge</button>
        </div>
        {msg && <div style={{ marginTop: 8, fontSize: '.82rem', color: '#1e7e34' }}>{msg}</div>}
        {error && <div style={{ marginTop: 8, fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {error}</div>}
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <p style={{ fontSize: '.9rem', color: 'var(--text-light)', marginBottom: 10 }}>
          Cum te-a ajutat ExamenMate? Părerea ta ajunge la noi și, după verificare, pe pagina principală.
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <StarPicker value={stars} onChange={setStars} size={compact ? 28 : 32} />
        <span style={{ fontSize: '.82rem', color: 'var(--text-light)', fontWeight: 600 }}>{stars ? LABELS[stars] : 'Alege stelele'}</span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 1000))}
        rows={compact ? 3 : 4}
        placeholder="Ce ți-a plăcut, ce te-a ajutat, ce ai îmbunătăți? (opțional)"
        style={{ width: '100%', marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: 16, fontFamily: 'var(--font-body)', resize: 'vertical', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={submit} disabled={saving || !stars} style={{ ...btn, background: 'var(--gold)', color: 'var(--navy)', opacity: saving || !stars ? .6 : 1 }}>
          {saving ? 'Se salvează…' : existing ? 'Salvează modificările' : 'Trimite recenzia'}
        </button>
        {existing && <button onClick={() => { setEditing(false); setStars(existing.stars); setBody(existing.body || ''); }} style={ghost}>Renunță</button>}
        <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{body.length}/1000</span>
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: '.82rem', color: '#1e7e34' }}>{msg}</div>}
      {error && <div style={{ marginTop: 8, fontSize: '.82rem', color: '#b71c1c' }}>⚠️ {error}</div>}
    </div>
  );
}

// ─── Secțiunea de testimoniale (Home) ────────────────────────────────────────
// Randează o <section> completă; NIMIC dacă nu există recenzii aprobate.
export function Testimonials({ limit = 6 }) {
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchSiteStats(), fetchReviews('site', null, { limit, onlyWithBody: true, orderByStars: true })])
      .then(([s, r]) => { if (alive) { setStats(s); setItems(r.items); } });
    return () => { alive = false; };
  }, [limit]);

  if (!items || items.length === 0) return null;

  return (
    <section className="section" style={{ background: 'linear-gradient(180deg, #fff, #f4f7fb)' }} id="recenzii">
      <div className="container">
        <div className="section-header">
          <h2 className="section-title">Ce spun elevii, părinții și profesorii</h2>
          {stats && stats.n > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <StarPicker value={Math.round(stats.avg)} readOnly size={22} label={`Media ${formatAvg(stats.avg)} din 5`} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--navy)' }}>{formatAvg(stats.avg)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>din 5 · {stats.n === 1 ? 'o recenzie' : `${stats.n} recenzii`}</span>
            </div>
          )}
          <p className="section-subtitle" style={{ marginBottom: 32 }}>
            Păreri lăsate de utilizatori din contul lor — publicate după verificare.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, maxWidth: 1000, margin: '0 auto' }}>
          {items.map((r) => <ReviewCard key={r.id} r={r} />)}
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
          <Link to="/recenzii" className="btn btn-outline">Toate recenziile</Link>
          <Link to="/recenzii#formular" className="btn btn-primary">Lasă o recenzie</Link>
        </div>
      </div>
    </section>
  );
}
