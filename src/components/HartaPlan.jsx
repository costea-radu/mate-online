// =====================================================================
// src/components/HartaPlan.jsx — „🗺️ HARTA PREGĂTIRII" (13 nov. 2026)
//
// Planul de parcurs din „🎯 Pregătește-mă de examen", desenat ca un traseu pe o
// pagină de caiet de matematică (pătrățele + marginea roșie): pașii sunt puncte
// numerotate, legate în ordine (rând după rând, în șerpuire). Cercul = exercițiu
// interactiv, pătratul rotunjit = test PDF.
//   ✓ bleumarin  — trecut          ● auriu (pulsează) — pasul tău de acum
//   ◯ cu roșu    — încercat (×n)   ⏸ — început, neterminat
//   ⏭ punctat    — sărit           ⭐ — cu Premium        · creion — urmează (încuiat)
// Etapele (capitole → exerciții pe subiecte → teste interactive; la clasă: clasa
// aleasă și cele dinainte) sunt notițe pe margine, cu câți pași s-au trecut; se
// pliază — deschisă stă etapa pasului curent. Datele: api/_lib/planPregatire.js.
// Un clic pe un pas îl alege (onAlege) — pagina arată fișa lui, cu butoanele.
// 13 nov. 2026 (după-amiaza): pagina are DOUĂ hărți — 1 · exercițiile interactive,
// 2 · subiectele PDF cu barem; fiecare e o instanță a componentei, cu pasul ei
// (`plan` = harta: { noduri, etape, curent }). Legenda — doar la prima (`legenda`).
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/caveat/700.css';

const PAS = 58;      // distanța dintre două puncte pe rând
const RAND = 66;     // distanța dintre rânduri
const NOD = 42;      // diametrul unui punct
const MARG = 24;     // marginea grilei

// adresa unui pas (aceeași formă ca pe server: api/_lib/planPregatire.js → urlPas)
export function urlPas(n, mod = null) {
  if (!n || !n.id) return null;
  const id = encodeURIComponent(n.id);
  if (n.tip === 'pdf') return `/pdf-viewer?id=${id}&pregatire=1&plan=1${mod ? `&mod=${encodeURIComponent(mod)}` : ''}`;
  return `/exercitiu?id=${id}&pregatire=1&plan=1`;
}

// coloanele unei grile de lățimea `w` (4 … 10)
export function coloane(w) {
  const c = Math.floor((Math.max(0, Number(w) || 0) - 2 * MARG) / PAS);
  return Math.max(4, Math.min(10, c || 4));
}

// pozițiile punctelor, în șerpuire: rândurile pare de la stânga, cele impare de la dreapta
export function pozitii(n, cols) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), k = i % cols;
    const c = r % 2 === 0 ? k : cols - 1 - k;
    out.push({ x: MARG + c * PAS + PAS / 2, y: MARG + r * RAND + RAND / 2, r, c });
  }
  return out;
}

// traseul dintre punctele [de, pana]: drept pe rând, cu o buclă la capătul rândului
export function traseu(pts, de, pana) {
  if (!pts.length || pana < de) return '';
  let d = '';
  for (let i = Math.max(0, de); i <= Math.min(pana, pts.length - 1); i++) {
    const p = pts[i];
    if (i === Math.max(0, de)) { d += `M${p.x} ${p.y}`; continue; }
    const q = pts[i - 1];
    if (q.r === p.r) d += ` L${p.x} ${p.y}`;
    else {
      const k = PAS * 0.62 * (q.c === 0 ? -1 : 1);   // bucla iese spre margine
      d += ` C${q.x + k} ${q.y}, ${p.x + k} ${p.y}, ${p.x} ${p.y}`;
    }
  }
  return d;
}

// cum arată un pas (clasa CSS, ce scrie în el, eticheta pentru cititorul de ecran)
export function aspect(n, curentId) {
  const nr = n.i + 1;
  if (!n.accesibil && n.stare !== 'trecut') return { cls: 'premium', txt: nr, eticheta: 'cu Premium' };
  if (n.id === curentId) return { cls: n.stare === 'inceput' ? 'curent inceput' : n.stare === 'incercat' ? 'curent incercat' : 'curent', txt: nr, eticheta: 'pasul tău de acum' };
  if (n.stare === 'trecut') return { cls: 'trecut', txt: '✓', eticheta: `trecut${n.pct != null ? `, ${n.pct}%` : ''}` };
  if (n.stare === 'sarit') return { cls: 'sarit', txt: '⏭', eticheta: 'sărit' };
  if (n.stare === 'incercat') return { cls: 'incercat', txt: nr, eticheta: `încercat de ${n.incercari} ori, ${n.pct}%` };
  if (n.stare === 'inceput') return { cls: 'inceput', txt: '⏸', eticheta: 'început, neterminat' };
  if (!n.deschis) return { cls: 'incuiat', txt: nr, eticheta: 'urmează' };
  return { cls: 'liber', txt: nr, eticheta: 'neînceput' };
}

