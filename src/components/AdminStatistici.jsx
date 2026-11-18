// =====================================================================
// src/components/AdminStatistici.jsx — „📊 Statistici de utilizare"
// (Admin → 🤖 Unelte AI — fostul „AI Tutor", primul panou; 30 oct. 2026)
//
// Ce arată, pe ultimele 7 / 30 / 90 de zile:
//   · cifrele mari: pagini văzute, utilizatori activi, vizitatori fără cont,
//     conturi noi, abonați, teste rezolvate, cereri AI (+ costul), retenția,
//     misiunile zilnice îndeplinite;
//   · paginile văzute pe zi (coloane, cu detaliile la hover și tabelul lor);
//   · cele mai vizitate pagini · cele mai deschise materiale · cele mai folosite
//     teste (rezolvate) · utilizatorii care revin cel mai des și cei cu cele mai
//     multe accesări — TOȚI cei din perioadă, cu cont sau fără, câte 25 pe pagină,
//     cu paginile pe care le-au văzut (18 nov. 2026, ListaVizitatori) · funcțiile
//     AI folosite · dispozitivele · orele de vârf · de unde vin vizitatorii ·
//     conturile pe rol.
// Datele: POST /api/admin-stats { action: 'site', zile } → funcția SQL
// admin_statistici (supabase/statistici_vizite.sql). Vizitele le trimite
// aplicația la fiecare pagină (src/lib/vizite.js → api/vizita.js).
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../lib/api';
import Rolldown from './Rolldown';
import { numePagina, numeFunctieAI, zileComplete, ROLURI, nr, fmt, fmtZi, fmtCand } from '../lib/statistici';
import { pageWindow } from '../lib/paginare';

const PERIOADE = [7, 30, 90];
const ACCENT = 'var(--gold, #e8b931)';

// numele prietenoase ale paginilor / funcțiilor AI + zilele fără vizite: src/lib/statistici.js

// ─── Piesele ────────────────────────────────────────────────────────────────
function Tile({ label, value, sub }) {
  return (
    <div style={{ background: '#f7f9fc', borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--navy)', lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: '.74rem', color: 'var(--text-light)', fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Sectiune({ titlu, nota, children }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', background: '#fff', minWidth: 0 }}>
      <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '.92rem' }}>{titlu}</div>
      {nota && <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{nota}</div>}
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

