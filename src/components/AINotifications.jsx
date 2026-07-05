// =====================================================================
// src/components/AINotifications.jsx
// Clopoțel de notificări: materiale noi, forum, like-uri, progres elevi/copil,
// update-uri. Clic pe notificare → se deschide materialul. Montat în Navbar.
// =====================================================================
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';

const ICONS = {
  material: '📄', forum: '💬', forum_reply: '💬', like: '❤️',
  stagnation: '⚠️', evolution: '📈', decline: '📉', update: '✨', assignment_done: '✅', info: 'ℹ️',
};

export default function AINotifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { profile } = useAuth();

  async function loadCount() {
    try { const { count } = await aiClient.notificationsUnread(); setUnread(count || 0); } catch { /* ignore */ }
  }

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try { const { notifications } = await aiClient.notifications(); setItems(notifications || []); }
      catch { /* ignore */ }
      finally { setLoading(false); }
    }
  }

  async function markAllRead() {
    try { await aiClient.notificationRead({ all: true }); setItems((it) => it.map((n) => ({ ...n, read: true }))); setUnread(0); }
    catch { /* ignore */ }
  }

  async function markRead(item) {
    try {
      await aiClient.notificationRead({ id: item.id, kind: item.kind });
      setItems((it) => it.map((n) => (n.id === item.id && n.kind === item.kind ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
    } catch { /* ignore */ }
  }

  function onClickItem(item) {
    if (!item.read) markRead(item);
    const url = item.data && item.data.url;
    if (url) { setOpen(false); navigate(url); }
  }

  if (profile && profile.notifications_enabled === false) return null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={toggle} aria-label="Notificări"
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', position: 'relative', lineHeight: 1 }}>
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -6, background: '#e74c3c', color: '#fff', borderRadius: 10, fontSize: '.65rem', fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '130%', zIndex: 1100,
          width: 'min(360px, calc(100vw - 24px))', maxHeight: 460, overflowY: 'auto',
          background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg, 0 12px 40px rgba(0,0,0,.25))',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#fff' }}>
            <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>Notificări</strong>
            {items.some((n) => !n.read) && <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--gold-dim, #b8860b)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer' }}>Marchează toate citite</button>}
          </div>

          {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '.85rem' }}>Se încarcă…</div>}
          {!loading && items.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '.85rem' }}>Nicio notificare. 🎉</div>}

          {items.map((n) => {
            const clickable = !!(n.data && n.data.url);
            return (
              <div key={`${n.kind}:${n.id}`} onClick={() => onClickItem(n)}
                style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', background: n.read ? '#fff' : 'rgba(232,185,49,.08)', cursor: (clickable || !n.read) ? 'pointer' : 'default' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span>{ICONS[n.type] || 'ℹ️'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--navy)' }}>{n.title}</div>
                    {n.body && <div style={{ fontSize: '.8rem', color: 'var(--text-light)', marginTop: 2 }}>{n.body}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                      <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{new Date(n.created_at).toLocaleString('ro-RO')}</span>
                      {clickable && <span style={{ fontSize: '.7rem', color: 'var(--gold-dim, #b8860b)', fontWeight: 600 }}>Deschide →</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
