// =====================================================================
// src/components/SEORankTracker.jsx — RANK-TRACKING (Faza 4b din
// GHID_AGENT_SEO_ACTIUNI.md). Se montează în AIAdminPanel, sub coada
// de aprobare.
//
// Grafice SVG fără dependențe, din istoricul zilnic `gsc_snapshots`
// (endpointul admin api/seo-rank.js):
//   • clicuri/zi și impresii/zi (două grafice mici, câte o axă fiecare);
//   • evoluția POZIȚIEI pe interogările-țintă (axa inversată: 1 = sus),
//     cu momentele acțiunilor executate marcate vertical pe grafic;
//   • efectul măsurat al fiecărei optimizări (14 zile înainte vs. după);
//   • tabelul interogărilor (clicuri, impresii, poziție, Δ vs. perioada
//     anterioară) — și vedere-tabel pentru datele din grafice.
//
// Paleta seriilor e fixă și verificată pentru daltonism (CVD ΔE ≥ 8) pe
// fundal alb; culoarea urmează interogarea (nu se recolorează la filtrare).
// =====================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { aiClient } from '../lib/aiClient';

// Ordine FIXĂ, validată (lightness/chroma/CVD/contrast pe alb) — nu se ciclează.
const SERIES_COLORS = ['#1a63a8', '#b8860b', '#9048b0', '#1e8a4f', '#2596b8', '#c0563b'];
const CLICKS_COLOR = SERIES_COLORS[0];
const IMPR_COLOR = SERIES_COLORS[1];
const GRID = '#eef1f6', AXIS_TXT = '#8e95a3', MARKER = '#5a6170';

const TYPE_ICONS = {
  set_page_meta: '🏷️', rename_material: '✏️', submit_sitemap: '🗺️',
  publish_article: '📰', update_article: '🔄', schedule_social: '📱', yt_update_video: '▶️',
};

const fmtDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n));