// Clasament cu bară orizontală (o singură nuanță; textul în culorile textului)
function Clasament({ randuri, gol = 'Încă nimic în perioada aceasta.' }) {
  if (!randuri || !randuri.length) return <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>{gol}</div>;
  const max = Math.max(1, ...randuri.map((r) => r.valoare || 0));
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 7 }}>
      {randuri.map((r, i) => (
        <li key={r.cheie || i} style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: '.82rem' }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 18, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{i + 1}.</span>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.titlu}>
              {r.titlu}{r.detaliu && <span style={{ color: 'var(--text-muted)', fontSize: '.74rem' }}> · {r.detaliu}</span>}
            </span>
            <strong style={{ color: 'var(--navy)', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.valoare)}</strong>
            {r.extra && <span style={{ color: 'var(--text-muted)', fontSize: '.74rem', whiteSpace: 'nowrap' }}>{r.extra}</span>}
          </div>
          <div style={{ marginLeft: 26, marginTop: 3, height: 6, background: 'var(--cream, #faf6ec)', borderRadius: 4 }}>
            <div style={{ width: `${Math.max(2, Math.round(((r.valoare || 0) / max) * 100))}%`, height: '100%', background: ACCENT, borderRadius: 4 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

// Coloane (o serie): ≤ 24 px grosime, colț rotunjit sus, 2 px între ele,
// detaliile la hover / focus (tastatura), axa cu valori rotunde. Lățimea e cea
// MĂSURATĂ a cutiei (nu un SVG scalat): textul rămâne lizibil și pe telefon, iar
// etichetele de jos se răresc cât să nu se suprapună.
function Coloane({ date, eticheta, valoare, detaliu, inaltime = 150, etichetaJos, etichetaFiecare = null }) {
  const [activ, setActiv] = useState(null);
  const ref = useRef(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const upd = () => setW(Math.max(240, Math.round(el.clientWidth || 720)));
    upd();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', upd);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', upd); };
  }, []);
  const H = inaltime, ST = 34, JOS = 20, SUS = 8;
  const n = Math.max(1, date.length);
  const max = Math.max(1, ...date.map(valoare));
  const pas = max <= 5 ? 1 : 10 ** Math.floor(Math.log10(max)) * (max / 10 ** Math.floor(Math.log10(max)) > 5 ? 2 : 1);
  const top = Math.ceil(max / pas) * pas;
  const bandW = (W - ST) / n;
  const barW = Math.max(2, Math.min(24, bandW - 2));
  const y = (v) => SUS + (H - SUS - JOS) * (1 - v / top);
  const ticks = [0, top / 2, top].filter((v, i, a) => a.indexOf(v) === i && Number.isInteger(v));
  // etichetele de jos: cel puțin ~64 px între ele. Pe zile, numărate de la
  // capăt (ultima zi — cea mai nouă — se vede mereu); pe ore, pe multipli
  // (`etichetaFiecare`: 0, 3, 6… sau 0, 6, 12, 18 pe ecran îngust).
  const minPas = Math.max(1, Math.ceil(64 / bandW));
  const vizibile = new Set();
  if (etichetaFiecare) {
    const pasE = Math.ceil(minPas / etichetaFiecare) * etichetaFiecare;
    for (let i = 0; i < n; i += pasE) vizibile.add(i);
  } else {
    for (let i = n - 1; i >= 0; i -= minPas) vizibile.add(i);
  }
  const arata = (i) => vizibile.has(i);
  // la margini, eticheta se aliniază spre interior (nu iese din grafic)
  const ancora = (i) => (i * bandW + bandW / 2 < 26 ? 'start' : W - (ST + i * bandW + bandW / 2) < 26 ? 'end' : 'middle');
  const xEt = (i) => (ancora(i) === 'start' ? ST + i * bandW : ancora(i) === 'end' ? ST + (i + 1) * bandW : ST + i * bandW + bandW / 2);
  const a = activ != null ? date[activ] : null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={eticheta} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={ST} x2={W} y1={y(t)} y2={y(t)} stroke="#e6ebf1" strokeWidth="1" />
            <text x={ST - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7689">{fmt(t)}</text>
          </g>
        ))}
        {date.map((d, i) => {
          const v = valoare(d);
          const x = ST + i * bandW + (bandW - barW) / 2;
          const h = Math.max(0, H - JOS - y(v));
          const r = Math.min(4, barW / 2, h);
          const yTop = H - JOS - h;
          const path = h > 0
            ? `M${x},${H - JOS} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${H - JOS} Z`
            : '';
          return (
            <g key={i}>
              {path && <path d={path} fill={ACCENT} opacity={activ == null || activ === i ? 1 : 0.55} />}
              {/* ținta de hover: toată banda, nu doar coloana pictată */}
              <rect x={ST + i * bandW} y={SUS} width={bandW} height={H - SUS - JOS} fill="transparent"
                tabIndex={0} aria-label={detaliu(d)} style={{ cursor: 'default', outline: 'none' }}
                onMouseEnter={() => setActiv(i)} onMouseLeave={() => setActiv(null)}
                onFocus={() => setActiv(i)} onBlur={() => setActiv(null)} />
            </g>
          );
        })}
        <line x1={ST} x2={W} y1={H - JOS} y2={H - JOS} stroke="#cfd8e3" strokeWidth="1" />
        {etichetaJos && date.map((d, i) => (arata(i)
          ? <text key={i} x={xEt(i)} y={H - 5} textAnchor={ancora(i)} fontSize="10" fill="#6b7689">{etichetaJos(d, i)}</text>
          : null))}
      </svg>
      {a && (
        <div role="status" style={{
          position: 'absolute', top: 0, left: Math.min(Math.max(0, ST + activ * bandW - 40), Math.max(0, W - 230)),
          background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px',
          boxShadow: '0 6px 18px rgba(15,43,68,.14)', fontSize: '.76rem', pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {detaliu(a)}
        </div>
      )}
    </div>
  );
}

