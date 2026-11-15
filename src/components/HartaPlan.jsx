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
// Datele: api/_lib/planPregatire.js. Un clic pe un pas îl alege (onAlege) — pagina
// arată fișa lui, cu butoanele. Pagina are DOUĂ hărți (13 nov., după-amiaza) —
// 1 · exercițiile interactive, 2 · subiectele PDF cu barem; fiecare e o instanță a
// componentei, cu pasul ei (`plan` = harta: { noduri, etape, capitole, curent }).
// Legenda — doar la prima (`legenda`).
//
// 15 nov. 2026 — PE CAPITOLE, CU PICTOGRAME („Hărți cu pictograme, împărțită pe
// capitole, la fiecare capitol mai mulți pași"):
//   · harta e un drum de CAPITOLE: fiecare capitol are pictograma lui (src/lib/
//     pictograme.jsx) într-un inel care se umple cu pașii trecuți, titlul scris de mână,
//     „3 din 5" și, deschis, traseul pașilor lui; capitolele sunt legate între ele de o
//     linie punctată, ca pe o hartă. Deschise stau capitolul pasului curent și cel al
//     pasului ales; restul se deschid la clic;
//   · sus, „Capitolele tale": toate inelele, pe un rând (progresul pe capitole dintr-o
//     privire) — un clic deschide capitolul și duce la el;
//   · etapele (capitole cu exerciții / exerciții pe subiecte / teste; la clasă: clasa
//     aleasă și cele dinainte) rămân ca despărțituri între grupurile de capitole.
// Datele vechi (fără `capitole`): câte un capitol pe etapă, ca înainte.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import '@fontsource/caveat/700.css';
import { InelCapitol, CSS_INEL } from '../lib/pictograme';

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

// capitolele unei hărți: de pe server (15 nov. 2026) sau — la datele vechi — câte
// unul pe etapă; fiecare pas știe capitolul lui (`cap`)
export function capitoleDin(plan) {
  if (Array.isArray(plan?.capitole) && plan.capitole.length) return plan.capitole;
  return (plan?.etape || []).map((e) => ({
    id: e.id, etapa: e.id, titlu: e.titlu, icon: e.tip === 'pdf' ? 'varianta' : 'test',
    total: e.total, trecute: e.trecute, sarite: e.sarite || 0, curent: !!e.curenta,
    gata: e.total > 0 && e.trecute > 0 && e.trecute + (e.sarite || 0) >= e.total,
  }));
}
export const capitolulPasului = (n) => (n ? n.cap || n.etapa : null);
const ancora = (id) => `cap-${String(id || '').replace(/[^a-z0-9-]+/gi, '-')}`;
const pasi = (n) => (n === 1 ? 'un pas' : `${n} pași`);

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
  // până unde e „parcurs" traseul în capitolul ăsta: până la pasul curent (tot, dacă e în
  // urma lui; nimic, dacă e înaintea lui). Harta fără pas curent (gata sau, fără abonament,
  // cu ⭐): până la ultimul pas trecut sau sărit — nu și peste pașii încuiați
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

