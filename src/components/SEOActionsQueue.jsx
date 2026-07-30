// =====================================================================
// src/components/SEOActionsQueue.jsx — COADA DE APROBARE a agentului SEO
// (Faza 1e din GHID_AGENT_SEO_ACTIUNI.md). Se montează în AIAdminPanel,
// sub agentul SEO.
//
// Afișează propunerile agentului (tip + explicația lui + DIFF vechi→nou),
// cu butoane „Aprobă & execută" / „Respinge", plus istoricul cu rezultate
// și „Anulează" (revert) pentru acțiunile executate (meta/redenumiri).
// =====================================================================
import { useState, useEffect, useCallback } from 'react';
import { aiClient } from '../lib/aiClient';

const TYPE_INFO = {
  set_page_meta:   { icon: '🏷️', label: 'Meta pagină' },
  rename_material: { icon: '✏️', label: 'Redenumire material' },
  submit_sitemap:  { icon: '🗺️', label: 'Retrimitere sitemap' },
  publish_article: { icon: '📰', label: 'Publicare articol' },
  update_article:  { icon: '🔄', label: 'Actualizare articol' },
  schedule_social: { icon: '📱', label: 'Postare social media' },
  yt_update_video: { icon: '▶️', label: 'Metadate YouTube' },
  create_video:    { icon: '🎬', label: 'Videoclip nou' },
};

const SCENE_LABELS = { intro: 'Intro', lista: 'Listă', imagine: 'Imagine', statistica: 'Statistică', final: 'Final (CTA)' };

// Câmpurile editabile ale unei propuneri (formularul „✏️ Editează").
// Serverul re-validează totul (seo.editActionPayload) — aici doar UI.
function editableFields(a) {
  const p = a.payload || {};
  if (a.type === 'schedule_social') {
    return [{ key: 'text', label: 'Textul postării', kind: 'textarea', value: p.text || '' }];
  }
  if (a.type === 'create_video') {
    // clip youtube/tiktok = AMBELE cozi (YouTube + TikTok) dintr-o propunere
    const dual = !!p.dual || p.platform === 'tiktok';
    const f = [];
    if (p.platform === 'youtube' || dual) f.push({ key: 'title', label: 'Titlul clipului (YouTube)', kind: 'input', value: p.title || '' });
    f.push({ key: 'text', label: p.platform === 'youtube' ? 'Descrierea clipului (YouTube)' : dual ? 'Captionul postării (TikTok)' : 'Captionul postării', kind: 'textarea', value: p.text || '' });
    if (dual && p.platform === 'youtube') f.push({ key: 'tiktok_text', label: 'Captionul TikTok', kind: 'textarea', value: p.tiktok_text || '' });
    if (p.platform === 'youtube' || dual) f.push({ key: 'tags', label: 'Taguri YouTube (separate prin virgulă)', kind: 'input', value: (p.tags || []).join(', '), isTags: true });
    return f;
  }
  if (a.type === 'yt_update_video') {
    const ch = p.changes || {};
    const f = [];
    if (ch.title) f.push({ key: 'title', label: 'Titlu', kind: 'input', value: ch.title.new || '' });
    if (ch.tags) f.push({ key: 'tags', label: 'Taguri (separate prin virgulă)', kind: 'input', value: (ch.tags.new || []).join(', '), isTags: true });
    if (ch.description) f.push({ key: 'description', label: 'Descriere', kind: 'textarea', tall: true, value: ch.description.new || '' });
    return f;
  }
  if (a.type === 'publish_article') {
    return [
      { key: 'title', label: 'Titlu', kind: 'input', value: p.title || '' },
      { key: 'description', label: 'Descriere (meta + card)', kind: 'textarea', value: p.description || '' },
      { key: 'content_md', label: 'Conținutul articolului (Markdown)', kind: 'textarea', tall: true, value: p.content_md || '' },
    ];
  }
  if (a.type === 'update_article') {
    const ch = p.changes || {};
    const f = [];
    if (ch.title) f.push({ key: 'title', label: 'Titlu nou', kind: 'input', value: ch.title.new || '' });
    if (ch.description) f.push({ key: 'description', label: 'Descriere nouă', kind: 'textarea', value: ch.description.new || '' });
    if (ch.content_md) f.push({ key: 'content_md', label: 'Conținutul nou (Markdown)', kind: 'textarea', tall: true, value: ch.content_md.new || '' });
    return f;
  }
  return [];
}