function useLatime(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const masoara = () => setW(el.clientWidth || 0);
    masoara();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', masoara);
      return () => window.removeEventListener('resize', masoara);
    }
    const ro = new ResizeObserver(masoara);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Grila({ noduri, cols, curentId, alesId, onAlege, iCurent }) {
  const pts = useMemo(() => pozitii(noduri.length, cols), [noduri.length, cols]);
  const randuri = Math.ceil(noduri.length / cols);
  const W = 2 * MARG + cols * PAS;
  const H = 2 * MARG + randuri * RAND - (RAND - NOD) / 2;
  // până unde e „parcurs" traseul în etapa asta: până la pasul curent (toată, dacă e în urma
  // lui; nimic, dacă e înaintea lui). Harta fără pas curent (gata sau, fără abonament, cu ⭐):
  // până la ultimul pas trecut sau sărit — nu și peste pașii încuiați
  const kCurent = noduri.findIndex((n) => n.id === curentId);
  let parcurs = -1;
  if (kCurent >= 0) parcurs = kCurent;
  else if (iCurent >= 0) parcurs = noduri.length && noduri[noduri.length - 1].i < iCurent ? noduri.length - 1 : -1;
  else noduri.forEach((n, k) => { if (n.stare === 'trecut' || n.stare === 'sarit') parcurs = k; });
  return (
    <div className="hp-grila" style={{ width: W, height: H }}>
      <svg className="hp-traseu" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <path d={traseu(pts, 0, noduri.length - 1)} className="hp-creion" />
        {parcurs >= 0 && <path d={traseu(pts, 0, parcurs)} className="hp-cerneala" />}
      </svg>
      {noduri.map((n, k) => {
        const a = aspect(n, curentId);
        const p = pts[k];
        return (
          <button
            key={n.id}
            type="button"
            id={`pas-${n.id}`}
            className={`hp-nod ${n.tip === 'pdf' ? 'pdf' : 'int'} ${a.cls}${n.id === alesId ? ' ales' : ''}`}
            style={{ left: p.x - NOD / 2, top: p.y - NOD / 2 }}
            onClick={() => onAlege(n)}
            aria-label={`Pasul ${n.i + 1}${n.tip === 'pdf' ? ' (subiect PDF)' : ''}: ${n.titlu} — ${a.eticheta}`}
            aria-pressed={n.id === alesId}
            title={`${n.i + 1}. ${n.titlu}`}
          >
            <span className="hp-txt">{a.txt}</span>
            {n.stare === 'incercat' && n.id !== curentId && n.accesibil && <span className="hp-ins hp-ins-inc">×{n.incercari}</span>}
            {n.id === curentId && n.incercari > 0 && <span className="hp-ins hp-ins-inc">×{n.incercari}</span>}
            {!n.accesibil && n.stare !== 'trecut' && <span className="hp-ins hp-ins-stea" aria-hidden="true">⭐</span>}
            {n.nou && <span className="hp-ins hp-ins-nou">nou</span>}
          </button>
        );
      })}
    </div>
  );
}