// ─── „🔁 Utilizatorii care revin": TOȚI cei din perioadă, pe pagini ───────────
// 18 nov. 2026 — „fă să văd mai mulți vizitatori care intră pe site, puși pe pagini
// (…) pune-i pe toți care au accesat în ultimele x zile": POST /api/admin-stats
// { action: 'vizitatori', zile, ordine, tip, pagina } → funcția SQL admin_vizitatori
// (supabase/statistici_vizitatori.sql), câte 25 pe pagină. Cu cont / fără cont (id-ul
// anonim, doar cu acordul pentru cookie-uri) / toți; după zilele active sau după
// paginile văzute; pe fiecare rând — paginile pe care le-a văzut cel mai des.
// Fără script: primii 25 cu cont (din „site"), ca înainte, cu nota ce e de rulat.
const TIPURI_VIZ = [
  { id: 'cont', label: '👤 Cu cont' },
  { id: 'anonimi', label: '🕶️ Fără cont' },
  { id: 'toti', label: '👥 Toți' },
];
const DISPOZITIV = { telefon: '📱 telefon', tableta: '📟 tabletă', calculator: '💻 calculator' };
const th = { padding: '4px 6px', whiteSpace: 'nowrap' };
const td = { padding: '6px 6px', verticalAlign: 'top' };

function RandVizitator({ r, ordine }) {
  const anonim = r.tip === 'anonim';
  return (
    <tr style={{ borderTop: '1px solid #eef1f5' }}>
      <td style={{ ...td, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{r.loc}</td>
      <td style={{ ...td, minWidth: 170 }}>
        {anonim ? (
          <>
            <strong style={{ color: 'var(--navy)' }}>🕶️ Vizitator fără cont</strong>
            <div style={{ color: 'var(--text-muted)', fontSize: '.72rem', fontFamily: 'monospace' }} title={r.id}>{String(r.id || '').slice(0, 10)}</div>
          </>
        ) : (
          <>
            <strong style={{ color: 'var(--navy)' }}>{r.nume || '(fără nume)'}</strong>
            {r.premium && <span title="Abonament Premium activ" style={{ marginLeft: 6, fontSize: '.68rem', fontWeight: 800, color: '#8a6d00', background: 'rgba(232,185,49,.18)', borderRadius: 8, padding: '1px 6px' }}>⭐ Premium</span>}
            {r.email && <div style={{ color: 'var(--text-muted)', fontSize: '.72rem' }}>{r.email}</div>}
          </>
        )}
      </td>
      <td style={td}>{anonim ? '—' : (r.rol || '—')}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: ordine === 'zile' ? 800 : 400, color: 'var(--navy)' }}>{fmt(r.zile)}</td>
      <td style={{ ...td, textAlign: 'right', fontWeight: ordine === 'accesari' ? 800 : 400, color: 'var(--navy)' }}>{fmt(r.vizualizari)}</td>
      <td style={{ ...td, minWidth: 220 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(r.pagini || []).map((pg) => (
            <span key={pg.path} title={`${pg.path} · ${fmt(pg.n)} ${pg.n === 1 ? 'vizită' : 'vizite'}`}
              style={{ fontSize: '.7rem', background: 'var(--cream, #faf6ec)', border: '1px solid var(--cream-dark, #ede5d0)', borderRadius: 99, padding: '1px 7px', whiteSpace: 'nowrap' }}>
              {numePagina(pg.path)} <b style={{ color: 'var(--navy)' }}>×{fmt(pg.n)}</b>
            </span>
          ))}
        </div>
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--text-light)', fontSize: '.74rem' }}>
        {DISPOZITIV[r.dispozitiv] || r.dispozitiv || '—'}
        {r.sursa && <div title="De unde a venit prima dată">↪ {r.sursa}</div>}
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--text-light)' }}>
        {fmtCand(r.ultima)}
        {r.prima && <div style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>prima: {fmtCand(r.prima)}</div>}
      </td>
    </tr>
  );
}