// Toate zilele consecutive din interval — liniile nu sar peste zilele lipsă.
function dayRange(start, end) {
  const out = [];
  for (let t = Date.parse(start + 'T00:00:00Z'); t <= Date.parse(end + 'T00:00:00Z'); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ─── Grafic-linie generic (o singură axă Y; hover cu crosshair + tooltip) ────
function LineChart({ days, series, markers = [], height = 170, yInverted = false, yFmt = fmtNum, unit = '' }) {
  const [hover, setHover] = useState(null); // index în days
  const W = 640, H = height, L = 38, R = 10, T = 16, B = 20;
  const iw = W - L - R, ih = H - T - B;

  const values = series.flatMap((s) => s.points.map((p) => p.value).filter((v) => v != null));
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (yInverted) { lo = 1; hi = Math.max(Math.ceil(hi) + 1, 3); } else { lo = 0; hi = hi * 1.08 || 1; }

  const x = (i) => L + (days.length <= 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v) => {
    const f = (v - lo) / (hi - lo || 1);
    return yInverted ? T + f * ih : T + (1 - f) * ih;
  };
  const path = (pts) => {
    let d = '', pen = false;
    pts.forEach((p, i) => {
      if (p.value == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const ticks = 3;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);
  const markerByDay = useMemo(() => {
    const m = new Map();
    markers.forEach((mk) => {
      const i = days.indexOf(mk.day);
      if (i === -1) return;
      if (!m.has(i)) m.set(i, []);
      m.get(i).push(mk);
    });
    return m;
  }, [markers, days]);

  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (iw || 1)) * (days.length - 1));
    setHover(i >= 0 && i < days.length ? i : null);
  }

  const hoverRows = hover != null
    ? series.map((s) => ({ ...s, v: s.points[hover]?.value })).filter((s) => s.v != null)
    : [];
  const tipLeft = hover != null ? (x(hover) / W) * 100 : 0;

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={L - 5} y={y(v) + 3} textAnchor="end" fontSize="9.5" fill={AXIS_TXT}>{yFmt(yInverted ? Math.round(v * 10) / 10 : Math.round(v))}</text>
          </g>
        ))}
        {days.length > 0 && [0, Math.floor((days.length - 1) / 2), days.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => (
            <text key={i} x={x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} fontSize="9.5" fill={AXIS_TXT}>
              {fmtDay(days[i])}
            </text>
          ))}

        {/* momentele acțiunilor executate */}
        {[...markerByDay.entries()].map(([i, mks]) => (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={T - 2} y2={H - B} stroke={MARKER} strokeWidth="1" strokeDasharray="3,3" opacity="0.55" />
            <text x={x(i)} y={T - 5} textAnchor="middle" fontSize="9">
              {TYPE_ICONS[mks[0].type] || '⚙️'}{mks.length > 1 ? `×${mks.length}` : ''}
              <title>{mks.map((m) => `${fmtDay(m.day)} · ${m.label}`).join('\n')}</title>
            </text>
          </g>
        ))}

        {series.map((s) => <path key={s.key} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}

        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#b7bfcc" strokeWidth="1" />
            {hoverRows.map((s) => (
              <circle key={s.key} cx={x(hover)} cy={y(s.v)} r="3.5" fill={s.color} stroke="#fff" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>

      {hover != null && hoverRows.length > 0 && (
        <div style={{
          position: 'absolute', top: 2, left: `min(max(${tipLeft}%, 12%), 78%)`, transform: 'translateX(-50%)',
          background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px',
          fontSize: '.72rem', boxShadow: '0 3px 10px rgba(15,43,68,.12)', pointerEvents: 'none', zIndex: 2, whiteSpace: 'nowrap',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 2 }}>{fmtDay(days[hover])}</div>
          {hoverRows.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: s.color, flexShrink: 0 }} />
              <span style={{ maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || s.key}</span>
              <strong>{yInverted ? s.v : fmtNum(s.v)}{unit}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Δ poziție: se primește deja „pozitiv = a urcat" (prev − curent); simbol + cifră,
// nu doar culoare (accesibil și fără percepția roșu/verde).
const deltaBadge = (delta) => {
  if (delta == null) return <span style={{ color: 'var(--text-muted)' }}>nou</span>;
  const sym = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
  const col = delta === 0 ? 'var(--text-muted)' : delta > 0 ? '#1e7e34' : '#b71c1c';
  return <span style={{ color: col, fontWeight: 700 }}>{sym} {Math.abs(delta).toFixed(1)}</span>;
};

export default function SEORankTracker({ box }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(28);
  const [dim, setDim] = useState('query');
  const [selected, setSelected] = useState([]); // interogările desenate (max 6)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTable, setShowTable] = useState(false);

  const load = useCallback(async (d = days, dm = dim) => {
    setLoading(true); setError(null);
    try {
      const r = await aiClient.seoRank({ action: 'data', days: d, dim: dm });
      setData(r);
      setSelected((r.top || []).slice(0, 4).map((k) => k.key)); // implicit: top 4
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(days, dim); }, [days, dim, load]);

  const allDays = useMemo(() => (data?.start && data?.end ? dayRange(data.start, data.end) : []), [data]);

  // Culoarea urmează INTEROGAREA (indexul ei fix în top 6) — nu selecția.
  const selectable = (data?.top || []).slice(0, 6);
  const colorOf = (key) => SERIES_COLORS[selectable.findIndex((k) => k.key === key)] || SERIES_COLORS[5];

  const posSeries = useMemo(() => {
    if (!data) return [];
    return selected
      .filter((key) => data.series?.[key])
      .map((key) => {
        const byDay = new Map(data.series[key].map((p) => [p.day, p]));
        return {
          key, name: key, color: colorOf(key),
          points: allDays.map((d) => ({ day: d, value: byDay.get(d)?.position ?? null })),
        };
      });
  }, [data, selected, allDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const dailySeries = (field, color, name) => [{
    key: field, name, color,
    points: allDays.map((d) => {
      const row = (data?.daily || []).find((x) => x.day === d);
      return { day: d, value: row ? row[field] : 0 };
    }),
  }];

  const toggleKey = (key) => setSelected((sel) =>
    sel.includes(key) ? sel.filter((k) => k !== key) : sel.length >= 6 ? sel : [...sel, key]);

  const t = data?.totals, pt = data?.prevTotals;
  const totDelta = (a, b) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%` : null);
  const measured = (data?.effects || []).filter((e) => e.effect && !e.effect.pending && (e.effect.before || e.effect.after));
  const pending = (data?.effects || []).filter((e) => e.effect?.pending);

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
          📉 Rank-tracking — pozițiile în Google
        </h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[14, 28, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} disabled={loading}
              style={{
                border: days === d ? '2px solid var(--navy)' : '1px solid var(--border)',
                background: days === d ? 'var(--navy)' : '#fff', color: days === d ? '#fff' : 'var(--navy)',
                borderRadius: 20, padding: '3px 11px', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer',
              }}>{d} zile</button>
          ))}
          <button onClick={() => setDim(dim === 'query' ? 'page' : 'query')} disabled={loading}
            style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--navy)', borderRadius: 20, padding: '3px 11px', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer' }}>
            {dim === 'query' ? '🔎 interogări' : '📄 pagini'} ⇄
          </button>
          <button className="btn btn-outline" onClick={() => load(days, dim)} disabled={loading} style={{ fontSize: '.76rem', padding: '4px 11px' }}>↻</button>
        </div>
      </div>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
        Trenduri din istoricul zilnic Search Console (snapshot la 05:00; datele Google au ~2 zile întârziere).
        Liniile verticale marchează acțiunile executate ale agentului — vezi negru pe alb efectul fiecărei optimizări.
      </p>

      {error && <div style={{ padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {error}</div>}
      {data?.warning && <div style={{ padding: 12, background: '#fff7e0', color: '#8a6d00', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {data.warning}</div>}
      {loading && !data && <div style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Se încarcă…</div>}

      {data && data.daily?.length > 0 && (
        <>
          {/* Totaluri + cele două grafice zilnice (o măsură = un grafic, o axă) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: 14, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: CLICKS_COLOR, marginRight: 6 }} />
                Clicuri / zi
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                  total {fmtNum(t?.clicks ?? 0)}{totDelta(t?.clicks, pt?.clicks) ? ` · ${totDelta(t?.clicks, pt?.clicks)} vs. perioada anterioară` : ''}
                </span>
              </div>
              <LineChart days={allDays} series={dailySeries('clicks', CLICKS_COLOR, 'Clicuri')} markers={data.markers} height={150} />
            </div>
            <div>
              <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: IMPR_COLOR, marginRight: 6 }} />
                Impresii / zi
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                  total {fmtNum(t?.impressions ?? 0)}{totDelta(t?.impressions, pt?.impressions) ? ` · ${totDelta(t?.impressions, pt?.impressions)} vs. perioada anterioară` : ''}
                </span>
              </div>
              <LineChart days={allDays} series={dailySeries('impressions', IMPR_COLOR, 'Impresii')} markers={data.markers} height={150} />
            </div>
          </div>

          {/* Poziția pe interogările-țintă: legendă-chips (culoare fixă per interogare) */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>
              Poziția medie în Google ({dim === 'query' ? 'interogări' : 'pagini'} — 1 = primul loc, mai sus e mai bine)
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {selectable.map((k) => {
                const on = selected.includes(k.key);
                return (
                  <button key={k.key} onClick={() => toggleKey(k.key)} title={`${k.clicks} clicuri · poziția ${k.position ?? '–'}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 260,
                      border: on ? `1.5px solid ${colorOf(k.key)}` : '1px solid var(--border)',
                      background: on ? '#fff' : '#f7f9fc', color: 'var(--text)', opacity: on ? 1 : 0.62,
                      borderRadius: 20, padding: '3px 10px', fontSize: '.74rem', cursor: 'pointer',
                    }}>
                    <span style={{ width: 9, height: 9, borderRadius: 9, background: colorOf(k.key), flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.key}</span>
                  </button>
                );
              })}
              {selectable.length === 0 && <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>(încă fără interogări în snapshot-uri)</span>}
            </div>
            {posSeries.length > 0 && (
              <LineChart days={allDays} series={posSeries} markers={data.markers} height={230} yInverted yFmt={(v) => v} />
            )}
          </div>

          {/* Efectul acțiunilor executate */}
          {(measured.length > 0 || pending.length > 0) && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>⚡ Efectul optimizărilor (14 zile înainte vs. după)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {measured.map((e) => {
                  const b = e.effect.before, a = e.effect.after;
                  return (
                    <div key={e.id} style={{ fontSize: '.8rem', background: '#f7f9fc', borderRadius: 8, padding: '7px 10px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{TYPE_ICONS[e.type] || '⚙️'} {e.label}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{fmtDay(e.day)}</span>
                      <span>poziție {b?.position ?? '–'} → <strong>{a?.position ?? '–'}</strong> {b?.position != null && a?.position != null && deltaBadge(Number((b.position - a.position).toFixed(1)))}</span>
                      <span>· clicuri/zi {b?.clicksPerDay ?? '–'} → <strong>{a?.clicksPerDay ?? '–'}</strong></span>
                      <span>· impresii/zi {b?.impressionsPerDay ?? '–'} → <strong>{a?.impressionsPerDay ?? '–'}</strong></span>
                    </div>
                  );
                })}
                {pending.map((e) => (
                  <div key={e.id} style={{ fontSize: '.8rem', background: '#fffdf5', borderRadius: 8, padding: '7px 10px', color: 'var(--text-light)' }}>
                    {TYPE_ICONS[e.type] || '⚙️'} {e.label} · {fmtDay(e.day)} — <em>încă se măsoară ({e.effect.daysSoFar} zile de date după; minim 5)</em>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabelul complet (și „vedere tabel" a graficelor) */}
          <div style={{ marginTop: 14 }}>
            <button onClick={() => setShowTable((v) => !v)}
              style={{ background: 'none', border: 'none', color: 'var(--navy)', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', padding: 0 }}>
              {showTable ? '▾' : '▸'} Tabel: top {dim === 'query' ? 'interogări' : 'pagini'} ({(data.top || []).length})
            </button>
            {showTable && (
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.8rem' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px', fontWeight: 600 }}>{dim === 'query' ? 'Interogarea' : 'Pagina'}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Clicuri</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Impresii</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Poziție</th>
                      <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Δ poziție</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.top || []).map((k) => (
                      <tr key={k.key} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 8px', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.key}>{k.key}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{k.clicks}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>{k.impressions}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--navy)' }}>{k.position ?? '–'}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                          {k.prevPosition != null && k.position != null ? deltaBadge(Number((k.prevPosition - k.position).toFixed(1))) : deltaBadge(null)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {data && !loading && !(data.daily?.length > 0) && !data.warning && (
        <div style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
          Încă nu există snapshot-uri GSC în fereastra aleasă — graficele apar după câteva zile de cron (sau după backfill).
        </div>
      )}
    </div>
  );
}
