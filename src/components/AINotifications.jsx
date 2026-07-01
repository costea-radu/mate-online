// =====================================================================
// src/components/AINotifications.jsx
// Clopoțel de notificări (ex: alerte de stagnare pentru profesor).
// Montează-l în Navbar sau în zona de profesor: <AINotifications />
// =====================================================================
import { useState, useEffect, useRef } from 'react';
import { aiClient } from '../lib/aiClient';

export default function AINotifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  async function loadCount() {
    try { const { count } = await aiClient.notificationsUnread(); setUnread(count || 0); } catch { /* ignore */ }
  }

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 60000); // reîmprospătare la 1 min
    return () => clearInterval(t);
  }, []);

  // închidere la click în afară
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
    try { await aiClient.notificationRead({ all: true }); setItems((it) => it.map((n) => ({ ...n, read: true }))); setUnread(0); } catch { /* ignore */ }
  }
  async function markRead(id) {
    try { await aiClient.notificationRead({ notificationId: id }); setItems((it) => it.map((n) => (n.id === id ? { ...n, read: true } : n))); setUnread((u) => Math.max(0, u - 1)); } catch { /* ignore */ }
  }

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
          width: 'min(340px, calc(100vw - 24px))', maxHeight: 440, overflowY: 'auto',
          background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#fff' }}>
            <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>Notificări</strong>
            {items.some((n) => !n.read) && <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--gold-dim)', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer' }}>Marchează toate citite</button>}
          </div>

          {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '.85rem' }}>Se încarcă…</div>}
          {!loading && items.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '.85rem' }}>Nicio notificare. 🎉</div>}

          {items.map((n) => (
            <div key={n.id} onClick={() => !n.read && markRead(n.id)}
              style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', background: n.read ? '#fff' : 'rgba(232,185,49,.08)', cursor: n.read ? 'default' : 'pointer' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <span>{n.type === 'stagnation' ? '⚠️' : 'ℹ️'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--navy)' }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: '.8rem', color: 'var(--text-light)', marginTop: 2 }}>{n.body}</div>}
                  <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: 3 }}>{new Date(n.created_at).toLocaleString('ro-RO')}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
