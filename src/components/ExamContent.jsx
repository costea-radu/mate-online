// src/components/ExamContent.jsx — componente partajate de paginile de examen
// (Evaluare Națională + Bacalaureat): listă materiale, secțiuni colapsabile și
// comutator Interactive/PDF. `profile` e opțional (folosit doar la Bacalaureat).
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ContentCard } from './ContentPage';
import { fetchReviewStats } from '../lib/reviews';

// ─── Bloc de iteme ────────────────────────────────────────────────────────────
export function ItemBlock({ category, subcategory, profile, contentType, emptyText, returnTab }) {
  const { user, isPremium } = useAuth();
  const [items, setItems] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [ratingMap, setRatingMap] = useState({});   // content_id → { avg, n } (recenzii)
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      let q = supabase.from('content').select('*')
        .eq('category', category)
        .eq('content_type', contentType)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (subcategory) q = q.eq('subcategory', subcategory);
      if (profile) q = q.eq('profile', profile);
      const { data, error } = await q;
      if (!error) setItems(data || []);
      setLoading(false);
    }
    load();
  }, [category, subcategory, profile, contentType]);

  useEffect(() => {
    if (!user || items.length === 0 || contentType !== 'interactive') return;
    const ids = items.map(i => i.id);
    supabase.from('progress').select('*').eq('user_id', user.id).in('content_id', ids)
      .then(({ data }) => {
        if (data) {
          const map = {};
          data.forEach(p => { map[p.content_id] = p; });
          setProgressMap(map);
        }
      });
  }, [user, items, contentType]);

  // Media recenziilor (stele) — doar testele interactive primesc note
  useEffect(() => {
    if (items.length === 0 || contentType !== 'interactive') return;
    let alive = true;
    fetchReviewStats('content', items.map(i => i.id)).then(map => { if (alive) setRatingMap(map); });
    return () => { alive = false; };
  }, [items, contentType]);

  if (loading) return (
    <div style={{ padding: '10px 0', color: 'var(--text-muted)', fontSize: '0.83rem' }}>
      Se încarcă...
    </div>
  );
  if (items.length === 0) return (
    <div style={{ padding: '10px 14px', background: '#f7f9fc', borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 6 }}>
      {emptyText || 'Niciun material disponibil momentan.'}
    </div>
  );
  return (
    <div>
      {items.map(item => (
        <ContentCard key={item.id} item={item} isPremium={isPremium} user={user} progress={progressMap[item.id]} rating={ratingMap[item.id]} forceTab={returnTab} />
      ))}
    </div>
  );
}

// ─── Secțiune colapsabilă ─────────────────────────────────────────────────────
export function Section({ title, icon, defaultOpen = false, children, level = 1 }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  const bgColor = level === 1 ? 'var(--navy)' : level === 2 ? 'var(--navy-light)' : '#2a4a65';
  const fontSize = level === 1 ? '1rem' : level === 2 ? '0.92rem' : '0.87rem';

  return (
    <div style={{ marginBottom: level === 1 ? 12 : 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: level === 1 ? '13px 20px' : '10px 16px',
          background: bgColor, color: '#fff', border: 'none', cursor: 'pointer',
          borderRadius: open ? '10px 10px 0 0' : 10,
          fontWeight: 700, fontSize, fontFamily: 'var(--font-body)',
        }}
      >
        <span>{icon} {title}</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ border: '1.5px solid #dde1e8', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '16px', background: '#fafbfc' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Comutator Interactive / PDF în interiorul unei secțiuni ───────────────────
export function TypeTabs({ category, subcategory, profile, returnTab }) {
  const location = useLocation();
  const returningHere = location.state?.scrollToCardId && location.state?.returnSubcategory === subcategory;
  const initialType = returningHere ? (location.state?.returnContentType || 'interactive') : 'interactive';
  const [type, setType] = useState(initialType);
  const btn = (active) => ({
    flex: 1, padding: '8px 12px', cursor: 'pointer',
    border: '1.5px solid var(--navy)',
    background: active ? 'var(--navy)' : '#fff',
    color: active ? '#fff' : 'var(--navy)',
    fontWeight: 700, fontSize: '0.82rem', fontFamily: 'var(--font-body)',
    transition: 'all 0.15s',
  });
  return (
    <div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderRadius: 8, overflow: 'hidden' }}>
        <button style={{ ...btn(type === 'interactive'), borderRadius: '8px 0 0 8px' }} onClick={() => setType('interactive')}>
          🧩 Interactive
        </button>
        <button style={{ ...btn(type === 'pdf'), borderRadius: '0 8px 8px 0', borderLeft: 'none' }} onClick={() => setType('pdf')}>
          📄 PDF
        </button>
      </div>
      {type === 'interactive'
        ? <ItemBlock category={category} subcategory={subcategory} profile={profile} contentType="interactive" returnTab={returnTab} />
        : <ItemBlock category={category} subcategory={subcategory} profile={profile} contentType="pdf" returnTab={returnTab} />}
    </div>
  );
}
