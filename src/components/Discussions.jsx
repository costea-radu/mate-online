import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// ─── Formatare dată ───────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'acum câteva secunde';
  if (diff < 3600) return `acum ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `acum ${Math.floor(diff / 3600)}h`;
  return new Date(dateStr).toLocaleDateString('ro-RO');
}

// ─── Avatar utilizator ────────────────────────────────────────────────────────
function Avatar({ profile, size = 36 }) {
  const name = profile?.full_name || profile?.email || '?';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const avatar = profile?.avatar_url;
  return avatar ? (
    <img src={avatar} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: 'var(--navy)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38 + 'px', fontWeight: 700, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ─── Upload fișier ────────────────────────────────────────────────────────────
async function uploadFile(file, userId) {
  const ext = file.name.split('.').pop().toLowerCase();
  const path = `${userId}/${Date.now()}_${file.name}`;
  const { data, error } = await supabase.storage.from('discussions').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from('discussions').getPublicUrl(path);
  const fileType = ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'image' : 'pdf';
  return { url: publicUrl, type: fileType, name: file.name };
}

// ─── Formular postare ─────────────────────────────────────────────────────────
function PostForm({ contentId, categoryKey, parentId, onPosted, onCancel, placeholder }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  async function handleSubmit() {
    if (!body.trim() && !file) return;
    setLoading(true);
    setError('');
    try {
      let fileData = null;
      if (file) fileData = await uploadFile(file, user.id);

      const { error: err } = await supabase.from('discussions').insert({
        user_id: user.id,
        content_id: contentId || null,
        category_key: categoryKey || null,
        parent_id: parentId || null,
        body: body.trim() || null,
        file_url: fileData?.url || null,
        file_type: fileData?.type || null,
        file_name: fileData?.name || null,
      });
      if (err) throw err;

      setBody('');
      setFile(null);
      onPosted?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={placeholder || 'Scrie un comentariu, întrebare sau rezolvare...'}
        rows={3}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 10,
          border: '1.5px solid #dde1e8', fontSize: '0.9rem',
          fontFamily: 'var(--font-body)', resize: 'vertical',
          outline: 'none', transition: 'border-color 0.2s',
          lineHeight: 1.6,
        }}
        onFocus={e => e.target.style.borderColor = 'var(--navy)'}
        onBlur={e => e.target.style.borderColor = '#dde1e8'}
      />

      {/* Preview fișier selectat */}
      {file && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px 12px', background: '#f0f4f8', borderRadius: 8 }}>
          <span>{file.type.startsWith('image') ? '🖼' : '📄'}</span>
          <span style={{ fontSize: '0.82rem', color: 'var(--navy)', flex: 1 }}>{file.name}</span>
          <button onClick={() => setFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {error && <div style={{ color: '#e53935', fontSize: '0.82rem', marginTop: 6 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Upload buton */}
        <button
          onClick={() => fileRef.current.click()}
          style={{
            padding: '7px 14px', borderRadius: 8, border: '1.5px solid #dde1e8',
            background: '#fff', cursor: 'pointer', fontSize: '0.83rem',
            color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          📎 Atașează fișier
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          style={{ display: 'none' }}
          onChange={e => setFile(e.target.files[0] || null)}
        />

        <div style={{ flex: 1 }} />

        {onCancel && (
          <button onClick={onCancel} style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #dde1e8', background: '#fff', cursor: 'pointer', fontSize: '0.83rem', color: '#5a6170' }}>
            Anulează
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={loading || (!body.trim() && !file)}
          style={{
            padding: '7px 18px', borderRadius: 8, background: 'var(--navy)',
            color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
            fontSize: '0.85rem', opacity: (!body.trim() && !file) ? 0.4 : 1,
          }}
        >
          {loading ? 'Se trimite...' : '✉ Trimite'}
        </button>
      </div>
    </div>
  );
}

// ─── Card postare ─────────────────────────────────────────────────────────────
function PostCard({ post, contentId, onRefresh, depth = 0 }) {
  const { user, isAdmin } = useAuth();
  const [showReply, setShowReply] = useState(false);
  const [replies, setReplies] = useState([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replyCount, setReplyCount] = useState(post.reply_count || 0);

  async function loadReplies() {
    setLoadingReplies(true);
    const { data } = await supabase
      .from('discussions')
      .select('*, profile:profiles(full_name, email, avatar_url)')
      .eq('parent_id', post.id)
      .order('created_at', { ascending: true });
    setReplies(data || []);
    setLoadingReplies(false);
    setShowReplies(true);
  }

  async function handleDelete() {
    if (!window.confirm('Ștergi această postare?')) return;
    if (post.file_url) {
      try {
        const path = post.file_url.split('/discussions/')[1];
        if (path) await supabase.storage.from('discussions').remove([path]);
      } catch (_) {}
    }
    await supabase.from('discussions').delete().eq('id', post.id);
    onRefresh?.();
  }

  const canDelete = user && (user.id === post.user_id || isAdmin);
  const profile = post.profile;

  return (
    <div style={{
      marginLeft: depth > 0 ? 24 : 0,
      borderLeft: depth > 0 ? '2px solid #eef0f4' : 'none',
      paddingLeft: depth > 0 ? 16 : 0,
      marginBottom: 12,
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '14px 16px',
        border: '1.5px solid #eef0f4',
        boxShadow: '0 1px 4px rgba(15,43,68,0.04)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Avatar profile={profile} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.88rem' }}>
              {profile?.full_name || 'Utilizator'}
            </div>
            <div style={{ fontSize: '0.73rem', color: '#aab0bb' }}>
              {timeAgo(post.created_at)}
            </div>
          </div>
          {canDelete && (
            <button onClick={handleDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: '0.78rem', opacity: 0.6 }} title="Șterge">🗑</button>
          )}
        </div>

        {/* Text */}
        {post.body && (
          <p style={{ fontSize: '0.9rem', color: 'var(--text)', lineHeight: 1.7, marginBottom: post.file_url ? 10 : 0, whiteSpace: 'pre-wrap' }}>
            {post.body}
          </p>
        )}

        {/* Fișier atașat */}
        {post.file_url && (
          <div style={{ marginTop: 8 }}>
            {post.file_type === 'image' ? (
              <a href={post.file_url} target="_blank" rel="noopener noreferrer">
                <img
                  src={post.file_url}
                  alt={post.file_name}
                  style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 8, display: 'block', cursor: 'zoom-in' }}
                />
              </a>
            ) : (
              <a href={post.file_url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', background: '#f0f4f8', borderRadius: 8,
                  color: 'var(--navy)', textDecoration: 'none', fontSize: '0.83rem', fontWeight: 600,
                }}>
                📄 {post.file_name || 'Deschide PDF'}
              </a>
            )}
          </div>
        )}

        {/* Acțiuni */}
        {user && depth < 2 && (
          <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={() => setShowReply(r => !r)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy)', fontSize: '0.8rem', fontWeight: 600, padding: 0 }}
            >
              💬 Răspunde
            </button>
            {replyCount > 0 && !showReplies && (
              <button
                onClick={loadReplies}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a6170', fontSize: '0.78rem', padding: 0 }}
              >
                {loadingReplies ? 'Se încarcă...' : `▼ ${replyCount} răspuns${replyCount !== 1 ? 'uri' : ''}`}
              </button>
            )}
            {showReplies && (
              <button onClick={() => setShowReplies(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a6170', fontSize: '0.78rem', padding: 0 }}>
                ▲ Ascunde
              </button>
            )}
          </div>
        )}
      </div>

      {/* Formular răspuns */}
      {showReply && (
        <div style={{ marginTop: 8, paddingLeft: 4 }}>
          <PostForm
            contentId={contentId}
            parentId={post.id}
            placeholder="Scrie un răspuns..."
            onPosted={() => {
              setShowReply(false);
              setReplyCount(c => c + 1);
              loadReplies();
            }}
            onCancel={() => setShowReply(false)}
          />
        </div>
      )}

      {/* Răspunsuri */}
      {showReplies && replies.map(r => (
        <PostCard key={r.id} post={r} contentId={contentId} onRefresh={loadReplies} depth={depth + 1} />
      ))}
    </div>
  );
}

// ─── Secțiunea principală de discuții ─────────────────────────────────────────
export default function Discussions({ contentId, categoryKey }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 10;

  useEffect(() => { load(0); }, [contentId, categoryKey]);

  async function load(pageNum = 0) {
    setLoading(true);
    const from = pageNum * PAGE_SIZE;
    const { data, error } = await supabase
      .from('discussions')
      .select(`
        *,
        profile:profiles(full_name, email, avatar_url),
        reply_count:discussions(count)
      `)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (!error) {
      const items = (data || []).map(p => ({ ...p, reply_count: 0 }));
      if (pageNum === 0) setPosts(items);
      else setPosts(prev => [...prev, ...items]);
      setHasMore((data || []).length === PAGE_SIZE);
      setPage(pageNum);
    }
    setLoading(false);
  }

  async function refresh() { await load(0); }

  return (
    <div style={{ marginTop: 48, paddingTop: 32, borderTop: '2px solid #eef0f4' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.4rem', marginBottom: 20 }}>
        💬 Discuții și Rezolvări
      </h2>

      {/* Formular postare nouă */}
      {user ? (
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px', border: '1.5px solid #eef0f4', marginBottom: 28 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Avatar profile={null} size={36} />
            <div style={{ flex: 1 }}>
              <PostForm contentId={contentId} categoryKey={categoryKey} onPosted={refresh} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#f7f9fc', borderRadius: 12, padding: '20px 24px',
          border: '1.5px solid #eef0f4', marginBottom: 28, textAlign: 'center',
        }}>
          <p style={{ color: '#5a6170', fontSize: '0.9rem', marginBottom: 12 }}>
            Autentifică-te pentru a posta comentarii sau rezolvări.
          </p>
          <Link to="/autentificare" style={{
            display: 'inline-block', padding: '8px 20px', background: 'var(--navy)',
            color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: '0.88rem', textDecoration: 'none',
          }}>
            Autentifică-te
          </Link>
        </div>
      )}

      {/* Lista postări */}
      {loading && posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#aab0bb' }}>Se încarcă discuțiile...</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#aab0bb' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>💬</div>
          <p>Nicio discuție încă. Fii primul care postează!</p>
        </div>
      ) : (
        <>
          {posts.map(post => (
            <PostCard key={post.id} post={post} contentId={contentId} onRefresh={refresh} />
          ))}
          {hasMore && (
            <button
              onClick={() => load(page + 1)}
              style={{
                width: '100%', padding: '10px', marginTop: 8,
                background: '#f0f4f8', border: '1.5px solid #dde1e8',
                borderRadius: 8, cursor: 'pointer', color: 'var(--navy)',
                fontWeight: 600, fontSize: '0.85rem',
              }}
            >
              Încarcă mai multe
            </button>
          )}
        </>
      )}
    </div>
  );
}