// „Capitolele tale": toate inelele, dintr-o privire — un clic duce la capitol
function SirCapitole({ capitole, onClic }) {
  const gata = capitole.filter((c) => c.gata).length;
  return (
    <div className="hp-sir">
      <div className="hp-sir-cap">
        <span>Capitolele tale</span>
        <b>{gata} din {capitole.length} {gata === 1 ? 'terminat' : 'terminate'}</b>
      </div>
      <div className="hp-sir-inele" role="list">
        {capitole.map((c) => (
          <button key={c.id} type="button" role="listitem" className={`hp-sir-b${c.curent ? ' curent' : ''}`} onClick={() => onClic(c)}
            aria-label={`${c.titlu}: ${c.trecute} din ${c.total}${c.gata ? ', terminat' : ''}${c.curent ? ', pasul tău e aici' : ''}`}
            title={`${c.titlu} · ${c.trecute} din ${c.total}`}>
            <InelCapitol c={c} size={36} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HartaPlan({ plan, alesId = null, onAlege = () => {}, legenda = true }) {
  const ref = useRef(null);
  const w = useLatime(ref);
  const cols = coloane(w - 8);
  const noduri = useMemo(() => (plan?.noduri || []).map((n, i) => ({ ...n, i })), [plan]);
  const curent = plan && plan.curent >= 0 ? noduri[plan.curent] : null;
  const ales = alesId ? noduri.find((n) => n.id === alesId) : null;
  const etape = plan?.etape || [];
  const capitole = useMemo(() => capitoleDin(plan), [plan]);
  const capCurent = capitolulPasului(curent);
  const capAles = capitolulPasului(ales);
  // deschise: capitolul pasului curent și al pasului ales (restul, la clic); fără pas curent:
  // primul capitol neterminat (fără abonament, cel cu ⭐); harta gata stă pliată (✓ pe inele)
  const [deschise, setDeschise] = useState(() => new Set());
  useEffect(() => {
    setDeschise((d) => {
      const n = new Set(d);
      if (capCurent) n.add(capCurent);
      if (capAles) n.add(capAles);
      const neterminat = capitole.find((c) => c.trecute + (c.sarite || 0) < c.total);
      if (!capCurent && neterminat && !n.size) n.add(neterminat.id);
      return n;
    });
  }, [capCurent, capAles, capitole.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!noduri.length) return null;
  const comuta = (id) => setDeschise((d) => { const n = new Set(d); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const duLa = (c) => {
    setDeschise((d) => new Set(d).add(c.id));
    setTimeout(() => { try { document.getElementById(ancora(c.id))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ } }, 60);
  };
  // grupurile de capitole, pe etape (despărțiturile apar doar când harta are mai multe etape)
  const peEtape = etape.map((et) => ({ et, caps: capitole.filter((c) => (c.etapa || et.id) === et.id && noduri.some((n) => capitolulPasului(n) === c.id)) }))
    .filter((g) => g.caps.length);
  const faraEtapa = capitole.filter((c) => !peEtape.some((g) => g.caps.includes(c)) && noduri.some((n) => capitolulPasului(n) === c.id));
  if (faraEtapa.length) peEtape.push({ et: null, caps: faraEtapa });
  const maiMulteEtape = peEtape.length > 1;

  return (
    <div className="hp" ref={ref}>
      <style>{CSS_INEL + CSS}</style>
      {legenda && (
        <ul className="hp-legenda" aria-label="Ce înseamnă semnele de pe hartă">
          <li><i className="hp-l trecut">✓</i> trecut</li>
          <li><i className="hp-l curent" /> pasul tău</li>
          <li><i className="hp-l incercat" /> încercat</li>
          <li><i className="hp-l inceput">⏸</i> neterminat</li>
          <li><i className="hp-l sarit">⏭</i> sărit</li>
          <li><i className="hp-l incuiat" /> urmează</li>
          <li><i className="hp-l inel" /> capitol: cât ai trecut din el</li>
        </ul>
      )}
      {capitole.length > 1 && <SirCapitole capitole={capitole} onClic={duLa} />}
      {peEtape.map(({ et, caps }) => (
        <div key={et ? et.id : 'fara-etapa'} className="hp-grup">
          {maiMulteEtape && et && (
            <div className={`hp-etapa-sep${et.curenta ? ' curenta' : ''}`}>
              <span>{et.titlu}</span>
              <b>{et.trecute} din {et.total}</b>
            </div>
          )}
          {caps.map((c) => {
            const ale = noduri.filter((n) => capitolulPasului(n) === c.id);
            const deschis = deschise.has(c.id);
            return (
              <section key={c.id} id={ancora(c.id)} className={`hp-capitol${c.curent ? ' curent' : ''}${c.gata ? ' gata' : ''}`}>
                <button type="button" className="hp-cap" onClick={() => comuta(c.id)} aria-expanded={deschis}>
                  <InelCapitol c={c} size={48} />
                  <span className="hp-cap-txt">
                    <span className="hp-cap-titlu">{c.titlu}</span>
                    <span className="hp-cap-sub">
                      {c.trecute} din {pasi(c.total)}
                      {c.curent ? <em> · pasul tău e aici</em> : c.gata ? ' · 🏁 gata' : ''}
                    </span>
                    <span className="hp-cap-bara" aria-hidden="true"><span style={{ width: `${c.total ? Math.round((c.trecute / c.total) * 100) : 0}%` }} /></span>
                  </span>
                  <span className="hp-cap-sag" aria-hidden="true">{deschis ? '▴' : '▾'}</span>
                </button>
                {deschis && (
                  <div className="hp-foaie">
                    <Grila noduri={ale} cols={cols} curentId={curent?.id || null} alesId={alesId} onAlege={onAlege} iCurent={plan.curent} />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ))}
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
.hp-l.inel{background:conic-gradient(var(--hp-cerneala) 60%,rgba(15,43,68,.14) 0);position:relative}
.hp-l.inel::after{content:"";position:absolute;inset:3px;border-radius:50%;background:#fff}
.hp-sir{background:var(--hp-hartie);border:1px solid var(--cream-dark);border-radius:14px;padding:10px 12px 12px;margin-bottom:14px}
.hp-sir-cap{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.hp-sir-cap span{font-family:"Caveat",cursive;font-weight:700;font-size:1.25rem;color:var(--hp-cerneala);line-height:1}
.hp-sir-cap b{font-size:.74rem;color:var(--text-light)}
.hp-sir-inele{display:flex;flex-wrap:wrap;gap:8px}
.hp-sir-b{border:none;background:none;padding:2px;border-radius:50%;cursor:pointer;line-height:0}
.hp-sir-b:hover .inel-cap{transform:scale(1.08)}
.hp-sir-b .inel-cap{transition:transform .15s ease}
.hp-sir-b:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.hp-grup + .hp-grup{margin-top:16px}
.hp-etapa-sep{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 2px 8px;padding-bottom:4px;border-bottom:1.5px dashed var(--cream-dark);font-size:.78rem;font-weight:800;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em}
.hp-etapa-sep b{text-transform:none;letter-spacing:0;white-space:nowrap}
.hp-etapa-sep.curenta span{color:var(--gold-dim)}
.hp-capitol{position:relative;border-radius:16px;margin-bottom:12px;background:var(--hp-hartie);border:1px solid var(--cream-dark)}
.hp-capitol + .hp-capitol::before{content:"";position:absolute;left:37px;top:-13px;height:13px;border-left:2.5px dotted var(--hp-creion)}
.hp-capitol.gata + .hp-capitol::before{border-left-color:var(--hp-cerneala);border-left-style:solid}
.hp-capitol.curent{border-color:rgba(232,185,49,.75);box-shadow:0 2px 14px rgba(232,185,49,.2)}
.hp-cap{width:100%;display:flex;align-items:center;gap:12px;padding:10px 14px;border:none;background:transparent;cursor:pointer;text-align:left;font-family:var(--font-body);border-radius:16px}
.hp-cap-txt{flex:1;min-width:0;display:grid;gap:2px}
.hp-cap-titlu{font-family:"Caveat",cursive;font-weight:700;font-size:1.38rem;line-height:1.08;color:var(--hp-cerneala);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hp-cap-sub{font-size:.76rem;font-weight:800;color:var(--text-light)}
.hp-cap-sub em{font-style:normal;color:var(--gold-dim)}
.hp-cap-bara{display:block;height:5px;border-radius:99px;background:rgba(15,43,68,.08);overflow:hidden;max-width:260px}
.hp-cap-bara span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--hp-cerneala),var(--navy-light))}
.hp-capitol.curent .hp-cap-bara span{background:linear-gradient(90deg,var(--gold-dim),var(--gold))}
.hp-cap-sag{font-size:.8rem;color:var(--text-muted)}
.hp-cap:focus-visible,.hp-nod:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.hp-foaie{position:relative;overflow-x:auto;padding:2px 0 8px;background-color:var(--hp-hartie);background-image:linear-gradient(var(--hp-patrat) 1px,transparent 1px),linear-gradient(90deg,var(--hp-patrat) 1px,transparent 1px);background-size:18px 18px;border-top:1px dashed var(--cream-dark);border-radius:0 0 16px 16px}
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
@media (prefers-reduced-motion: reduce){.hp-nod.curent{animation:none;box-shadow:0 0 0 4px rgba(232,185,49,.45)}.hp-nod{transition:none}.hp-sir-b .inel-cap{transition:none}}
@media (max-width:520px){.hp-cap{padding:9px 10px;gap:10px}.hp-cap-titlu{font-size:1.2rem}.hp-capitol + .hp-capitol::before{left:33px}.hp-foaie::before{left:27px}}
`;
