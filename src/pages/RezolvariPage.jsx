import { authHeaders } from '../lib/api';
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

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
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (yt) return { type: 'youtube', id: yt[1] };
  const tt = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
  if (tt) return { type: 'tiktok', url };
  return { type: 'link', url };
}

// Deschide fișier ca blob (ascunde URL-ul Supabase)
async function openAsBlob(url, mimeType = 'application/pdf') {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Eroare fetch');
  const buf = await resp.arrayBuffer();
  const blob = new Blob([buf], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl; a.target = '_blank';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}

function RezolvareCard({ item, user, isPremium }) {
  const navigate = useNavigate();
  const canAccess = item.is_free || isPremium;
  const [loading, setLoading] = useState(false);

  const catLabel = CATEGORIES.find(c => c.value === item.category)?.label || item.category;
  const video = item.type === 'video' ? getVideoEmbed(item.video_url) : null;

  // Imaginile nu se preîncarcă automat — se deschid la click

  async function getSecureUrl(item, user) {
    if (item.is_free) return item.file_url;
    const res = await fetch('/api/rezolvare-url', {
      method: 'POST', headers: await authHeaders(),
      body: JSON.stringify({ rezolvareId: item.id, userId: user?.id }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    return d.url;
  }

  async function handleOpenPdf() {
    if (!canAccess) { navigate('/preturi'); return; }
    setLoading(true);
    try {
      const url = await getSecureUrl(item, user);
      await openAsBlob(url, 'application/pdf');
    } catch (e) { alert(e.message); }
    setLoading(false);
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 14, border: '1.5px solid #eef0f4',
      overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,43,68,0.06)',
      transition: 'box-shadow 0.2s', display: 'flex', flexDirection: 'column',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(15,43,68,0.12)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(15,43,68,0.06)'}
    >


      {/* ── Video ── */}
      {item.type === 'video' && video && (
        video.type === 'youtube' ? (
          <div style={{ aspectRatio:'16/9' }}>
            <iframe width="100%" height="100%"
              src={`https://www.youtube.com/embed/${video.id}`}
              allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen style={{ border:'none', display:'block' }} title={item.title} />
          </div>
        ) : (
          <a href={video.url} target="_blank" rel="noopener noreferrer"
            style={{ display:'flex', alignItems:'center', gap:10, padding:'20px', background:'#000', color:'#fff', textDecoration:'none' }}>
            <span style={{ fontSize:'1.5rem' }}>▶</span>
            <span style={{ fontSize:'0.88rem', fontWeight:600 }}>Deschide pe TikTok</span>
          </a>
        )
      )}

      {/* Info + butoane */}
      <div style={{ padding:'14px 18px', flex:1, display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
          <h3 style={{ fontFamily:'var(--font-display)', color:'var(--navy)', fontSize:'0.98rem', fontWeight:700, lineHeight:1.3, flex:1 }}>
            {item.title}
          </h3>
          <div style={{ display:'flex', gap:5, flexShrink:0 }}>
            <span style={{
              padding:'2px 8px', borderRadius:20, fontSize:'0.67rem', fontWeight:700,
              background: item.is_free ? '#e8f5e9' : '#fff3e0',
              color: item.is_free ? '#2e7d32' : '#e65100',
            }}>{item.is_free ? 'Gratuit' : 'Premium'}</span>
            <span style={{
              padding:'2px 8px', borderRadius:20, fontSize:'0.67rem', fontWeight:700,
              background: item.type==='video' ? '#fce4ec' : item.type==='pdf' ? '#e3f2fd' : '#e8f5e9',
              color: item.type==='video' ? '#c62828' : item.type==='pdf' ? '#1565c0' : '#2e7d32',
            }}>{item.type==='video' ? '▶ Video' : item.type==='pdf' ? '📄 PDF' : '🖼 Imagine'}</span>
          </div>
        </div>

        {item.description && (
          <p style={{ color:'var(--text-muted)', fontSize:'0.84rem', lineHeight:1.6, margin:0 }}>{item.description}</p>
        )}

        {catLabel && <div style={{ fontSize:'0.72rem', color:'#aab0bb', marginTop:'auto' }}>{catLabel}</div>}

        {/* Buton Imagine */}
        {item.type === 'image' && (
          canAccess ? (
            <button onClick={async () => {
              setLoading(true);
              try {
                const url = await getSecureUrl(item, user);
                const resp = await fetch(url);
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                const w = window.open('');
                w.document.write(`<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${blobUrl}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
              } catch(e) { alert(e.message); }
              setLoading(false);
            }} disabled={loading}
              style={{ padding:'8px 16px', background:'var(--navy)', color:'#fff', border:'none', borderRadius:8, fontWeight:600, fontSize:'0.85rem', cursor:'pointer', width:'100%' }}>
              {loading ? '⏳' : '🖼 Deschide imaginea'}
            </button>
          ) : !user ? (
            <Link to="/autentificare" style={{ display:'block', padding:'8px 16px', background:'#f0f4f8', color:'var(--navy)', border:'1.5px solid #dde1e8', borderRadius:8, fontWeight:600, fontSize:'0.85rem', textAlign:'center', textDecoration:'none' }}>
              🔒 Autentifică-te
            </Link>
          ) : (
            <Link to="/preturi" style={{ display:'block', padding:'8px 16px', background:'var(--gold)', color:'var(--navy-dark)', borderRadius:8, fontWeight:600, fontSize:'0.85rem', textAlign:'center', textDecoration:'none' }}>
              🔒 Necesită Premium
            </Link>
          )
        )}

        {/* Buton PDF */}
        {item.type === 'pdf' && (
          canAccess ? (
            <button onClick={handleOpenPdf} disabled={loading}
              style={{ padding:'8px 16px', background:'var(--navy)', color:'#fff', border:'none', borderRadius:8, fontWeight:600, fontSize:'0.85rem', cursor:'pointer', width:'100%' }}>
              {loading ? '⏳ Se deschide...' : '📄 Deschide PDF'}
            </button>
          ) : !user ? (
            <Link to="/autentificare" style={{ display:'block', padding:'8px 16px', background:'#f0f4f8', color:'var(--navy)', border:'1.5px solid #dde1e8', borderRadius:8, fontWeight:600, fontSize:'0.85rem', textAlign:'center', textDecoration:'none' }}>
              🔒 Autentifică-te
            </Link>
          ) : (
            <Link to="/preturi" style={{ display:'block', padding:'8px 16px', background:'var(--gold)', color:'var(--navy-dark)', borderRadius:8, fontWeight:600, fontSize:'0.85rem', textAlign:'center', textDecoration:'none' }}>
              🔒 Necesită Premium
            </Link>
          )
        )}
      </div>
    </div>
  );
}

export default function RezolvariPage() {
  const { user, isPremium } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('');
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('rezolvari')
      .select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
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
          <div className="breadcrumb"><Link to="/">Acasă</Link><span>›</span><span>Rezolvări</span></div>
          <h1>📝 Rezolvări</h1>
          <p>Rezolvări, explicații și tutoriale video pentru exercițiile de matematică</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          <div style={{ display:'flex', gap:10, marginBottom:24, flexWrap:'wrap' }}>
            <input type="text" placeholder="🔍 Caută rezolvare..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex:1, minWidth:180, padding:'9px 14px', borderRadius:8, border:'1.5px solid #dde1e8', fontSize:'0.88rem', outline:'none', fontFamily:'var(--font-body)' }} />
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              style={{ padding:'9px 12px', borderRadius:8, border:'1.5px solid #dde1e8', fontSize:'0.85rem', background:'#fff', fontFamily:'var(--font-body)' }}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ padding:'9px 12px', borderRadius:8, border:'1.5px solid #dde1e8', fontSize:'0.85rem', background:'#fff', fontFamily:'var(--font-body)' }}>
              <option value="">Toate tipurile</option>
              <option value="video">▶ Video</option>
              <option value="pdf">📄 PDF</option>
              <option value="image">🖼 Imagine</option>
            </select>
          </div>

          {loading ? (
            <div style={{ display:'flex', justifyContent:'center', padding:'60px 0' }}><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <h3>Nicio rezolvare</h3>
              <p>{search || filterCat || filterType ? 'Niciun rezultat pentru filtrele selectate.' : 'Rezolvările vor fi adăugate în curând!'}</p>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:20 }}>
              {filtered.map(item => <RezolvareCard key={item.id} item={item} user={user} isPremium={isPremium} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
