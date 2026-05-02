import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const CATEGORIES = [
  { value: '', label: 'Toate categoriile' },
  { value: 'general', label: '💬 General' },
  { value: 'clasa-5', label: 'Clasa a V-a' },
  { value: 'clasa-6', label: 'Clasa a VI-a' },
  { value: 'clasa-7', label: 'Clasa a VII-a' },
  { value: 'clasa-8', label: 'Clasa a VIII-a' },
  { value: 'clasa-9', label: 'Clasa a IX-a' },
  { value: 'clasa-10', label: 'Clasa a X-a' },
  { value: 'clasa-11', label: 'Clasa a XI-a' },
  { value: 'clasa-12', label: 'Clasa a XII-a' },
  { value: 'evaluare-nationala', label: 'Evaluare Națională' },
  { value: 'bacalaureat', label: 'Bacalaureat' },
];

function getVideoEmbed(url) {
  if (!url) return null;
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (ytMatch) return { type: 'youtube', id: ytMatch[1] };
  // TikTok
  const ttMatch = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (ttMatch) return { type: 'tiktok', id: ttMatch[1], url };
  return { type: 'link', url };
}

function VideoCard({ url, title }) {
  const video = getVideoEmbed(url);
  if (!video) return null;

  if (video.type === 'youtube') {
    return (
      <div style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '16/9' }}>
        <iframe
          width="100%" height="100%"
          src={`https://www.youtube.com/embed/${video.id}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ border: 'none', display: 'block' }}
          title={title}
        />
      </div>
    );
  }
  if (video.type === 'tiktok') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#000', borderRadius: 10, color: '#fff', textDecoration: 'none' }}>
        <span style={{ fontSize: '1.5rem' }}>▶</span>
        <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Deschide pe TikTok</span>
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#f0f4f8', borderRadius: 10, color: 'var(--navy)', textDecoration: 'none' }}>
      <span style={{ fontSize: '1.2rem' }}>🔗</span>
      <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Deschide link</span>
    </a>
  );
}

function RezolvareCard({ item }) {
  const catLabel = CATEGORIES.find(c => c.value === item.category)?.label || item.category;

  return (
    <div style={{
      background: '#fff', borderRadius: 14, border: '1.5px solid #eef0f4',
      overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,43,68,0.06)',
      transition: 'box-shadow 0.2s',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(15,43,68,0.12)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(15,43,68,0.06)'}
    >
      {/* Imagine */}
      {item.type === 'image' && item.file_url && (
        <a href={item.file_url} target="_blank" rel="noopener noreferrer">
          <img src={item.file_url} alt={item.title}
            style={{ width: '100%', maxHeight: 280, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
        </a>
      )}

      {/* Video embed */}
      {item.type === 'video' && item.video_url && (
        <div style={{ padding: '0' }}>
          <VideoCard url={item.video_url} title={item.title} />
        </div>
      )}

      {/* PDF */}
      {item.type === 'pdf' && item.file_url && (
        <div style={{ background: '#f7f9fc', padding: '20px 20px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, background: '#e3f2fd', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', flexShrink: 0 }}>📄</div>
          <a href={item.file_url} target="_blank" rel="noopener noreferrer"
            style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.9rem', textDecoration: 'none' }}>
            Deschide PDF →
          </a>
        </div>
      )}

      {/* Info */}
      <div style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1rem', fontWeight: 700, lineHeight: 1.3 }}>
            {item.title}
          </h3>
          <span style={{
            padding: '2px 9px', borderRadius: 20, fontSize: '0.68rem', fontWeight: 700,
            background: item.type === 'video' ? '#fce4ec' : item.type === 'pdf' ? '#e3f2fd' : '#e8f5e9',
            color: item.type === 'video' ? '#c62828' : item.type === 'pdf' ? '#1565c0' : '#2e7d32',
            flexShrink: 0,
          }}>
            {item.type === 'video' ? '▶ Video' : item.type === 'pdf' ? '📄 PDF' : '🖼 Imagine'}
          </span>
        </div>
        {item.description && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>{item.description}</p>
        )}
        {catLabel && (
          <div style={{ marginTop: 8, fontSize: '0.73rem', color: '#aab0bb' }}>{catLabel}</div>
        )}
      </div>
    </div>
  );
}

export default function RezolvariPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterCat, setFilterCat] = useState(searchParams.get('cat') || '');
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('rezolvari')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }

  const filtered = items.filter(item => {
    if (filterCat && item.category !== filterCat) return false;
    if (filterType && item.type !== filterType) return false;
    if (search && !item.title.toLowerCase().includes(search.toLowerCase()) &&
        !(item.description || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Rezolvări</span>
          </div>
          <h1>📝 Rezolvări</h1>
          <p>Rezolvări, explicații și tutoriale video pentru exercițiile de matematică</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          {/* Filtre */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text" placeholder="🔍 Caută rezolvare..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '9px 14px', borderRadius: 8, border: '1.5px solid #dde1e8', fontSize: '0.88rem', outline: 'none', fontFamily: 'var(--font-body)' }}
            />
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #dde1e8', fontSize: '0.85rem', fontFamily: 'var(--font-body)', background: '#fff' }}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #dde1e8', fontSize: '0.85rem', fontFamily: 'var(--font-body)', background: '#fff' }}>
              <option value="">Toate tipurile</option>
              <option value="video">▶ Video</option>
              <option value="pdf">📄 PDF</option>
              <option value="image">🖼 Imagine</option>
            </select>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <div className="spinner" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <h3>Nicio rezolvare</h3>
              <p>{search || filterCat || filterType ? 'Niciun rezultat pentru filtrele selectate.' : 'Rezolvările vor fi adăugate în curând!'}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
              {filtered.map(item => <RezolvareCard key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
