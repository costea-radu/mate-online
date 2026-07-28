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
  schedule_social: { icon: '📱', label: 'Postare social (Faza 3)' },
};

const KIND_LABELS = { articol: '📖 Articol', rezolvare: '✍️ Rezolvare scrisă', explicatie: '💡 Explicație' };

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
  return <pre style={{ fontSize: '.75rem', background: '#f7f9fc', padding: 8, borderRadius: 6, overflowX: 'auto', maxHeight: 160 }}>{JSON.stringify(p, null, 2)}</pre>;
}

export default function SEOActionsQueue({ box }) {
  const [actions, setActions] = useState([]);
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

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

  async function decide(id, verb) {
    const labels = { approve: 'Aprobi și EXECUȚI această acțiune?', reject: 'Respingi această propunere?', revert: 'Anulezi această acțiune (revii la valorile vechi)?' };
    if (!window.confirm(labels[verb])) return;
    setBusyId(id); setError(null);
    try {
      await aiClient.seoActions({ action: verb, id });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  const pending = actions.filter((a) => a.status === 'proposed');
  const history = actions.filter((a) => a.status !== 'proposed');

  const card = (a, isPending) => {
    const t = TYPE_INFO[a.type] || { icon: '⚙️', label: a.type };
    const s = STATUS_INFO[a.status] || { label: a.status, bg: '#f0f1f4', fg: '#5a6379' };
    const canRevert = a.status === 'executed'
      && (a.type === 'set_page_meta' || a.type === 'rename_material' || a.type === 'publish_article' || a.type === 'update_article');
    const revertLabel = a.type === 'publish_article' ? '↩️ Retrage articolul (înapoi în draft)' : '↩️ Anulează (valorile vechi)';
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
        <PayloadView action={a} />
        {a.result && a.status !== 'proposed' && (
          <div style={{ fontSize: '.75rem', color: a.status === 'failed' ? '#b71c1c' : 'var(--text-muted)', marginTop: 6 }}>
            Rezultat: {typeof a.result === 'object' ? (a.result.error || JSON.stringify(a.result)) : String(a.result)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {isPending && (
            <>
              <button className="btn btn-primary" disabled={busyId === a.id} onClick={() => decide(a.id, 'approve')} style={{ fontSize: '.82rem', padding: '7px 14px' }}>
                {busyId === a.id ? '…' : '✅ Aprobă & execută'}
              </button>
              <button className="btn btn-outline" disabled={busyId === a.id} onClick={() => decide(a.id, 'reject')} style={{ fontSize: '.82rem', padding: '7px 14px' }}>
                ❌ Respinge
              </button>
            </>
          )}
          {canRevert && (
            <button className="btn btn-outline" disabled={busyId === a.id} onClick={() => decide(a.id, 'revert')} style={{ fontSize: '.78rem', padding: '6px 12px' }}>
              {revertLabel}
            </button>
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
        Nimic nu se aplică fără OK-ul tău: agentul doar propune (meta, redenumiri, articole pentru pagina „Blog / Rezolvări / Teorie", sitemap), tu aprobi sau respingi.
        Modificările aprobate sunt live în max. 5 minute, fără deploy; acțiunile executate se pot anula (articolele revin în draft).
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