const KIND_LABELS = { articol: '📖 Articol', rezolvare: '✍️ Rezolvare scrisă', explicatie: '💡 Explicație' };

const PLATFORM_LABELS = { facebook: '📘 Facebook', instagram: '📸 Instagram', tiktok: '🎵 TikTok', youtube: '▶️ YouTube' };

const STATUS_INFO = {
  proposed: { label: 'în așteptare', bg: '#fff7e0', fg: '#8a6d00' },
  executed: { label: 'executată',    bg: '#e6f6ea', fg: '#1e7e34' },
  rejected: { label: 'respinsă',     bg: '#f0f1f4', fg: '#5a6379' },
  failed:   { label: 'eșuată',       bg: '#fdecea', fg: '#b71c1c' },
  reverted: { label: 'anulată',      bg: '#fff0e6', fg: '#b25a00' },
  approved: { label: 'aprobată',     bg: '#e8f0fe', fg: '#1a4fb8' },
};

function Diff({ label, oldVal, newVal }) {
  if (!newVal && !oldVal) return null;
  const changed = oldVal && newVal && oldVal !== newVal;
  return (
    <div style={{ margin: '6px 0', fontSize: '.83rem', lineHeight: 1.5 }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</span>
      {changed || (oldVal && !newVal) ? (
        <div style={{ color: '#a33', textDecoration: 'line-through', opacity: 0.8, wordBreak: 'break-word' }}>{oldVal}</div>
      ) : null}
      {newVal ? (
        <div style={{ color: '#1e7e34', fontWeight: 600, wordBreak: 'break-word' }}>{newVal}</div>
      ) : null}
    </div>
  );
}

function PayloadView({ action }) {
  const p = action.payload || {};
  if (action.type === 'set_page_meta') {
    return (
      <div>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)' }}>
          Ruta: <code style={{ background: '#eef2f8', padding: '1px 6px', borderRadius: 5 }}>{p.route}</code>
        </div>
        <Diff label={`Title (${(p.title || '').length} car.)`} oldVal={p.old?.title} newVal={p.title} />
        <Diff label={`Description (${(p.description || '').length} car.)`} oldVal={p.old?.description} newVal={p.description} />
        {p.og_image && <Diff label="Imagine share (og:image)" oldVal={p.old?.og_image} newVal={p.og_image} />}
        {p.jsonld && (
          <details style={{ fontSize: '.78rem', marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-light)' }}>Date structurate (JSON-LD: {p.jsonld['@type'] || 'obiect'})</summary>
            <pre style={{ background: '#f7f9fc', padding: 8, borderRadius: 6, overflowX: 'auto', maxHeight: 180 }}>{JSON.stringify(p.jsonld, null, 2)}</pre>
          </details>
        )}
      </div>
    );
  }
  if (action.type === 'rename_material') {
    return (
      <div>
        <div style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>Tabel: {p.table} · id: {String(p.id).slice(0, 8)}…</div>
        <Diff label="Titlu" oldVal={p.old_title} newVal={p.new_title} />
        {p.new_description && <Diff label="Descriere" oldVal={p.old_description} newVal={p.new_description} />}
      </div>
    );
  }
  if (action.type === 'submit_sitemap') {
    return <div style={{ fontSize: '.85rem' }}>Trimite <code>{p.sitemap}</code> către Google Search Console.</div>;
  }
  if (action.type === 'publish_article') {
    const words = String(p.content_md || '').split(/\s+/).filter(Boolean).length;
    return (
      <div>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
          {KIND_LABELS[p.kind] || p.kind} · <code style={{ background: '#eef2f8', padding: '1px 6px', borderRadius: 5 }}>/rezolvari/{p.slug}</code>
          {p.category && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {p.category}</span>}
        </div>
        <Diff label="Titlu (H1 + title)" oldVal={null} newVal={p.title} />
        <Diff label={`Descriere (${(p.description || '').length} car.)`} oldVal={null} newVal={p.description} />
        {Array.isArray(p.keywords) && p.keywords.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0' }}>
            {p.keywords.map((k, i) => (
              <span key={i} style={{ fontSize: '.7rem', background: '#eef2f8', color: 'var(--navy)', borderRadius: 20, padding: '2px 9px' }}>{k}</span>
            ))}
          </div>
        )}
        {Array.isArray(p.sources) && p.sources.length > 0 && (
          <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', margin: '4px 0' }}>
            📚 Bazat pe: {p.sources.map((s) => s.title).filter(Boolean).join(' · ')}
          </div>
        )}
        <details style={{ fontSize: '.8rem', marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 600 }}>
            📄 Conținutul complet ({words} cuvinte, {(p.content_md || '').length} caractere) — apasă pentru preview
          </summary>
          {p.content_html ? (
            <div style={{ background: '#fff', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 6, marginTop: 6, maxHeight: 380, overflowY: 'auto' }}
              dangerouslySetInnerHTML={{ __html: p.content_html }} />
          ) : (
            <pre style={{ background: '#f7f9fc', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 380, overflowY: 'auto', marginTop: 6 }}>{p.content_md}</pre>
          )}
        </details>
        <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
          Gratuit & indexabil. La aprobare: publicare imediată + sitemap retrimis către Google. Se poate retrage oricând (revine în draft).
        </div>
      </div>
    );
  }
  if (action.type === 'update_article') {
    const ch = p.changes || {};
    const simple = ['title', 'description', 'category', 'kind'];
    return (
      <div>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
          <code style={{ background: '#eef2f8', padding: '1px 6px', borderRadius: 5 }}>/rezolvari/{p.slug}</code>
          {p.publish && <span style={{ marginLeft: 8, fontSize: '.7rem', background: '#e6f6ea', color: '#1e7e34', borderRadius: 20, padding: '2px 10px', fontWeight: 700 }}>republicare (din draft)</span>}
        </div>
        {simple.map((f) => ch[f] && <Diff key={f} label={f} oldVal={String(ch[f].old ?? '')} newVal={String(ch[f].new ?? '')} />)}
        {ch.keywords && <Diff label="Cuvinte cheie" oldVal={(ch.keywords.old || []).join(', ')} newVal={(ch.keywords.new || []).join(', ')} />}
        {ch.sources && <Diff label="Materiale-sursă" oldVal={(ch.sources.old || []).map((s) => s.title || s.id).join(' · ')} newVal={(ch.sources.new || []).map((s) => s.title || s.id).join(' · ')} />}
        {ch.content_md && (
          <details style={{ fontSize: '.8rem', marginTop: 6 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 600 }}>
              📄 Conținut nou ({String(ch.content_md.new || '').length} caractere, înainte {String(ch.content_md.old || '').length}) — preview
            </summary>
            {p.content_html ? (
              <div style={{ background: '#fff', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 6, marginTop: 6, maxHeight: 380, overflowY: 'auto' }}
                dangerouslySetInnerHTML={{ __html: p.content_html }} />
            ) : (
              <pre style={{ background: '#f7f9fc', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 380, overflowY: 'auto', marginTop: 6 }}>{ch.content_md.new}</pre>
            )}
          </details>
        )}
      </div>
    );
  }
  if (action.type === 'schedule_social') {
    const when = p.scheduled_at
      ? new Date(p.scheduled_at).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })
      : 'cât mai curând după aprobare';
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6, fontSize: '.85rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{PLATFORM_LABELS[p.platform] || p.platform}</span>
          <span style={{ fontSize: '.72rem', background: p.auto ? '#e6f6ea' : '#fff7e0', color: p.auto ? '#1e7e34' : '#8a6d00', borderRadius: 20, padding: '2px 10px', fontWeight: 700 }}>
            {p.auto ? 'publicare automată' : 'coada manuală (copy-paste)'}
          </span>
          <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>⏰ {when}</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {p.media_url && (
            <a href={p.media_url} target="_blank" rel="noopener noreferrer" title="Deschide imaginea generată">
              <img src={p.media_url} alt="" style={{ width: 130, height: 130, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </a>
          )}
          <pre style={{ flex: 1, minWidth: 220, whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, fontSize: '.84rem', lineHeight: 1.5, background: '#f7f9fc', borderRadius: 8, padding: '8px 10px', maxHeight: 220, overflowY: 'auto' }}>{p.text}</pre>
        </div>
        {p.image && (
          <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
            🖼 Card generat: șablonul „{p.image.template}" — {p.image.title}{p.image.badge ? ` · insignă: ${p.image.badge}` : ''}
          </div>
        )}
        {p.utm_link && (
          <div style={{ fontSize: '.75rem', marginTop: 4, wordBreak: 'break-all' }}>
            🔗 <a href={p.utm_link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)' }}>{p.utm_link}</a>
            <span style={{ color: 'var(--text-muted)' }}> (UTM aplicat automat — campania „{p.campaign}")</span>
          </div>
        )}
        <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
          {p.auto
            ? 'La aprobare intră în „Calendar social" și se publică automat la ora programată (cron la 15 min). Se poate anula până la publicare.'
            : 'La aprobare intră în lista „De postat manual" din „Calendar social" — o copiezi în aplicație în ~1 minut.'}
          {p.meta_configurat === false && ' ⚠️ Meta neconectat încă (META_PAGE_ID/TOKEN) — configurează pasul 3a înainte de ora publicării.'}
        </div>
      </div>
    );
  }
  if (action.type === 'create_video') {
    const when = p.scheduled_at
      ? new Date(p.scheduled_at).toLocaleString('ro-RO', { dateStyle: 'medium', timeStyle: 'short' })
      : 'cât mai curând după aprobare';
    // clip youtube/tiktok = intră în AMBELE cozi manuale dintr-o propunere
    const dualVideo = !!p.dual || (!p.auto && (p.platform === 'youtube' || p.platform === 'tiktok'));
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6, fontSize: '.85rem' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>
            {dualVideo ? `${PLATFORM_LABELS.youtube} + ${PLATFORM_LABELS.tiktok}` : (PLATFORM_LABELS[p.platform] || p.platform)}
          </span>
          <span style={{ fontSize: '.72rem', background: p.auto ? '#e6f6ea' : '#fff7e0', color: p.auto ? '#1e7e34' : '#8a6d00', borderRadius: 20, padding: '2px 10px', fontWeight: 700 }}>
            {p.auto ? `publicare automată · ⏰ ${when}` : dualVideo ? 'ambele cozi manuale (download + upload)' : 'coada manuală (download + upload)'}
          </span>
          <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>🎬 {p.format} · {(p.scenes || []).length} scene · ~{p.seconds}s</span>
        </div>
        {p.title && <Diff label={`Titlu YouTube (${String(p.title).length} car.)`} oldVal={null} newVal={p.title} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0' }}>
          {(p.scenes || []).map((sc, i) => (
            <div key={i} style={{ fontSize: '.8rem', background: '#f7f9fc', borderRadius: 8, padding: '6px 10px' }}>
              <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{i + 1}. {SCENE_LABELS[sc.template] || sc.template}</span>
              <span style={{ color: 'var(--text-muted)' }}> · {sc.seconds}s</span>
              {sc.title ? <span> — {sc.title}</span> : null}
              {sc.subtitle ? <div style={{ color: 'var(--text-light)', fontSize: '.75rem' }}>{sc.subtitle}</div> : null}
              {Array.isArray(sc.bullets) && sc.bullets.length > 0 && (
                <div style={{ color: 'var(--text-light)', fontSize: '.75rem' }}>• {sc.bullets.join(' • ')}</div>
              )}
              {sc.image_url && (
                <div style={{ fontSize: '.72rem', wordBreak: 'break-all' }}>
                  🖼 <a href={sc.image_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)' }}>{sc.image_url}</a>
                </div>
              )}
            </div>
          ))}
        </div>
        <details style={{ fontSize: '.8rem', marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 600 }}>
            📄 {p.platform === 'youtube' ? 'Descrierea clipului (YouTube)' : dualVideo ? 'Captionul postării (TikTok)' : 'Captionul postării'} ({String(p.text || '').length} caractere)
          </summary>
          <pre style={{ background: '#f7f9fc', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>{p.text}</pre>
        </details>
        {dualVideo && p.platform === 'youtube' && p.tiktok_text && (
          <details style={{ fontSize: '.8rem', marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 600 }}>
              🎵 Captionul TikTok ({String(p.tiktok_text).length} caractere{p.tiktok_text === p.text ? ' — identic cu descrierea' : ''})
            </summary>
            <pre style={{ background: '#f7f9fc', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>{p.tiktok_text}</pre>
          </details>
        )}
        {Array.isArray(p.tags) && p.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0' }}>
            {p.tags.map((k, i) => <span key={i} style={{ fontSize: '.7rem', background: '#eef2f8', color: 'var(--navy)', borderRadius: 20, padding: '2px 9px' }}>{k}</span>)}
          </div>
        )}
        {p.utm_link && (
          <div style={{ fontSize: '.75rem', marginTop: 4, wordBreak: 'break-all' }}>
            🔗 <a href={p.utm_link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)' }}>{p.utm_link}</a>
          </div>
        )}
        <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
          Clipul se RANDEAZĂ la aprobare (30–90s) — slide-uri branded ExamenMate, MP4 {p.format === 'orizontal' ? '1920×1080' : '1080×1920'}, fără voce.
          {p.auto
            ? ' Apoi intră în „Calendar social" și se publică automat.'
            : dualVideo
              ? ' Apoi apare gata făcut în „Calendar social" → De postat manual, pe AMBELE platforme: YouTube și TikTok (îl descarci o dată + urci în câte ~2 min; API-urile lor cer audit pentru publicare directă).'
              : ' Apoi apare gata făcut în „Calendar social" → De postat manual (îl descarci + urci în ~2 min; API-ul platformei cere audit pentru publicare directă).'}
          {p.meta_configurat === false && ' ⚠️ Meta neconectat încă (META_PAGE_ID/TOKEN).'}
        </div>
      </div>
    );
  }
  if (action.type === 'yt_update_video') {
    const ch = p.changes || {};
    return (
      <div>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
          ▶️ {p.video_title || p.id}
          {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, fontWeight: 400, fontSize: '.78rem', color: 'var(--navy)' }}>deschide clipul ↗</a>}
          {p.stats && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: '.75rem' }}>👁 {p.stats.views} · ❤ {p.stats.likes}</span>}
        </div>
        {ch.title && <Diff label={`Titlu (${String(ch.title.new || '').length} car.)`} oldVal={ch.title.old} newVal={ch.title.new} />}
        {ch.tags && <Diff label={`Taguri (${(ch.tags.new || []).length})`} oldVal={(ch.tags.old || []).join(', ') || '(fără)'} newVal={(ch.tags.new || []).join(', ')} />}
        {ch.description && (
          <details style={{ fontSize: '.8rem', marginTop: 6 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 600 }}>
              📄 Descrierea nouă ({String(ch.description.new || '').length} caractere, înainte {String(ch.description.old || '').length}) — preview
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8, marginTop: 6 }}>
              <pre style={{ background: '#fdf2f0', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', margin: 0, fontSize: '.76rem' }}>{ch.description.old || '(goală)'}</pre>
              <pre style={{ background: '#eef8f0', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', margin: 0, fontSize: '.76rem' }}>{ch.description.new}</pre>
            </div>
          </details>
        )}
        <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
          La aprobare se aplică imediat pe YouTube. Reversibil: valorile vechi sunt păstrate în propunere.
        </div>
      </div>
    );
  }
  return <pre style={{ fontSize: '.75rem', background: '#f7f9fc', padding: 8, borderRadius: 6, overflowX: 'auto', maxHeight: 160 }}>{JSON.stringify(p, null, 2)}</pre>;
}

export default function SEOActionsQueue({ box }) {
  const [actions, setActions] = useState([]);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [editId, setEditId] = useState(null);     // propunerea în curs de editare
  const [editForm, setEditForm] = useState({});   // valorile din formular

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await aiClient.seoActions({ action: 'list' });
      setActions(r.actions || []);
      setWarning(r.warning || null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    // agentul SEO din panoul de mai sus anunță când a creat propuneri noi
    const onUpdate = () => load();
    window.addEventListener('seo-actions-updated', onUpdate);
    return () => window.removeEventListener('seo-actions-updated', onUpdate);
  }, [load]);

  function startEdit(a) {
    const fields = editableFields(a);
    setEditForm(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    setEditId(a.id);
  }

  async function saveEdit(a) {
    const fields = editableFields(a);
    const patch = {};
    for (const f of fields) {
      const v = editForm[f.key];
      if (v == null || String(v) === String(f.value)) continue; // doar ce s-a schimbat
      patch[f.key] = f.isTags ? String(v).split(',').map((t) => t.trim()).filter(Boolean) : v;
    }
    if (!Object.keys(patch).length) { setEditId(null); return; }
    setBusyId(a.id); setError(null);
    try {
      await aiClient.seoActions({ action: 'update', id: a.id, patch });
      setEditId(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  async function decide(id, verb) {
    const labels = { approve: 'Aprobi și EXECUȚI această acțiune?', reject: 'Respingi această propunere?', revert: 'Anulezi această acțiune (revii la valorile vechi)?' };
    if (!window.confirm(labels[verb])) return;
    setBusyId(id); setError(null);
    try {
      await aiClient.seoActions({ action: verb, id });
      await load();
      // postările sociale aprobate/anulate apar în panoul „Calendar social"
      window.dispatchEvent(new CustomEvent('social-posts-updated'));
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  const pending = actions.filter((a) => a.status === 'proposed');
  const history = actions.filter((a) => a.status !== 'proposed');

  const card = (a, isPending) => {
    const t = TYPE_INFO[a.type] || { icon: '⚙️', label: a.type };
    const s = STATUS_INFO[a.status] || { label: a.status, bg: '#f0f1f4', fg: '#5a6379' };
    const canRevert = a.status === 'executed'
      && (a.type === 'set_page_meta' || a.type === 'rename_material' || a.type === 'publish_article' || a.type === 'update_article' || a.type === 'schedule_social' || a.type === 'yt_update_video' || a.type === 'create_video');
    const revertLabel = a.type === 'publish_article' ? '↩️ Retrage articolul (înapoi în draft)'
      : a.type === 'schedule_social' ? '↩️ Anulează postarea'
      : a.type === 'create_video' ? '↩️ Anulează clipul'
      : '↩️ Anulează (valorile vechi)';
    const canEdit = isPending && editableFields(a).length > 0;
    return (
      <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: isPending ? '#fffdf5' : '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem' }}>{t.icon} {t.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '.7rem', background: s.bg, color: s.fg, borderRadius: 20, padding: '2px 10px', fontWeight: 700 }}>{s.label}</span>
            <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{new Date(a.created_at).toLocaleString('ro-RO')}</span>
          </div>
        </div>
        {a.note && (
          <div style={{ fontSize: '.82rem', color: 'var(--text)', background: '#f0f6ff', borderRadius: 8, padding: '7px 10px', marginBottom: 8 }}>
            💬 <em>{a.note}</em>
          </div>
        )}
        {editId === a.id ? (
          <div style={{ border: '1px dashed var(--navy)', background: '#fbfcfe', borderRadius: 10, padding: '10px 12px', margin: '4px 0' }}>
            <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>✏️ Editezi propunerea — serverul re-validează totul la salvare</div>
            {editableFields(a).map((f) => (
              <label key={f.key} style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ display: 'block', fontSize: '.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3 }}>{f.label}</span>
                {f.kind === 'textarea' ? (
                  <textarea value={editForm[f.key] ?? ''} onChange={(e) => setEditForm((v) => ({ ...v, [f.key]: e.target.value }))}
                    rows={f.tall ? 14 : 5}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '.84rem', fontFamily: f.tall ? 'ui-monospace, monospace' : 'inherit', lineHeight: 1.5 }} />
                ) : (
                  <input value={editForm[f.key] ?? ''} onChange={(e) => setEditForm((v) => ({ ...v, [f.key]: e.target.value }))}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '.86rem' }} />
                )}
              </label>
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={busyId === a.id} onClick={() => saveEdit(a)} style={{ fontSize: '.8rem', padding: '6px 13px' }}>
                {busyId === a.id ? '…' : '💾 Salvează modificările'}
              </button>
              <button className="btn btn-outline" disabled={busyId === a.id} onClick={() => setEditId(null)} style={{ fontSize: '.8rem', padding: '6px 13px' }}>
                Renunță
              </button>
            </div>
          </div>
        ) : (
          <PayloadView action={a} />
        )}
        {a.result && a.status !== 'proposed' && (
          <div style={{ fontSize: '.75rem', color: a.status === 'failed' ? '#b71c1c' : 'var(--text-muted)', marginTop: 6 }}>
            Rezultat: {typeof a.result === 'object' ? (a.result.error || JSON.stringify(a.result)) : String(a.result)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {isPending && editId !== a.id && (
            <>
              <button className="btn btn-primary" disabled={busyId === a.id} onClick={() => decide(a.id, 'approve')} style={{ fontSize: '.82rem', padding: '7px 14px' }}>
                {busyId === a.id ? '…' : '✅ Aprobă & execută'}
              </button>
              {canEdit && (
                <button className="btn btn-outline" disabled={busyId === a.id} onClick={() => startEdit(a)} style={{ fontSize: '.82rem', padding: '7px 14px' }}>
                  ✏️ Editează
                </button>
              )}
              <button className="btn btn-outline" disabled={busyId === a.id} onClick={() => decide(a.id, 'reject')} style={{ fontSize: '.82rem', padding: '7px 14px' }}>
                ❌ Respinge
              </button>
            </>
          )}
          {a.status === 'failed' && (
            <button className="btn btn-primary" disabled={busyId === a.id} onClick={() => decide(a.id, 'approve')} style={{ fontSize: '.82rem', padding: '7px 14px' }}>
              {busyId === a.id ? '…' : '🔁 Reîncearcă execuția'}
            </button>
          )}
          {canRevert && (
            <button className="btn btn-outline" disabled={busyId === a.id} onClick={() => decide(a.id, 'revert')} style={{ fontSize: '.78rem', padding: '6px 12px' }}>
              {revertLabel}
            </button>
          )}
          {a.status === 'executed' && a.type === 'create_video' && (a.result || {}).video && (
            <a className="btn btn-outline" href={a.result.video} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.78rem', padding: '6px 12px' }}>
              🎬 Deschide clipul (MP4)
            </a>
          )}
          {a.status === 'executed' && a.type === 'yt_update_video' && (a.payload || {}).url && (
            <a className="btn btn-outline" href={a.payload.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.78rem', padding: '6px 12px' }}>
              ▶️ Deschide clipul
            </a>
          )}
          {a.status === 'executed' && (a.type === 'publish_article' || a.type === 'update_article') && (
            <a className="btn btn-outline" href={(a.payload || {}).url || `/rezolvari/${(a.payload || {}).slug || ''}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.78rem', padding: '6px 12px' }}>
              🔗 Deschide articolul
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
          ✅ Coada de aprobare — acțiunile agentului SEO
          {pending.length > 0 && (
            <span style={{ marginLeft: 8, fontSize: '.75rem', background: '#e8b931', color: '#17233f', borderRadius: 20, padding: '2px 10px', verticalAlign: 'middle' }}>
              {pending.length} în așteptare
            </span>
          )}
        </h3>
        <button className="btn btn-outline" onClick={load} disabled={loading} style={{ fontSize: '.78rem', padding: '5px 12px' }}>↻ Reîmprospătează</button>
      </div>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
        Nimic nu se aplică fără OK-ul tău: agentul doar propune (meta, redenumiri, articole pentru pagina „Blog / Rezolvări / Teorie", sitemap, postări social media, metadate YouTube, videoclipuri), iar tu aprobi, editezi textele („✏️ Editează") sau respingi.
        Modificările aprobate sunt live în max. 5 minute, fără deploy; acțiunile executate se pot anula (articolele revin în draft, postările programate se retrag din calendar).
      </p>

      {warning && <div style={{ padding: 12, background: '#fff7e0', color: '#8a6d00', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {warning}</div>}
      {error && <div style={{ padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {error}</div>}
      {loading && actions.length === 0 && <div style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Se încarcă…</div>}

      {!loading && pending.length === 0 && !warning && (
        <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', padding: '10px 0' }}>
          Nicio propunere în așteptare. Rulează agentul SEO de mai sus (ex. „Performanță Google") sau așteaptă rularea automată de luni dimineața.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pending.map((a) => card(a, true))}
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowHistory((v) => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', padding: 0 }}>
            {showHistory ? '▾' : '▸'} Istoric ({history.length})
          </button>
          {showHistory && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {history.slice(0, 30).map((a) => card(a, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
