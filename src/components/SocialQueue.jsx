// =====================================================================
// src/components/SocialQueue.jsx — CALENDARUL SOCIAL din admin (Faza 3
// din GHID_AGENT_SEO_ACTIUNI.md). Se montează în AIAdminPanel, sub coada
// de aprobare SEO.
//
// Ce arată (din tabelul social_posts, prin api/social-queue.js):
//   • „De postat manual" — TikTok/YouTube: text gata de copy-paste + media;
//   • „Programate" — Facebook/Instagram aprobate, cu ora și preview-ul
//     imaginii; se pot publica pe loc („Publică acum" — și test al config Meta);
//   • „Eșuate" — cu eroarea Graph API și buton de reîncercare;
//   • „Postate" — istoricul cu metrici (reach/like/comentarii) și permalink.
// Postările intră aici DOAR prin aprobarea propunerilor agentului
// (schedule_social) din coada de aprobare de mai sus.
// =====================================================================
import { useState, useEffect, useCallback } from 'react';
import { aiClient } from '../lib/aiClient';

const PLATFORM_INFO = {
  facebook:  { icon: '📘', label: 'Facebook',  auto: true },
  instagram: { icon: '📸', label: 'Instagram', auto: true },
  tiktok:    { icon: '🎵', label: 'TikTok',    auto: false },
  youtube:   { icon: '▶️', label: 'YouTube',   auto: false },
};

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }) : 'cât mai curând');

function MetricChips({ metrics }) {
  if (!metrics) return null;
  const chip = (label, val) => (val == null ? null : (
    <span style={{ fontSize: '.72rem', background: '#eef2f8', color: 'var(--navy)', borderRadius: 20, padding: '2px 9px' }}>
      {label} {val}
    </span>
  ));
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      {chip('👁', metrics.reach)}
      {chip('❤️', metrics.likes)}
      {chip('💬', metrics.comments)}
      {chip('🔁', metrics.shares)}
      {chip('🔖', metrics.saved)}
    </div>
  );
}