export default function HartaPlan({ plan, alesId = null, onAlege = () => {}, legenda = true }) {
  const ref = useRef(null);
  const w = useLatime(ref);
  const cols = coloane(w);
  const noduri = useMemo(() => (plan?.noduri || []).map((n, i) => ({ ...n, i })), [plan]);
  const curent = plan && plan.curent >= 0 ? noduri[plan.curent] : null;
  const ales = alesId ? noduri.find((n) => n.id === alesId) : null;
  const etape = plan?.etape || [];
  // deschise: etapa pasului curent și a pasului ales (restul, la clic); fără pas curent:
  // prima etapă neterminată (fără abonament, cea cu ⭐); harta gata stă pliată (🏁 pe etape)
  const [deschise, setDeschise] = useState(() => new Set());
  useEffect(() => {
    setDeschise((d) => {
      const n = new Set(d);
      if (curent) n.add(curent.etapa);
      if (ales) n.add(ales.etapa);
      const neterminata = etape.find((e) => e.trecute + e.sarite < e.total);
      if (!curent && neterminata && !n.size) n.add(neterminata.id);
      return n;
    });
  }, [curent?.etapa, ales?.etapa, etape.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!noduri.length) return null;
  const comuta = (id) => setDeschise((d) => { const n = new Set(d); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="hp" ref={ref}>
      <style>{CSS}</style>
      {legenda && (
        <ul className="hp-legenda" aria-label="Ce înseamnă semnele de pe hartă">
          <li><i className="hp-l trecut">✓</i> trecut</li>
          <li><i className="hp-l curent" /> pasul tău</li>
          <li><i className="hp-l incercat" /> încercat</li>
          <li><i className="hp-l inceput">⏸</i> neterminat</li>
          <li><i className="hp-l sarit">⏭</i> sărit</li>
          <li><i className="hp-l incuiat" /> urmează</li>
        </ul>
      )}
      {etape.map((et, k) => {
        const ale = noduri.filter((n) => n.etapa === et.id);
        if (!ale.length) return null;
        const deschisa = deschise.has(et.id);
        const gata = et.total > 0 && et.trecute > 0 && et.trecute + et.sarite >= et.total;   // 🏁 doar etapa parcursă toată
        const pct = et.total ? Math.round((et.trecute / et.total) * 100) : 0;
        return (
          <section key={et.id} className={`hp-etapa${et.curenta ? ' curenta' : ''}${gata ? ' gata' : ''}`}>
            <button type="button" className="hp-cap" onClick={() => comuta(et.id)} aria-expanded={deschisa}>
              <span className="hp-cap-nr">{gata ? '🏁' : `${k + 1}.`}</span>
              <span className="hp-cap-titlu">{et.titlu}</span>
              <span className="hp-cap-cont">{et.trecute} din {et.total}</span>
              <span className="hp-cap-bara" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
              <span className="hp-cap-sag" aria-hidden="true">{deschisa ? '▴' : '▾'}</span>
            </button>
            {deschisa && (
              <div className="hp-foaie">
                <Grila noduri={ale} cols={cols} curentId={curent?.id || null} alesId={alesId} onAlege={onAlege} iCurent={plan.curent} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const CSS = `
.hp{--hp-hartie:#fdfbf4;--hp-patrat:rgba(15,43,68,.075);--hp-margine:rgba(198,40,40,.42);--hp-cerneala:#0f2b44;--hp-creion:#b9c0cb;--hp-rosu:#c62828;position:relative}
.hp-legenda{list-style:none;display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 12px;padding:0;font-size:.76rem;color:var(--text-light)}
.hp-legenda li{display:inline-flex;align-items:center;gap:6px}
.hp-l{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:.62rem;font-weight:800;box-sizing:border-box}
.hp-l.trecut{background:var(--hp-cerneala);color:#fff}
.hp-l.curent{background:var(--gold);box-shadow:0 0 0 3px rgba(232,185,49,.35)}
.hp-l.incercat{border:2.5px solid var(--hp-rosu);background:#fff}
.hp-l.inceput{border:2px dashed var(--gold-dim);background:#fff;color:var(--gold-dim)}
.hp-l.sarit{border:2px dashed var(--hp-cerneala);background:#fff;color:var(--hp-cerneala);font-size:.55rem}
.hp-l.incuiat{border:1.5px dashed var(--hp-creion);background:transparent}
.hp-etapa{border-radius:14px;margin-bottom:10px;background:var(--hp-hartie);border:1px solid var(--cream-dark);overflow:hidden}
.hp-etapa.curenta{border-color:rgba(232,185,49,.7);box-shadow:0 2px 14px rgba(232,185,49,.18)}
.hp-cap{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"titlu cont" "bara sag";align-items:center;gap:2px 10px;padding:10px 14px 10px 44px;border:none;background:transparent;cursor:pointer;text-align:left;position:relative;font-family:var(--font-body)}
.hp-cap::before{content:"";position:absolute;left:30px;top:0;bottom:0;width:1.5px;background:var(--hp-margine)}
.hp-cap-nr{position:absolute;left:4px;top:50%;transform:translateY(-50%);font-family:"Caveat",cursive;font-size:1.35rem;font-weight:700;color:var(--hp-rosu);width:22px;text-align:center}
.hp-etapa.gata .hp-cap-nr{font-family:inherit;font-size:1rem}
.hp-cap-titlu{grid-area:titlu;font-family:"Caveat",cursive;font-weight:700;font-size:1.32rem;line-height:1.1;color:var(--hp-cerneala);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hp-cap-cont{grid-area:cont;font-size:.76rem;font-weight:800;color:var(--text-light);white-space:nowrap}
.hp-cap-bara{grid-area:bara;display:block;height:5px;border-radius:99px;background:rgba(15,43,68,.08);overflow:hidden}
.hp-cap-bara span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--hp-cerneala),var(--navy-light))}
.hp-cap-sag{grid-area:sag;font-size:.8rem;color:var(--text-muted);justify-self:end}
.hp-cap:focus-visible,.hp-nod:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.hp-foaie{position:relative;overflow-x:auto;padding:2px 0 8px;background-color:var(--hp-hartie);background-image:linear-gradient(var(--hp-patrat) 1px,transparent 1px),linear-gradient(90deg,var(--hp-patrat) 1px,transparent 1px);background-size:18px 18px;border-top:1px dashed var(--cream-dark)}
.hp-foaie::before{content:"";position:absolute;left:30px;top:0;bottom:0;width:1.5px;background:var(--hp-margine);pointer-events:none}
.hp-grila{position:relative;margin:0 auto}
.hp-traseu{position:absolute;inset:0;pointer-events:none}
.hp-creion{fill:none;stroke:var(--hp-creion);stroke-width:2.2;stroke-dasharray:2 6;stroke-linecap:round}
.hp-cerneala{fill:none;stroke:var(--hp-cerneala);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.hp-nod{position:absolute;width:${NOD}px;height:${NOD}px;border-radius:50%;border:2px solid var(--hp-cerneala);background:#fff;color:var(--hp-cerneala);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.8rem;font-family:var(--font-body);cursor:pointer;padding:0;transition:transform .15s ease;box-sizing:border-box}
.hp-nod.pdf{border-radius:11px}
.hp-nod:hover{transform:scale(1.08)}
.hp-nod.trecut{background:var(--hp-cerneala);color:#fff;font-size:1rem}
.hp-nod.incercat{border:3px solid var(--hp-rosu);color:var(--hp-rosu)}
.hp-nod.inceput{border:2.5px dashed var(--gold-dim);color:var(--gold-dim);font-size:.9rem}
.hp-nod.sarit{border:2px dashed var(--hp-cerneala);color:var(--hp-cerneala);font-size:.85rem;background:rgba(255,255,255,.7)}
.hp-nod.incuiat{border:1.5px dashed var(--hp-creion);color:#9aa3b0;background:rgba(253,251,244,.85);font-weight:700}
.hp-nod.premium{border:1.5px solid #e6d9a8;color:#b3a26a;background:rgba(253,251,244,.9);font-weight:700}
.hp-nod.liber{border:2px solid var(--hp-cerneala)}
.hp-nod.curent{background:var(--gold);border:none;color:var(--navy);font-size:.95rem;box-shadow:0 0 0 0 rgba(232,185,49,.55);animation:hpPuls 1.8s ease-out infinite;z-index:2}
.hp-nod.curent.incercat{box-shadow:0 0 0 3px var(--hp-rosu)}
.hp-nod.ales{outline:3px solid rgba(15,43,68,.35);outline-offset:3px}
.hp-ins{position:absolute;font-style:normal;line-height:1;pointer-events:none}
.hp-ins-inc{right:-7px;top:-6px;background:var(--hp-rosu);color:#fff;font-size:.58rem;font-weight:800;border-radius:99px;padding:2px 4px}
.hp-ins-stea{right:-6px;top:-7px;font-size:.7rem}
.hp-ins-nou{left:50%;transform:translateX(-50%);bottom:-12px;background:#2e7d32;color:#fff;font-size:.55rem;font-weight:800;border-radius:99px;padding:2px 5px;letter-spacing:.02em}
@keyframes hpPuls{0%{box-shadow:0 0 0 0 rgba(232,185,49,.6)}70%{box-shadow:0 0 0 12px rgba(232,185,49,0)}100%{box-shadow:0 0 0 0 rgba(232,185,49,0)}}
@media (prefers-reduced-motion: reduce){.hp-nod.curent{animation:none;box-shadow:0 0 0 4px rgba(232,185,49,.45)}.hp-nod{transition:none}}
@media (max-width:520px){.hp-cap{padding-left:40px}.hp-cap::before,.hp-foaie::before{left:27px}.hp-cap-titlu{font-size:1.18rem}}
`;
