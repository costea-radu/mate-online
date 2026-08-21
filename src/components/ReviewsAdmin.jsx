// =====================================================================
// src/components/ReviewsAdmin.jsx — Admin → ⭐ Recenzii
//   • Rezumat: total recenzii, recenzii „site" în așteptare / publicate
//   • Coada de corecturi: testele din site cu media cea mai mică (cele cu
//     1–2 stele și comentarii sunt, de regulă, teste cu răspunsuri greșite)
//   • Lista recenziilor cu filtre (tip / stele / stare) și acțiuni:
//     Aprobă / Retrage (doar „site"), Șterge (oricare), Deschide testul
// Scrierile merg direct prin Supabase cu rolul authenticated al adminului:
// RLS + triggerul din supabase/reviews_schema.sql permit adminului să
// aprobe/șteargă orice recenzie. Montat în src/pages/Admin.jsx (tab „recenzii").
// =====================================================================
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { aiClient } from '../lib/aiClient';
import {
  adminListReviews, adminSetApproved, adminCounts, adminWorstTargets, deleteReview,
  formatAvg, TARGET_LABEL, ROLE_LABEL,
} from '../lib/reviews';
import { StarPicker } from './ReviewWidget';

const PAGE = 30;

function dateRo(d) {
  try { return new Date(d).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export default function ReviewsAdmin({ s }) {
  const [counts, setCounts] = useState({ total: 0, pending: 0, sitePublished: 0 });
  const [worst, setWorst] = useState([]);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [titles, setTitles] = useState({}); // `${type}:${id}` → { title, category }
  const [filters, setFilters] = useState({ targetType: '', maxStars: 0, status: '', targetId: null });
  const [refresh, setRefresh] = useState(0);

  // ─── Titlurile țintelor (teste din site + Biblioteca utilizatorilor) ─────────
  async function resolveTitles(list) {
    const need = list.filter((r) => r.target_id && !titles[`${r.target_type}:${r.target_id}`]);
    if (!need.length) return;
    const next = {};
    const contentIds = [...new Set(need.filter((r) => r.target_type === 'content').map((r) => r.target_id))];
    if (contentIds.length) {
      const { data } = await supabase.from('content').select('id, title, category, content_type').in('id', contentIds);
      (data || []).forEach((c) => { next[`content:${c.id}`] = { title: c.title, category: c.category, type: c.content_type }; });
    }
    const pubIds = new Set(need.filter((r) => r.target_type === 'public_item').map((r) => r.target_id));
    if (pubIds.size) {
      try {
        const { items: pub } = await aiClient.publicList({ limit: 100 });
        (pub || []).forEach((p) => { if (pubIds.has(p.id)) next[`public_item:${p.id}`] = { title: p.title, category: p.category }; });
      } catch { /* titlurile lipsă se afișează ca id */ }
    }
    if (Object.keys(next).length) setTitles((t) => ({ ...t, ...next }));
  }

  async function load(offset = 0) {
    setLoading(true); setError(null);
    try {
      const r = await adminListReviews({ ...filters, limit: PAGE, offset });
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
      setHasMore(r.hasMore);
      await resolveTitles(r.items);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(0); /* eslint-disable-next-line */ }, [filters, refresh]);
  useEffect(() => {
    adminCounts().then(setCounts);
    adminWorstTargets('content', 20).then(async (w) => {
      setWorst(w);
      await resolveTitles(w.map((x) => ({ target_type: 'content', target_id: x.targetId })));
    });
    // eslint-disable-next-line
  }, [refresh]);

  function titleOf(type, id) {
    const t = titles[`${type}:${id}`];
    if (t) return t.title;
    return id ? `${TARGET_LABEL[type] || type} · ${String(id).slice(0, 8)}…` : TARGET_LABEL[type] || type;
  }

  function openTarget(type, id) {
    if (type === 'content') window.open(`/exercitiu?id=${id}`, '_blank', 'noopener');
    else if (type === 'public_item') window.open(`/biblioteca-utilizatorilor?q=${encodeURIComponent(titles[`public_item:${id}`]?.title || '')}`, '_blank', 'noopener');
  }

  async function act(fn, msg) {
    setError(null); setOk(null);
    try { await fn(); setOk(msg); setRefresh((r) => r + 1); }
    catch (e) { setError(e.message); }
  }

  const chip = (bg, color) => ({ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: '.72rem', fontWeight: 700, background: bg, color, whiteSpace: 'nowrap' });
  const typeChip = (t) => t === 'site' ? chip('#e3f2fd', '#1565c0') : t === 'public_item' ? chip('#f3e5f5', '#6a1b9a') : chip('#e8f5e9', '#2e7d32');
  const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--navy)', fontWeight: 600, fontSize: '.82rem', fontFamily: 'var(--font-body)' };

  return (
    <>
      {/* Rezumat */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={s.statCard}><div style={s.statNum}>{counts.total}</div><div style={s.statLabel}>recenzii în total</div></div>
        <div style={{ ...s.statCard, borderLeft: counts.pending ? '4px solid var(--gold)' : undefined }}>
          <div style={s.statNum}>{counts.pending}</div><div style={s.statLabel}>recenzii de site în așteptare</div>
        </div>
        <div style={s.statCard}><div style={s.statNum}>{counts.sitePublished}</div><div style={s.statLabel}>recenzii de site publicate</div></div>
        <div style={s.statCard}><div style={s.statNum}>{worst.filter((w) => w.avg <= 2.5).length}</div><div style={s.statLabel}>teste cu media ≤ 2,5 (de verificat)</div></div>
      </div>

      {error && <div style={s.alert('error')}>⚠️ {error}</div>}
      {ok && <div style={s.alert('success')}>✓ {ok}</div>}

      {/* Coada de corecturi */}
      <div style={s.card}>
        <h3 style={s.cardTitle}>🛠 Coada de corecturi — testele cu notele cele mai slabe</h3>
        <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>
          Media notelor lăsate de elevi după rezolvare, de la cea mai mică. Un test cu 1–2 stele și comentarii de tipul
          „răspunsul de la 4 e greșit" e, de regulă, un test generat cu o eroare — deschide-l, verifică, corectează.
        </p>
        {worst.length === 0 ? (
          <div style={{ fontSize: '.88rem', color: 'var(--text-muted)' }}>Niciun test notat încă.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Test</th><th style={s.th}>Media</th><th style={s.th}>Note</th><th style={s.th}>Comentarii</th><th style={s.th}></th></tr></thead>
              <tbody>
                {worst.map((w) => (
                  <tr key={w.targetId} style={{ background: w.avg <= 2.5 ? '#fff8f8' : undefined }}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{titleOf('content', w.targetId)}</div>
                      {titles[`content:${w.targetId}`]?.category && <div style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>{titles[`content:${w.targetId}`].category}</div>}
                    </td>
                    <td style={s.td}><span style={{ fontWeight: 800, color: w.avg <= 2.5 ? '#c62828' : w.avg < 4 ? '#e65100' : '#2e7d32' }}>★ {formatAvg(w.avg)}</span></td>
                    <td style={s.td}>{w.n}</td>
                    <td style={s.td}>{w.nComentarii}</td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      <button style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: '.78rem', marginRight: 6 }} onClick={() => openTarget('content', w.targetId)}>🗗 Deschide</button>
                      <button style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: '.78rem' }}
                        onClick={() => { setFilters({ targetType: 'content', maxStars: 0, status: '', targetId: w.targetId }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                        Vezi recenziile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lista recenziilor */}
      <div style={s.card}>
        <h3 style={s.cardTitle}>⭐ Toate recenziile</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <select style={{ ...s.select, width: 'auto' }} value={filters.targetType}
            onChange={(e) => setFilters((f) => ({ ...f, targetType: e.target.value, targetId: null }))}>
            <option value="">Toate tipurile</option>
            <option value="site">Despre ExamenMate (site)</option>
            <option value="content">Teste din site</option>
            <option value="public_item">Biblioteca utilizatorilor</option>
          </select>
          <select style={{ ...s.select, width: 'auto' }} value={filters.maxStars}
            onChange={(e) => setFilters((f) => ({ ...f, maxStars: Number(e.target.value) }))}>
            <option value={0}>Toate notele</option>
            <option value={2}>≤ 2 stele (probleme)</option>
            <option value={3}>≤ 3 stele</option>
          </select>
          <select style={{ ...s.select, width: 'auto' }} value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Orice stare</option>
            <option value="pending">În așteptare (site)</option>
            <option value="approved">Publicate (site)</option>
          </select>
          {filters.targetId && (
            <span style={{ ...chip('rgba(232,185,49,.15)', 'var(--navy)'), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              doar: {titleOf(filters.targetType || 'content', filters.targetId)}
              <button style={{ ...linkBtn, fontSize: '.8rem' }} onClick={() => setFilters((f) => ({ ...f, targetId: null }))}>✕</button>
            </span>
          )}
          <button style={{ ...s.btnSecondary, marginLeft: 'auto' }} onClick={() => setRefresh((r) => r + 1)}>↻ Reîncarcă</button>
        </div>

        {loading && items.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
        ) : items.length === 0 ? (
          <div style={{ fontSize: '.88rem', color: 'var(--text-muted)' }}>Nicio recenzie pentru filtrele alese.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((r) => (
              <div key={r.id} style={{ border: '1.5px solid #eef0f4', borderRadius: 10, padding: '12px 14px', background: r.target_type === 'site' && !r.approved ? '#fffdf5' : '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={typeChip(r.target_type)}>{TARGET_LABEL[r.target_type] || r.target_type}</span>
                  <StarPicker value={r.stars} readOnly size={16} label={`${r.stars} din 5`} />
                  <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.88rem' }}>{r.author_name || 'Utilizator'}</span>
                  {ROLE_LABEL[r.author_role] && <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>{ROLE_LABEL[r.author_role]}</span>}
                  <span style={{ fontSize: '.74rem', color: '#aab0bb' }}>{dateRo(r.created_at)}</span>
                  {r.target_type === 'site' && (
                    <span style={r.approved ? chip('#e8f5e9', '#2e7d32') : chip('#fff3e0', '#e65100')}>
                      {r.approved ? '✓ publicată' : '⏳ în așteptare'}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.target_type === 'site' && (
                      <button style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: '.78rem', ...(r.approved ? {} : { background: 'var(--gold)', borderColor: 'var(--gold)', color: 'var(--navy-dark)' }) }}
                        onClick={() => act(() => adminSetApproved(r.id, !r.approved), r.approved ? 'Recenzia a fost retrasă de pe site.' : 'Recenzia a fost publicată.')}>
                        {r.approved ? 'Retrage' : '✓ Aprobă'}
                      </button>
                    )}
                    {r.target_id && (
                      <button style={{ ...s.btnSecondary, padding: '5px 12px', fontSize: '.78rem' }} onClick={() => openTarget(r.target_type, r.target_id)}>🗗 Deschide</button>
                    )}
                    <button style={s.btnDanger} onClick={() => { if (window.confirm('Ștergi definitiv această recenzie?')) act(() => deleteReview(r.id), 'Recenzia a fost ștearsă.'); }}>🗑 Șterge</button>
                  </span>
                </div>
                {r.target_id && (
                  <div style={{ fontSize: '.8rem', color: 'var(--text-light)', marginTop: 6 }}>
                    Test: <button style={linkBtn} onClick={() => setFilters({ targetType: r.target_type, maxStars: 0, status: '', targetId: r.target_id })}>{titleOf(r.target_type, r.target_id)}</button>
                  </div>
                )}
                {r.body
                  ? <p style={{ marginTop: 8, fontSize: '.9rem', color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.body}</p>
                  : <div style={{ marginTop: 6, fontSize: '.78rem', color: 'var(--text-muted)' }}>(fără comentariu)</div>}
              </div>
            ))}
            {hasMore && (
              <button style={{ ...s.btnSecondary, alignSelf: 'center' }} disabled={loading} onClick={() => load(items.length)}>
                {loading ? 'Se încarcă…' : 'Încarcă mai multe'}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
