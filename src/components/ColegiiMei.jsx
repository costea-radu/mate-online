// =====================================================================
// src/components/ColegiiMei.jsx — „👥 Colegii mei" (pe tot site-ul)
//
// Ca la Facebook: cauți pe ORICINE, pe CATEGORII, în funcție de rolul tău —
//   profesor → colegi profesori · elevi · părinți
//   elev     → colegi de clasă  · profesori · părinți
//   părinte  → alți părinți     · profesori · elevi
// îi trimiți cerere, iar după ACCEPTARE puteți discuta 1-la-1 oricând, din
// Mesagerie — indiferent de grupă.
//
// Se montează în „Contul meu", sub cartonașul cu numele și tipul contului:
//   • pe desktop — o fereastră cu câteva nume vizibile și derulare pentru rest;
//   • pe mobil   — același conținut, ca tab cu rolldown.
// =====================================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';

const ROLE_ICON = { profesor: '🧑‍🏫', elev: '🎓', parinte: '👨‍👩‍👧' };

// Ecran îngust? (pentru rolldown-ul de mobil)
export function useIsMobile(breakpoint = 768) {
  const [is, setIs] = useState(() => {
    try { return window.matchMedia(`(max-width: ${breakpoint}px)`).matches; }
    catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(`(max-width: ${breakpoint}px)`); } catch { return undefined; }
    const on = (e) => setIs(e.matches);
    setIs(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else mq.removeListener(on);
    };
  }, [breakpoint]);
  return is;
}