export default function SocialQueue({ box }) {
  const [posts, setPosts] = useState([]);
  const [meta, setMeta] = useState(null);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await aiClient.socialQueue({ action: 'list' });
      setPosts(r.posts || []);
      setMeta(r.meta || null);
      setWarning(r.warning || null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    // aprobarea unei propuneri schedule_social (în coada SEO) creează rânduri aici
    const onUpdate = () => load();
    window.addEventListener('social-posts-updated', onUpdate);
    return () => window.removeEventListener('social-posts-updated', onUpdate);
  }, [load]);

  async function act(id, action, extra = {}) {
    const confirms = {
      publish_now: 'Publici această postare ACUM pe platformă?',
      cancel: 'Anulezi această postare (nu se mai publică)?',
      retry: 'Reîncerci publicarea? (revine în coada cronului)',
    };
    if (confirms[action] && !window.confirm(confirms[action])) return;
    setBusyId(id); setError(null);
    try {
      await aiClient.socialQueue({ action, id, ...extra });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  function markPosted(id) {
    const url = window.prompt('Postată! Lipește linkul postării (opțional — pentru istoricul din admin):') || null;
    act(id, 'mark_posted', url ? { url } : {});
  }

  async function refreshMetrics() {
    setBusyId('metrics'); setError(null);
    try { await aiClient.socialQueue({ action: 'refresh_metrics' }); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  function copyText(id, text) {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((v) => (v === id ? null : v)), 1600);
  }

  const manual = posts.filter((p) => p.status === 'manual');
  const upcoming = posts.filter((p) => p.status === 'approved');
  const failed = posts.filter((p) => p.status === 'failed');
  const history = posts.filter((p) => ['posted', 'canceled'].includes(p.status));

  const card = (p, actions) => {
    const pi = PLATFORM_INFO[p.platform] || { icon: '📱', label: p.platform };
    const overdue = p.status === 'approved' && p.scheduled_at && new Date(p.scheduled_at) < new Date();
    return (
      <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem' }}>{pi.icon} {pi.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {p.campaign && <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>utm: {p.campaign}</span>}
            <span style={{ fontSize: '.72rem', color: overdue ? '#b25a00' : 'var(--text-muted)', fontWeight: overdue ? 700 : 400 }}>
              {p.status === 'posted' ? `postată ${fmtWhen(p.posted_at)}` : `⏰ ${fmtWhen(p.scheduled_at)}${overdue ? ' (scadentă — o ia următorul cron)' : ''}`}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {p.media_url && (/\.(mp4|mov|m4v)(\?|#|$)/i.test(p.media_url) ? (
            <video src={p.media_url} controls preload="metadata"
              style={{ width: 150, maxHeight: 220, borderRadius: 8, border: '1px solid var(--border)', background: '#000' }} />
          ) : (
            <a href={p.media_url} target="_blank" rel="noopener noreferrer" title="Deschide media">
              <img src={p.media_url} alt="" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </a>
          ))}
          <div style={{ flex: 1, minWidth: 220 }}>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, fontSize: '.84rem', lineHeight: 1.5, maxHeight: 150, overflowY: 'auto' }}>{p.text_content}</pre>
            {p.link_url && (
              <div style={{ fontSize: '.75rem', marginTop: 4, wordBreak: 'break-all' }}>
                🔗 <a href={p.link_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)' }}>{p.link_url}</a>
              </div>
            )}
            {p.error && <div style={{ fontSize: '.78rem', color: '#b71c1c', marginTop: 6 }}>⚠️ {p.error}</div>}
            {p.status === 'posted' && <MetricChips metrics={p.metrics} />}
            {p.status === 'posted' && p.metrics?.permalink && (
              <a href={p.metrics.permalink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.75rem', color: 'var(--navy)', display: 'inline-block', marginTop: 4 }}>
                ↗ Deschide postarea
              </a>
            )}
          </div>
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>{actions(p)}</div>}
      </div>
    );
  };

  const btn = (label, onClick, { primary = false, disabled = false } = {}) => (
    <button className={primary ? 'btn btn-primary' : 'btn btn-outline'} disabled={disabled}
      onClick={onClick} style={{ fontSize: '.8rem', padding: '6px 13px' }}>{label}</button>
  );

  const section = (title, items, renderActions) => items.length > 0 && (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.88rem', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{items.map((p) => card(p, renderActions))}</div>
    </div>
  );

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
          📱 Calendar social — Facebook & Instagram automat
          {(manual.length + upcoming.length) > 0 && (
            <span style={{ marginLeft: 8, fontSize: '.75rem', background: '#e8b931', color: '#17233f', borderRadius: 20, padding: '2px 10px', verticalAlign: 'middle' }}>
              {manual.length + upcoming.length} în lucru
            </span>
          )}
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={refreshMetrics} disabled={busyId === 'metrics' || loading} style={{ fontSize: '.78rem', padding: '5px 12px' }}>
            {busyId === 'metrics' ? '…' : '📊 Actualizează metricile'}
          </button>
          <button className="btn btn-outline" onClick={load} disabled={loading} style={{ fontSize: '.78rem', padding: '5px 12px' }}>↻ Reîmprospătează</button>
        </div>
      </div>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 4 }}>
        Postările aprobate în coada de mai sus ajung aici: Facebook/Instagram se publică singure la ora programată (cron la 15 minute),
        TikTok/YouTube așteaptă copy-paste-ul tău (fără audit, API-urile lor nu permit postare automată). Linkurile au UTM — efectul se vede în GA4.
      </p>
      {meta && !meta.facebook && (
        <div style={{ padding: 10, background: '#fff7e0', color: '#8a6d00', borderRadius: 8, fontSize: '.82rem', marginBottom: 8 }}>
          ⚙️ Meta neconectat: pune META_PAGE_ID + META_PAGE_TOKEN (și META_IG_USER_ID pentru Instagram) în Vercel — pasul 3a din GHID_AGENT_SEO_ACTIUNI.md (~30 min). Până atunci postările FB/IG vor eșua la publicare.
        </div>
      )}
      {meta && meta.facebook && !meta.instagram && (
        <div style={{ padding: 10, background: '#f0f6ff', color: 'var(--navy)', borderRadius: 8, fontSize: '.82rem', marginBottom: 8 }}>
          📘 Facebook conectat · 📸 Instagram nu încă (lipsește META_IG_USER_ID).
        </div>
      )}

      {warning && <div style={{ padding: 12, background: '#fff7e0', color: '#8a6d00', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {warning}</div>}
      {error && <div style={{ padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {error}</div>}
      {loading && posts.length === 0 && <div style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Se încarcă…</div>}

      {!loading && manual.length === 0 && upcoming.length === 0 && failed.length === 0 && !warning && (
        <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', padding: '8px 0' }}>
          Nimic programat. Rulează agentul SEO cu sarcina „📱 Postări social media" — propunerile lui apar întâi în coada de aprobare de mai sus.
        </div>
      )}

      {section(`✍️ De postat manual (${manual.length}) — TikTok / YouTube (clipurile create de agent vin gata făcute: descarcă + urcă)`, manual, (p) => (
        <>
          {btn(copiedId === p.id ? '✅ Copiat!' : '📋 Copiază textul', () => copyText(p.id, p.text_content))}
          {p.media_url && btn('🎬 Deschide media', () => window.open(p.media_url, '_blank'))}
          {btn('✅ Am postat-o', () => markPosted(p.id), { primary: true, disabled: busyId === p.id })}
          {btn('✖ Anulează', () => act(p.id, 'cancel'), { disabled: busyId === p.id })}
        </>
      ))}

      {section(`⏳ Programate (${upcoming.length})`, upcoming, (p) => (
        <>
          {btn(busyId === p.id ? '…' : '🚀 Publică acum', () => act(p.id, 'publish_now'), { primary: true, disabled: busyId === p.id })}
          {btn('✖ Anulează', () => act(p.id, 'cancel'), { disabled: busyId === p.id })}
        </>
      ))}

      {section(`⚠️ Eșuate (${failed.length})`, failed, (p) => (
        <>
          {btn(busyId === p.id ? '…' : '↻ Reîncearcă', () => act(p.id, 'retry'), { primary: true, disabled: busyId === p.id })}
          {btn('🚀 Publică acum', () => act(p.id, 'publish_now'), { disabled: busyId === p.id })}
          {btn('✖ Anulează', () => act(p.id, 'cancel'), { disabled: busyId === p.id })}
        </>
      ))}

      {history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowHistory((v) => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', padding: 0 }}>
            {showHistory ? '▾' : '▸'} Istoric ({history.length})
          </button>
          {showHistory && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {history.slice(0, 30).map((p) => card(p, null))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
