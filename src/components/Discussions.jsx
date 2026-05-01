import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = [
  { value: '', label: '— Selectează categoria —' },
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
  { value: 'manuale', label: 'Auxiliare' },
];

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'acum câteva secunde';
  if (diff < 3600) return `acum ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `acum ${Math.floor(diff / 3600)}h`;
  return new Date(dateStr).toLocaleDateString('ro-RO');
}

function Avatar({ name, avatarUrl, size = 36 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return avatarUrl ? (
    <img src={avatarUrl} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: 'var(--navy)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38 + 'px', fontWeight: 700, flexShrink: 0,
    }}>{initials}</div>
  );
}

async function uploadFile(file, userId) {
  const path = `${userId}/${Date.now()}_${file.name}`;
  const { error } = await supabase.storage.from('discussions').upload(path, file);
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('discussions').getPublicUrl(path);
  const ext = file.name.split('.').pop().toLowerCase();
  const fileType = ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'image' : 'pdf';
  return { url: publicUrl, type: fileType, name: file.name };
}

// ─── Formular de postare ──────────────────────────────────────────────────────
function PostForm({ fixedCategory, parentId, onPosted, onCancel, placeholder, isReply }) {
  const { user, profile } = useAuth();
  const [body, setBody] = useState('');
  const [category, setCategory] = useState(fixedCategory || '');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  async function handleSubmit() {
    if (!body.trim() && !file) return;
    if (!isReply && !category) { setError('Selectează o categorie.'); return; }
    setLoading(true); setError('');
    try {
      let fileData = null;
      if (file) fileData = await uploadFile(file, user.id);
      const { error: err } = await supabase.from('discussions').insert({
        user_id: user.id,
        category_key: isReply ? null : (category || null),
        parent_id: parentId || null,
        body: body.trim() || null,
        file_url: fileData?.url || null,
        file_type: fileData?.type || null,
        file_name: fileData?.name || null,
      });
      if (err) throw err;
      setBody(''); setFile(null);
      onPosted?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || null;
  const name = profile?.full_name || user?.user_metadata?.name || user?.email || '?';

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <Avatar name={name} avatarUrl={avatarUrl} size={38} />
      <div style={{ flex: 1 }}>
        {/* Selector categorie — doar pentru postări noi, nu pentru răspunsuri */}
        {!isReply && !fixedCategory && (
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{
              width: '100%', marginBottom: 8, padding: '8px 12px',
              borderRadius: 8, border: '1.5px solid #dde1e8',
              fontSize: '0.87rem', fontFamily: 'var(--font-body)',
              color: 'var(--navy)', outline: 'none',
              background: '#fff',
            }}
          >
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
        {!isReply && fixedCategory && (
          <div style={{ fontSize: '0.78rem', color: '#aab', marginBottom: 6 }}>
            Categorie: <strong>{CATEGORIES.find(c=>c.value===fixedCategory)?.label || fixedCategory}</strong>
          </div>
        )}

        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={placeholder || 'Scrie un comentariu, întrebare sau rezolvare...'}
          rows={isReply ? 2 : 3}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: '1.5px solid #dde1e8', fontSize: '0.9rem',
            fontFamily: 'var(--font-body)', resize: 'vertical', outline: 'none',
            lineHeight: 1.6, transition: 'border-color 0.2s',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--navy)'}
          onBlur={e => e.target.style.borderColor = '#dde1e8'}
        />

        {file && (
          <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:6, padding:'7px 11px', background:'#f0f4f8', borderRadius:8 }}>
            <span>{file.type.startsWith('image') ? '🖼' : '📄'}</span>
            <span style={{ fontSize:'0.81rem', color:'var(--navy)', flex:1 }}>{file.name}</span>
            <button onClick={() => setFile(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#e53935' }}>✕</button>
          </div>
        )}

        {error && <div style={{ color:'#e53935', fontSize:'0.8rem', marginTop:5 }}>{error}</div>}

        <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center', flexWrap:'wrap' }}>
          <button onClick={() => fileRef.current.click()} style={{ padding:'6px 13px', borderRadius:7, border:'1.5px solid #dde1e8', background:'#fff', cursor:'pointer', fontSize:'0.81rem', color:'var(--navy)', display:'flex', alignItems:'center', gap:5 }}>
            📎 Atașează
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display:'none' }} onChange={e => setFile(e.target.files[0] || null)} />
          <div style={{ flex:1 }} />
          {onCancel && (
            <button onClick={onCancel} style={{ padding:'6px 13px', borderRadius:7, border:'1.5px solid #dde1e8', background:'#fff', cursor:'pointer', fontSize:'0.81rem', color:'#5a6170' }}>Anulează</button>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading || (!body.trim() && !file)}
            style={{ padding:'7px 18px', borderRadius:8, background:'var(--navy)', color:'#fff', border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.85rem', opacity:(!body.trim()&&!file)?0.4:1 }}
          >
            {loading ? 'Se trimite...' : '✉ Trimite'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente fișiere fără URL vizibil ─────────────────────────────────────
function SecureImage({ url, name }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(url)
      .then(r => r.blob())
      .then(blob => setBlobUrl(URL.createObjectURL(blob)))
      .catch(() => setBlobUrl(url)) // fallback la url direct
      .finally(() => setLoading(false));
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [url]);

  if (loading) return <div style={{ height:80, background:'#f0f4f8', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', color:'#aaa', fontSize:'0.82rem' }}>Se încarcă...</div>;

  return (
    <img
      src={blobUrl}
      alt={name}
      onClick={() => { const a = document.createElement('a'); a.href = blobUrl; a.target = '_blank'; a.click(); }}
      style={{ maxWidth:'100%', maxHeight:320, borderRadius:8, display:'block', cursor:'zoom-in' }}
    />
  );
}

function SecurePdf({ url, name }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);

  function openPdf() {
    if (blobUrl) { const a = document.createElement('a'); a.href = blobUrl; a.target = '_blank'; a.click(); return; }
    setLoading(true);
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        const bu = URL.createObjectURL(blob);
        setBlobUrl(bu);
        const a = document.createElement('a'); a.href = bu; a.target = '_blank'; a.click();
      })
      .catch(() => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click(); })
      .finally(() => setLoading(false));
  }

  return (
    <button onClick={openPdf} style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'8px 14px', background:'#f0f4f8', borderRadius:8, color:'var(--navy)', border:'none', cursor:'pointer', fontSize:'0.83rem', fontWeight:600 }}>
      📄 {loading ? 'Se deschide...' : (name || 'Deschide PDF')}
    </button>
  );
}

// ─── Card postare ─────────────────────────────────────────────────────────────
function PostCard({ post, onRefresh, depth = 0 }) {
  const { user, isAdmin } = useAuth();
  const [showReply, setShowReply] = useState(false);
  const [replies, setReplies] = useState([]);
  const [showReplies, setShowReplies] = useState(false);
  const [replyCount, setReplyCount] = useState(0);

  useEffect(() => {
    supabase.from('discussions').select('id', { count: 'exact', head: true }).eq('parent_id', post.id)
      .then(({ count }) => setReplyCount(count || 0));
  }, [post.id]);

  async function loadReplies() {
    let { data, error } = await supabase
      .from('discussions')
      .select('*, profile:profiles(full_name, email, avatar_url)')
      .eq('parent_id', post.id)
      .order('created_at', { ascending: true });
    if (error) {
      const { data: data2 } = await supabase
        .from('discussions').select('*')
        .eq('parent_id', post.id).order('created_at', { ascending: true });
      data = (data2 || []).map(p => ({ ...p, profile: null }));
    }
    setReplies(data || []);
    setShowReplies(true);
  }

  async function handleDelete() {
    if (!window.confirm('Ștergi această postare?')) return;
    if (post.file_url) {
      try {
        const parts = post.file_url.split('/discussions/');
        if (parts[1]) await supabase.storage.from('discussions').remove([parts[1]]);
      } catch (_) {}
    }
    await supabase.from('discussions').delete().eq('id', post.id);
    onRefresh?.();
  }

  const canDelete = user && (user.id === post.user_id || isAdmin);
  const p = post.profile;
  const name = p?.full_name || p?.email?.split('@')[0] || 'Utilizator';
  const avatarUrl = p?.avatar_url || null;
  const catLabel = CATEGORIES.find(c => c.value === post.category_key)?.label;

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0, borderLeft: depth > 0 ? '2px solid #eef0f4' : 'none', paddingLeft: depth > 0 ? 14 : 0, marginBottom: 10 }}>
      <div style={{ background:'#fff', borderRadius:12, padding:'14px 16px', border:'1.5px solid #eef0f4', boxShadow:'0 1px 4px rgba(15,43,68,0.04)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <Avatar name={name} avatarUrl={avatarUrl} size={34} />
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:600, color:'var(--navy)', fontSize:'0.88rem' }}>{name}</div>
            <div style={{ fontSize:'0.72rem', color:'#aab0bb', display:'flex', gap:8 }}>
              <span>{timeAgo(post.created_at)}</span>
              {catLabel && <span>· {catLabel}</span>}
            </div>
          </div>
          {canDelete && (
            <button onClick={handleDelete} title="Șterge" style={{ background:'none', border:'none', cursor:'pointer', color:'#e53935', fontSize:'0.78rem', opacity:0.6 }}>🗑</button>
          )}
        </div>

        {post.body && (
          <p style={{ fontSize:'0.9rem', color:'var(--text)', lineHeight:1.7, whiteSpace:'pre-wrap', marginBottom: post.file_url ? 10 : 0 }}>
            {post.body}
          </p>
        )}

        {post.file_url && (
          <div style={{ marginTop:8 }}>
            {post.file_type === 'image'
              ? <SecureImage url={post.file_url} name={post.file_name} />
              : <SecurePdf url={post.file_url} name={post.file_name} />
            }
          </div>
        )}

        {user && depth < 2 && (
          <div style={{ marginTop:10, display:'flex', gap:12 }}>
            <button onClick={() => setShowReply(r => !r)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--navy)', fontSize:'0.8rem', fontWeight:600, padding:0 }}>
              💬 Răspunde
            </button>
            {replyCount > 0 && !showReplies && (
              <button onClick={loadReplies} style={{ background:'none', border:'none', cursor:'pointer', color:'#5a6170', fontSize:'0.78rem', padding:0 }}>
                ▼ {replyCount} răspuns{replyCount !== 1 ? 'uri' : ''}
              </button>
            )}
            {showReplies && (
              <button onClick={() => setShowReplies(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#5a6170', fontSize:'0.78rem', padding:0 }}>
                ▲ Ascunde
              </button>
            )}
          </div>
        )}
      </div>

      {showReply && (
        <div style={{ marginTop:8, paddingLeft:4 }}>
          <PostForm
            isReply parentId={post.id} placeholder="Scrie un răspuns..."
            onPosted={() => { setShowReply(false); setReplyCount(c=>c+1); loadReplies(); }}
            onCancel={() => setShowReply(false)}
          />
        </div>
      )}
      {showReplies && replies.map(r => <PostCard key={r.id} post={r} onRefresh={loadReplies} depth={depth+1} />)}
    </div>
  );
}

// ─── Componentă principală ────────────────────────────────────────────────────
export default function Discussions({ fixedCategory }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState(fixedCategory || '');
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => { load(0); }, [filterCat, fixedCategory]);

  async function load(pageNum = 0) {
    setLoading(true);
    const from = pageNum * PAGE_SIZE;
    let q = supabase
      .from('discussions')
      .select('*, profile:profiles(full_name, email, avatar_url)')
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (filterCat) q = q.eq('category_key', filterCat);

    const { data, error } = await q;
    if (error) {
      console.error('Discussions load error:', error);
      // Retry fără join pe profiles dacă relația nu există
      let q2 = supabase
        .from('discussions')
        .select('*')
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (filterCat) q2 = q2.eq('category_key', filterCat);
      const { data: data2, error: err2 } = await q2;
      if (!err2) {
        const items = (data2 || []).map(p => ({ ...p, profile: null }));
        if (pageNum === 0) setPosts(items);
        else setPosts(prev => [...prev, ...items]);
        setHasMore(items.length === PAGE_SIZE);
        setPage(pageNum);
      } else {
        console.error('Discussions retry error:', err2);
      }
    } else {
      if (pageNum === 0) setPosts(data || []);
      else setPosts(prev => [...prev, ...(data || [])]);
      setHasMore((data || []).length === PAGE_SIZE);
      setPage(pageNum);
    }
    setLoading(false);
  }

  return (
    <div style={{ marginTop: 40, paddingTop: 28, borderTop: '2px solid #eef0f4' }}>
      <h2 style={{ fontFamily:'var(--font-display)', color:'var(--navy)', fontSize:'1.3rem', marginBottom:20 }}>
        💬 Discuții / Rezolvări
      </h2>

      {/* Formular postare */}
      {user ? (
        <div style={{ background:'#fff', borderRadius:12, padding:'16px', border:'1.5px solid #eef0f4', marginBottom:24 }}>
          <PostForm fixedCategory={fixedCategory} onPosted={() => load(0)} />
        </div>
      ) : (
        <div style={{ background:'#f7f9fc', borderRadius:12, padding:'20px 24px', border:'1.5px solid #eef0f4', marginBottom:24, textAlign:'center' }}>
          <p style={{ color:'#5a6170', fontSize:'0.9rem', marginBottom:12 }}>Autentifică-te pentru a posta comentarii sau rezolvări.</p>
          <Link to="/autentificare" style={{ display:'inline-block', padding:'8px 20px', background:'var(--navy)', color:'#fff', borderRadius:8, fontWeight:600, fontSize:'0.88rem', textDecoration:'none' }}>
            Autentifică-te
          </Link>
        </div>
      )}

      {/* Filtru categorie — doar pe pagina globală */}
      {!fixedCategory && (
        <div style={{ marginBottom:20 }}>
          <select
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
            style={{ padding:'8px 14px', borderRadius:8, border:'1.5px solid #dde1e8', fontSize:'0.87rem', fontFamily:'var(--font-body)', color:'var(--navy)', outline:'none', background:'#fff' }}
          >
            <option value="">Toate categoriile</option>
            {CATEGORIES.filter(c=>c.value).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      )}

      {/* Lista */}
      {loading && posts.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:'#aab0bb' }}>Se încarcă...</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:'#aab0bb' }}>
          <div style={{ fontSize:'2rem', marginBottom:8 }}>💬</div>
          <p>Nicio discuție încă. Fii primul care postează!</p>
        </div>
      ) : (
        <>
          {posts.map(post => <PostCard key={post.id} post={post} onRefresh={() => load(0)} />)}
          {hasMore && (
            <button onClick={() => load(page+1)} style={{ width:'100%', padding:'10px', marginTop:8, background:'#f0f4f8', border:'1.5px solid #dde1e8', borderRadius:8, cursor:'pointer', color:'var(--navy)', fontWeight:600, fontSize:'0.85rem' }}>
              Încarcă mai multe
            </button>
          )}
        </>
      )}
    </div>
  );
}