// `wide` — panoul are loc (conversația din /mesagerie e închisă cu „✕"):
// numele se văd întregi, lista e mai înaltă, iar căutarea pornește deschisă.
export default function ColegiiMei({ defaultOpen = false, wide = false }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [data, setData] = useState(null);      // { colegi, incoming, outgoing, role, discoverable }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(wide);
  const [cat, setCat] = useState(null);        // categoria în care caut ('elev' | 'profesor' | 'parinte')

  // panoul lățit deschide singur căutarea (are loc s-o arate)
  useEffect(() => { if (wide) setShowSearch(true); }, [wide]);

  const load = useCallback(async () => {
    try {
      const r = await aiClient.colegiList();
      setData(r);
      // prima categorie = oamenii ca mine („colegii"), ca până acum
      setCat((c) => c || r.categories?.[0]?.key || r.role || null);
    } catch (e) { setError(e.message); setData({ colegi: [], incoming: [], outgoing: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const doSearch = useCallback(async (e, rol = null) => {
    e?.preventDefault?.();
    const needle = q.trim();
    if (needle.length < 3) { setFound([]); return; }
    setSearching(true); setError(null);
    try { const r = await aiClient.colegiSearch({ q: needle, role: rol || cat }); setFound(r.items || []); }
    catch (e2) { setError(e2.message); setFound([]); }
    finally { setSearching(false); }
  }, [q, cat]);

  // Schimbi categoria cu numele deja scris → căutăm din nou, în ea.
  function alegeCategoria(key) {
    setCat(key);
    setFound(null);
    if (q.trim().length >= 3) doSearch(null, key);
  }

  async function add(id) {
    setBusy(id); setError(null);
    try { await aiClient.colegiRequest({ otherId: id }); setFound((f) => (f || []).filter((x) => x.id !== id)); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  async function respond(linkId, accept) {
    setBusy(linkId); setError(null);
    try { await aiClient.colegiRespond({ id: linkId, accept }); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  async function drop(id, name) {
    if (!window.confirm(`Îl scoți pe ${name} din colegii tăi?`)) return;
    setBusy(id); setError(null);
    try { await aiClient.colegiRemove({ otherId: id }); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  async function toggleVisible() {
    const next = !(data?.discoverable !== false);
    setBusy('vis');
    try { await aiClient.colegiSetVisible({ visible: next }); setData((d) => ({ ...d, discoverable: next })); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function openChat(id) {
    setBusy(id);
    try { await aiClient.chatDirect({ otherId: id }); navigate('/mesagerie'); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  const colegi = data?.colegi || [];
  const incoming = data?.incoming || [];
  const outgoing = data?.outgoing || [];
  const categorii = data?.categories || [];
  const catCurenta = categorii.find((c) => c.key === cat) || null;

  const rowBtn = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '7px 9px', borderRadius: 8, border: 'none', background: 'transparent',
    cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '.83rem',
  };
  const small = { fontSize: '.72rem', color: 'var(--text-muted)' };

  const body = (
    <div style={{ textAlign: 'left' }}>
      {/* cereri primite */}
      {incoming.length > 0 && (
        <div style={{ marginBottom: 10, background: 'rgba(232,185,49,.12)', border: '1px solid var(--gold)', borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ fontSize: '.75rem', fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>
            Cereri primite ({incoming.length})
          </div>
          {incoming.map((c) => (
            <div key={c.linkId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 100px', minWidth: 0, fontSize: '.82rem', color: 'var(--navy)' }}>
                {ROLE_ICON[c.role] || '👤'} {c.name}
                {c.roleLabel && <span style={{ color: 'var(--text-muted)' }}> ({c.roleLabel})</span>}
              </span>
              <button className="btn btn-sm btn-primary" disabled={busy === c.linkId} onClick={() => respond(c.linkId, true)}>Acceptă</button>
              <button className="btn btn-sm btn-outline" disabled={busy === c.linkId} onClick={() => respond(c.linkId, false)}>Refuză</button>
            </div>
          ))}
        </div>
      )}

      {/* lista de colegi: câteva nume vizibile, restul prin derulare */}
      {colegi.length === 0 ? (
        <p style={{ ...small, margin: '2px 0 8px' }}>
          Încă nu ai pe nimeni în listă. Caută după nume — poți adăuga profesori, elevi sau părinți.
        </p>
      ) : (
        <div style={{
          maxHeight: wide ? 340 : 178, overflowY: 'auto', border: '1px solid var(--border)',
          borderRadius: 10, background: '#fff', padding: 4, marginBottom: 8,
        }}>
          {colegi.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" style={rowBtn} disabled={busy === c.id} onClick={() => openChat(c.id)}
                title={`Scrie-i lui ${c.name}`}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--cream)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ fontSize: '1rem' }}>{ROLE_ICON[c.role] || '👤'}</span>
                <span style={{
                  flex: 1, minWidth: 0, color: 'var(--navy)', fontWeight: 600,
                  ...(wide ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                }}>
                  {c.name} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({c.roleLabel})</span>
                </span>
                <span style={{ ...small, whiteSpace: 'nowrap' }}>💬</span>
              </button>
              <button type="button" title="Scoate din colegi" disabled={busy === c.id} onClick={() => drop(c.id, c.name)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontSize: '.8rem', padding: '0 4px' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* căutare */}
      <button type="button" onClick={() => setShowSearch((v) => !v)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--navy)', fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--font-body)' }}>
        {showSearch ? '▾' : '▸'} ➕ Caută pe cineva
      </button>

      {showSearch && (
        <div style={{ marginTop: 8 }}>
          {/* Categoria în care caut: colegi / profesori / elevi / părinți */}
          {categorii.length > 1 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 7 }}>
              {categorii.map((c) => {
                const on = c.key === cat;
                return (
                  <button key={c.key} type="button" onClick={() => alegeCategoria(c.key)}
                    title={`Caută printre ${c.label.toLowerCase()}`}
                    style={{
                      border: `1.5px solid ${on ? 'var(--navy)' : 'var(--border)'}`,
                      background: on ? 'var(--navy)' : 'transparent',
                      color: on ? '#fff' : 'var(--navy)',
                      borderRadius: 20, padding: '4px 10px', fontSize: '.73rem', fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
                    }}>
                    {c.icon} {c.label}
                  </button>
                );
              })}
            </div>
          )}

          <form onSubmit={doSearch} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={60}
              placeholder={catCurenta ? `Nume din „${catCurenta.label}"…` : 'Numele persoanei…'}
              style={{ flex: '1 1 120px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: '.82rem', fontFamily: 'var(--font-body)' }} />
            <button type="submit" className="btn btn-sm" style={{ background: 'var(--gold)', color: 'var(--navy)', fontWeight: 700 }}>🔍</button>
          </form>
          <div style={{ ...small, marginTop: 4 }}>
            Cel puțin 3 litere. Cauți printre <strong>{(catCurenta?.label || data?.roleLabel || '').toLowerCase()}</strong>.
            Poți scrie abia după ce cererea e acceptată.
          </div>

          {searching && <div style={{ padding: 10, textAlign: 'center' }}><div className="spinner" /></div>}
          {found && found.length > 0 && (
            <div style={{ maxHeight: wide ? 300 : 150, overflowY: 'auto', marginTop: 6, border: '1px solid var(--border)', borderRadius: 10, background: '#fff', padding: 4 }}>
              {found.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: '.82rem', color: 'var(--navy)',
                    ...(wide ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                  }}>
                    {ROLE_ICON[p.role] || '👤'} {p.name}
                  </span>
                  <button type="button" disabled={busy === p.id} onClick={() => add(p.id)}
                    title={`Trimite-i o cerere lui ${p.name}`}
                    style={{
                      flexShrink: 0, border: '1.5px solid var(--navy)', background: 'transparent',
                      color: 'var(--navy)', borderRadius: 20, padding: '4px 11px', fontSize: '.76rem',
                      fontWeight: 700, cursor: busy === p.id ? 'default' : 'pointer', whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-body)', opacity: busy === p.id ? 0.6 : 1,
                    }}>
                    {busy === p.id ? '…' : '➕ Cerere'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {found && found.length === 0 && !searching && (
            <div style={{ ...small, marginTop: 6 }}>
              Niciun rezultat în „{catCurenta?.label || 'această categorie'}". Încearcă altă categorie sau altă parte din nume — unii își opresc găsirea în căutare.
            </div>
          )}

          {outgoing.length > 0 && (
            <div style={{ ...small, marginTop: 8 }}>
              Cereri trimise, în așteptare: {outgoing.map((c) => c.name).join(', ')}.
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: '.76rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={data?.discoverable !== false} disabled={busy === 'vis'} onChange={toggleVisible} />
            Pot fi găsit după nume (de profesori, elevi și părinți)
          </label>
        </div>
      )}

      {error && <div style={{ fontSize: '.78rem', color: '#b71c1c', marginTop: 6 }}>⚠️ {error}</div>}

      <button type="button" onClick={() => navigate('/mesagerie')}
        style={{ marginTop: 10, width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--navy)', background: 'transparent', color: 'var(--navy)', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
        💬 Deschide mesageria
      </button>
    </div>
  );

  const titlu = (
    <>👥 Colegii mei{colegi.length ? ` (${colegi.length})` : ''}
      {incoming.length > 0 && (
        <span style={{ marginLeft: 6, background: '#e74c3c', color: '#fff', borderRadius: 10, fontSize: '.66rem', fontWeight: 700, padding: '1px 6px' }}>
          {incoming.length}
        </span>
      )}
    </>
  );

  if (!data) {
    return <div className="card" style={{ marginTop: 16, padding: 14, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  // Mobil: tab cu rolldown. Desktop: fereastra din bara laterală.
  if (isMobile) {
    return (
      <details className="card" style={{ marginTop: 16 }} open={defaultOpen || incoming.length > 0}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', fontSize: '1rem', listStyle: 'none' }}>
          {titlu}
        </summary>
        <div style={{ marginTop: 12 }}>{body}</div>
      </details>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h4 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: '0 0 10px', fontSize: '1rem' }}>{titlu}</h4>
      {body}
    </div>
  );
}