export function ListaVizitatori({ zile, s, seg, reincarcat = null }) {
  const [ordine, setOrdine] = useState('zile');      // 'zile' (revin cel mai des) | 'accesari'
  const [tip, setTip] = useState('cont');           // 'cont' | 'anonimi' | 'toti'
  const cheie = `${zile}|${ordine}|${tip}`;
  // pagina ține de filtre: alte filtre → de la prima pagină (fără o cerere în plus)
  const [pag, setPag] = useState({ cheie, p: 1 });
  const pagina = pag.cheie === cheie ? pag.p : 1;
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const sus = useRef(null);

  useEffect(() => {
    let viu = true;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const res = await fetch('/api/admin-stats', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ action: 'vizitatori', zile, ordine, tip, pagina }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `Eroare server (${res.status})`);
        if (viu) setD(j);
      } catch (e) { if (viu) setErr(e.message); }
      finally { if (viu) setBusy(false); }
    })();
    return () => { viu = false; };
  }, [cheie, pagina, reincarcat]); // eslint-disable-line react-hooks/exhaustive-deps

  const mergiLa = (p) => {
    setPag({ cheie, p });
    try { sus.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ }
  };
  const v = (s && s.vizite) || {};
  const nrTip = { cont: v.utilizatori, anonimi: v.anonimi, toti: v.utilizatori != null && v.anonimi != null ? v.utilizatori + v.anonimi : null };
  const faraScript = d && d.ok === false && d.setup === false;
  // fără script: primii 25 cu cont, din „site" (ca înainte)
  const vechi = ordine === 'zile' ? (s && s.revin) || [] : (s && s.accesari) || [];
  const randuri = faraScript ? vechi.map((u, i) => ({ ...u, tip: 'cont', loc: i + 1, pagini: [] })) : (d && d.randuri) || [];
  const total = faraScript ? vechi.length : (d && d.total) || 0;
  const pagini = faraScript ? 1 : (d && d.pagini) || 1;
  const pe = (d && d.peFiecarePagina) || 25;
  const de = total ? (pagina - 1) * pe + 1 : 0;
  const pana = Math.min(total, pagina * pe);

  return (
    <div ref={sus} style={{ scrollMarginTop: 84 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <button type="button" style={seg(ordine === 'zile')} onClick={() => setOrdine('zile')} aria-pressed={ordine === 'zile'}>🔁 Revin cel mai des (zile)</button>
        <button type="button" style={seg(ordine === 'accesari')} onClick={() => setOrdine('accesari')} aria-pressed={ordine === 'accesari'}>👣 Cele mai multe accesări (pagini)</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }} role="group" aria-label="Ce vizitatori">
        {TIPURI_VIZ.map((t) => (
          <button key={t.id} type="button" style={seg(tip === t.id)} onClick={() => setTip(t.id)} aria-pressed={tip === t.id} disabled={faraScript && t.id !== 'cont'}>
            {t.label}{nrTip[t.id] != null ? ` (${fmt(nrTip[t.id])})` : ''}
          </button>
        ))}
      </div>
      {faraScript && (
        <div style={{ fontSize: '.78rem', color: '#8a5a00', background: '#fff4e5', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
          Arăt doar primii 25 cu cont. Ca să-i vezi pe <b>toți</b> (cu cont și fără, pe pagini, cu paginile văzute), rulează <code>supabase/statistici_vizitatori.sql</code> în Supabase → SQL Editor.
        </div>
      )}
      {err && <div style={{ fontSize: '.8rem', color: '#c62828', marginBottom: 6 }}>⚠️ {err}</div>}
      {randuri.length ? (
        <>
          <div style={{ fontSize: '.76rem', color: 'var(--text-light)', marginBottom: 4 }}>
            {faraScript ? `${fmt(total)} afișați` : `${fmt(de)}–${fmt(pana)} din ${fmt(total)}`}
            {busy && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>· se încarcă…</span>}
          </div>
          <div style={{ overflowX: 'auto', opacity: busy ? 0.6 : 1, transition: 'opacity .15s' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '.74rem' }}>
                  <th style={th}>#</th><th style={th}>Vizitator</th><th style={th}>Rol</th>
                  <th style={{ ...th, textAlign: 'right' }}>Zile active</th><th style={{ ...th, textAlign: 'right' }}>Pagini văzute</th>
                  <th style={th}>Ce a văzut cel mai des</th><th style={th}>Dispozitiv</th><th style={th}>Ultima vizită</th>
                </tr>
              </thead>
              <tbody>
                {randuri.map((r) => <RandVizitator key={`${r.tip}:${r.id}`} r={r} ordine={ordine} />)}
              </tbody>
            </table>
          </div>
          {pagini > 1 && (
            <nav aria-label="Paginile listei" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={pagina <= 1 || busy} onClick={() => mergiLa(pagina - 1)}>‹ Înapoi</button>
              {pageWindow(pagina, pagini).map((p, i) => (p === '…'
                ? <span key={`g${i}`} style={{ padding: '0 4px', color: 'var(--text-muted)' }}>…</span>
                : <button key={p} type="button" style={{ ...seg(p === pagina), minWidth: 36, padding: '5px 8px' }} aria-current={p === pagina ? 'page' : undefined} disabled={busy && p !== pagina} onClick={() => mergiLa(p)}>{p}</button>))}
              <button type="button" className="btn btn-outline btn-sm" disabled={pagina >= pagini || busy} onClick={() => mergiLa(pagina + 1)}>Înainte ›</button>
            </nav>
          )}
        </>
      ) : (
        <div style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>
          {busy || (!d && !err) ? 'Se încarcă…' : tip === 'anonimi' ? 'Niciun vizitator fără cont (cu acord pentru cookie-uri) în perioada aceasta.' : 'Încă nu există vizite în perioada aceasta.'}
        </div>
      )}
    </div>
  );
}

// ─── Panoul ─────────────────────────────────────────────────────────────────
export default function AdminStatistici({ box }) {
  const [zile, setZile] = useState(30);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async (z = zile) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin-stats', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ action: 'site', zile: z }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Eroare server (${res.status})`);
      setS({ ...d, incarcatLa: new Date().toISOString() });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [zile]);
  useEffect(() => { load(zile); }, [zile]); // eslint-disable-line react-hooks/exhaustive-deps

  const peZile = useMemo(() => (s && s.ok ? zileComplete(s.peZile, s.de_la, s.pana_la) : []), [s]);
  const ore = useMemo(() => {
    const m = new Map(((s && s.ore) || []).map((o) => [o.ora, o.vizualizari]));
    return Array.from({ length: 24 }, (_, h) => ({ ora: h, vizualizari: m.get(h) || 0 }));
  }, [s]);

  const seg = (on) => ({
    padding: '6px 12px', fontSize: '.8rem', fontWeight: 700, cursor: 'pointer', borderRadius: 8,
    border: `2px solid ${on ? 'var(--gold)' : 'var(--border)'}`, background: on ? 'rgba(232,185,49,.12)' : '#fff', color: 'var(--navy)',
  });

  const v = (s && s.vizite) || {};
  const ai = (s && s.ai) || [];
  const aiCereri = ai.reduce((t, r) => t + (r.cereri || 0), 0);
  const aiLei = ai.some((r) => r.lei != null) ? ai.reduce((t, r) => t + (Number(r.lei) || 0), 0) : null;
  const ret = s && s.retentie;
  const retPct = ret && ret.inainte > 0 ? Math.round((ret.auRevenit / ret.inainte) * 100) : null;
  const disp = (s && s.dispozitive) || {};
  const dispTotal = Object.values(disp).reduce((t, n) => t + n, 0);
  const conturi = (s && s.conturi) || {};
  const faraVizite = s && s.ok && !(v.vizualizari > 0);

  return (
    <Rolldown box={box} storageKey="statistici" defaultOpen title="📊 Statistici de utilizare"
      hint="paginile vizitate, testele folosite, cine revine">
      {/* filtrele: un rând, deasupra tuturor graficelor */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        {PERIOADE.map((z) => (
          <button key={z} type="button" style={seg(zile === z)} onClick={() => setZile(z)} aria-pressed={zile === z}>Ultimele {z} zile</button>
        ))}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => load(zile)} disabled={busy}>{busy ? 'Se încarcă…' : '↻ Reîmprospătează'}</button>
        {s && s.incarcatLa && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>actualizat la {fmtCand(s.incarcatLa)}</span>}
      </div>

      {err && <div style={{ padding: 10, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {err}</div>}
      {s && s.ok === false && !s.setup && (
        <div style={{ padding: 12, background: 'rgba(231,76,60,.06)', border: '1px solid var(--danger, #e74c3c)', borderRadius: 10, fontSize: '.85rem', marginBottom: 10 }}>
          <strong style={{ color: 'var(--danger, #c0392b)' }}>Statisticile nu sunt pornite.</strong>{' '}
          Rulează <code>supabase/statistici_vizite.sql</code> în Supabase → SQL Editor. Din clipa aceea, site-ul începe să numere vizitele.
          <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{s.mesaj}</div>
        </div>
      )}
      {s && s.ok === false && s.setup && <div style={{ fontSize: '.85rem', color: '#b71c1c' }}>⚠️ {s.mesaj}</div>}
      {!s && !err && <div style={{ padding: 20, textAlign: 'center' }}><div className="spinner" /></div>}

      {s && s.ok && (
        <>
          {faraVizite && (
            <div style={{ padding: '8px 12px', background: 'rgba(232,185,49,.1)', borderRadius: 8, fontSize: '.8rem', color: 'var(--text-light)', marginBottom: 10 }}>
              Încă nu s-au înregistrat vizite în perioada aceasta: site-ul le numără de la rularea scriptului <code>statistici_vizite.sql</code>.
              Testele rezolvate, funcțiile AI și conturile de mai jos vin din datele de până acum.
            </div>
          )}

          {/* cifrele mari */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
            <Tile label="Pagini văzute" value={fmt(v.vizualizari)} sub={v.materialeDeschise ? `${fmt(v.materialeDeschise)} deschideri de materiale` : null} />
            <Tile label="Utilizatori activi (cu cont)" value={fmt(v.utilizatori)} />
            <Tile label="Vizite fără cont" value={fmt(v.faraCont)} sub={v.anonimi ? `${fmt(v.anonimi)} vizitatori recunoscuți (cu acord)` : 'vizitatorii fără acord nu se pot deosebi'} />
            <Tile label="Conturi noi" value={fmt(conturi.noi)} sub={Object.entries(conturi.noiPeRol || {}).map(([r, n]) => nr(n, r)).join(' · ') || null} />
            <Tile label="Abonați Premium" value={fmt(conturi.premium)} sub={conturi.total ? `din ${fmt(conturi.total)} conturi` : null} />
            <Tile label="Teste rezolvate" value={fmt(s.rezolvari && s.rezolvari.rezolvari)} sub={s.rezolvari ? `de ${nr(s.rezolvari.elevi, 'utilizator')}` : null} />
            <Tile label="Cereri AI" value={fmt(aiCereri)} sub={aiLei != null ? `cost: ${aiLei.toLocaleString('ro-RO', { maximumFractionDigits: 2 })} lei` : null} />
            <Tile label="Revin (retenție)" value={retPct == null ? '—' : `${retPct}%`} sub={ret && ret.inainte ? `${fmt(ret.auRevenit)} din ${fmt(ret.inainte)} activi în cele ${s.zile} zile dinainte` : 'apare după o perioadă întreagă de vizite'} />
            {s.misiuni && <Tile label="Misiuni zilnice îndeplinite" value={fmt(s.misiuni.indeplinite)} sub={`${nr(s.misiuni.elevi, 'elev')} cu misiuni în perioadă`} />}
          </div>

          {/* paginile văzute pe zi */}
          <Sectiune titlu="📈 Pagini văzute pe zi" nota="Treci cu mouse-ul (sau cu Tab) peste o coloană pentru detalii.">
            <Coloane
              date={peZile} eticheta={`Pagini văzute pe zi, ultimele ${s.zile} zile`}
              valoare={(d) => d.vizualizari}
              detaliu={(d) => `${fmtZi(d.zi)}: ${fmt(d.vizualizari)} pagini văzute · ${fmt(d.utilizatori)} utilizatori cu cont`}
              etichetaJos={(d) => fmtZi(d.zi)}
            />
            <details style={{ marginTop: 6, fontSize: '.78rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--navy)', fontWeight: 600 }}>Vezi tabelul zilelor</summary>
              <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}><th>Ziua</th><th style={{ textAlign: 'right' }}>Pagini văzute</th><th style={{ textAlign: 'right' }}>Utilizatori cu cont</th></tr></thead>
                  <tbody>
                    {[...peZile].reverse().map((d) => (
                      <tr key={d.zi} style={{ borderTop: '1px solid #eef1f5' }}>
                        <td>{fmtZi(d.zi)}</td><td style={{ textAlign: 'right' }}>{fmt(d.vizualizari)}</td><td style={{ textAlign: 'right' }}>{fmt(d.utilizatori)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Sectiune>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, marginTop: 12 }}>
            <Sectiune titlu="🔝 Cele mai vizitate pagini" nota="pagini văzute · persoane diferite">
              <Clasament randuri={(s.pagini || []).map((p) => ({ cheie: p.path, titlu: numePagina(p.path), detaliu: p.path !== numePagina(p.path) ? p.path : null, valoare: p.vizualizari, extra: `${fmt(p.persoane)} pers.` }))} />
            </Sectiune>

            <Sectiune titlu="📂 Cele mai accesate materiale" nota="deschideri de PDF-uri și exerciții interactive">
              <Clasament randuri={(s.materiale || []).map((m) => ({
                cheie: m.id, titlu: `${m.tip === 'pdf' ? '📄' : '🧩'} ${m.titlu || '(material șters)'}`, detaliu: m.categorie || null,
                valoare: m.deschideri, extra: `${fmt(m.persoane)} pers.`,
              }))} />
            </Sectiune>

            <Sectiune titlu="📝 Cele mai folosite teste" nota="rezolvate în perioadă: utilizatori diferiți · încercări · media">
              <Clasament gol="Niciun test rezolvat în perioada aceasta." randuri={(s.teste || []).map((t) => ({
                cheie: t.id, titlu: `${t.tip === 'pdf' ? '📄' : '🧩'} ${t.titlu || '(material șters)'}`, detaliu: t.categorie || null,
                valoare: t.elevi, extra: `${fmt(t.incercari)} înc.${t.medie != null ? ` · ${t.medie}%` : ''}`,
              }))} />
            </Sectiune>

            <Sectiune titlu="🤖 Funcțiile AI cele mai folosite" nota={aiLei != null ? 'cereri · persoane · cost (lei)' : 'cereri · persoane'}>
              <Clasament gol="Nicio cerere AI în perioada aceasta." randuri={ai.map((r) => ({
                cheie: r.functie, titlu: numeFunctieAI(r.functie), valoare: r.cereri,
                extra: `${fmt(r.persoane)} pers.${r.lei != null ? ` · ${Number(r.lei).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} lei` : ''}`,
              }))} />
            </Sectiune>
          </div>

          {/* utilizatorii care revin cel mai des / cu cele mai multe accesări — toți, pe pagini */}
          <div style={{ marginTop: 12 }}>
            <Sectiune titlu="🔁 Utilizatorii care revin cel mai des"
              nota={`Toți cei care au intrat pe site în ultimele ${s.zile} zile, câte 25 pe pagină. Zile active = zile diferite cu vizite. Vizitatorii fără cont apar doar dacă au acceptat cookie-urile. Adminii nu se numără.`}>
              <ListaVizitatori zile={s.zile} s={s} seg={seg} reincarcat={s.incarcatLa} />
            </Sectiune>
          </div>

          <div style={{ marginTop: 12 }}>
            <Sectiune titlu="🕐 Orele de vârf" nota="pagini văzute pe ore (ora României) — când învață elevii">
              <Coloane date={ore} inaltime={120} eticheta="Pagini văzute pe ore"
                valoare={(d) => d.vizualizari}
                detaliu={(d) => `${String(d.ora).padStart(2, '0')}:00–${String(d.ora).padStart(2, '0')}:59 · ${fmt(d.vizualizari)} pagini văzute`}
                etichetaJos={(d) => `${d.ora}:00`} etichetaFiecare={3} />
            </Sectiune>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, marginTop: 12 }}>
            <Sectiune titlu="📱 Dispozitive" nota="din paginile văzute">
              <Clasament randuri={Object.entries(disp).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({
                cheie: k, titlu: { telefon: '📱 Telefon', tableta: '📟 Tabletă', calculator: '💻 Calculator' }[k] || '❔ Necunoscut',
                valoare: n, extra: dispTotal ? `${Math.round((n / dispTotal) * 100)}%` : null,
              }))} />
            </Sectiune>

            <Sectiune titlu="🔗 De unde vin" nota="domeniul de pe care au ajuns pe site (prima pagină din vizită)">
              <Clasament gol="Nicio sursă externă înregistrată încă." randuri={(s.surse || []).map((r) => ({ cheie: r.sursa, titlu: r.sursa, valoare: r.vizite }))} />
            </Sectiune>

            <Sectiune titlu="👥 Conturile, pe rol" nota={`total: ${fmt(conturi.total)}`}>
              <Clasament randuri={Object.entries(conturi.peRol || {}).sort((a, b) => b[1] - a[1]).map(([r, n]) => ({
                cheie: r, titlu: ROLURI[r] ? ROLURI[r][0].toUpperCase() + ROLURI[r].slice(1) : r, valoare: n,
                extra: conturi.noiPeRol && conturi.noiPeRol[r] ? `+${fmt(conturi.noiPeRol[r])} noi` : null,
              }))} />
            </Sectiune>
          </div>

          {Array.isArray(s.lipsa) && s.lipsa.length > 0 && (
            <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 10 }}>
              Părți fără date (tabelă lipsă): {s.lipsa.join(', ')}.
            </div>
          )}
          <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            Vizitele sunt ale site-ului (nu Google Analytics): pagina, materialul deschis, dispozitivul. Vizitatorii fără cont
            primesc un id anonim doar dacă au acceptat cookie-urile; adminii nu se numără. Se păstrează 180 de zile.
          </div>
        </>
      )}
    </Rolldown>
  );
}
