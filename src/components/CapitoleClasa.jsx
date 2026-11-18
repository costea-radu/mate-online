// =====================================================================
// src/components/CapitoleClasa.jsx — fila unei clase, PE CAPITOLE (18 nov. 2026)
//
// „Împarte pe capitole lecțiile din «clase». Pune acele pictograme ca la hartă și la bareme."
//
// În paginile claselor (src/pages/ClassPage.jsx → ContentPage, prop-ul `capitole`), filele
// „🧩 Exerciții Interactive" și „📄 Exerciții PDF" își așază materialele pe capitole —
// aceleași ca pe „🗺️ Harta pregătirii" și în fila „📋 Bareme" (src/lib/capitoleClasa.js).
//   • sus, „Capitolele clasei": inelele tuturor capitolelor (pictograma capitolului în
//     inelul lui de progres, ca pe hartă — src/lib/pictograme.jsx); un clic deschide
//     capitolul și duce la el; „Deschide toate" / „Închide toate";
//   • fiecare capitol: inelul (cât a trecut elevul din el, ✓ când l-a terminat), titlul,
//     câte materiale are și câte a trecut, ▾ — se deschide / se închide. E un <details>:
//     materialele rămân în pagină, iar căutarea din browser (Ctrl+F) deschide singură
//     capitolul în care găsește;
//   • la intrare e deschis primul capitol neterminat (vizitatorului — primul capitol); ce
//     deschide / închide elevul se ține minte cât e deschis tab-ul (sessionStorage, pe
//     clasă și filă); la întoarcerea dintr-un exercițiu, capitolul lui e deschis, ca
//     revenirea la card (src/lib/scrollToCard.js) să-l găsească.
// Cardurile le desenează pagina (`render` — ContentCard din ContentPage).
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { InelCapitol, CSS_INEL } from '../lib/pictograme.jsx';
import { peCapitole, deschiseLaIntrare, subtitluCapitol } from '../lib/capitoleClasa.js';

const citeste = (cheie) => {
  try {
    const v = JSON.parse(sessionStorage.getItem(cheie) || 'null');
    return Array.isArray(v) ? v : null;
  } catch { return null; }
};
const scrie = (cheie, set) => {
  try { sessionStorage.setItem(cheie, JSON.stringify([...set])); } catch { /* fără stocare: doar nu se ține minte */ }
};
const ancora = (tip, id) => `capitol-${tip}-${id}`;
const procent = (c) => (c.total ? Math.round((c.trecute / c.total) * 100) : 0);

export default function CapitoleClasa({ category, tip, items, progres = null, progresGata = true, cardId = null, render }) {
  const caps = useMemo(() => peCapitole(items, category, tip, progres), [items, category, tip, progres]);
  const cuProgres = !!progres;
  const cheie = `em_capitole:${category}:${tip}`;
  // `null` = încă nu știm ce deschidem: elevul logat, fără nimic ținut minte, așteaptă
  // progresul (primul capitol neterminat) — cel mult 1,5 s
  const [deschise, setDeschise] = useState(() => {
    const salvate = citeste(cheie);
    if (salvate || cardId || !cuProgres || progresGata) return deschiseLaIntrare(caps, { salvate, cardId, cuProgres });
    return null;
  });
  const atins = useRef(false);             // a deschis / închis elevul ceva → se ține minte
  const curente = useRef(deschise);
  curente.current = deschise;

  useEffect(() => {
    if (deschise !== null) return undefined;
    if (progresGata) { setDeschise(deschiseLaIntrare(caps, { cuProgres })); return undefined; }
    const t = setTimeout(() => setDeschise((d) => d || deschiseLaIntrare(caps, { cuProgres })), 1500);
    return () => clearTimeout(t);
  }, [deschise, progresGata, caps, cuProgres]);

  useEffect(() => { if (atins.current && deschise) scrie(cheie, deschise); }, [deschise, cheie]);

  const seteaza = (fn) => { atins.current = true; setDeschise((d) => fn(new Set(d || []))); };
  // <details> se deschide / se închide singur la clic pe titlu; luăm starea de acolo doar când
  // diferă de a noastră (și deschiderile făcute de pagină anunță „toggle")
  const laToggle = (id) => (e) => {
    const acum = e.currentTarget.open;
    if (acum === !!(curente.current && curente.current.has(id))) return;
    seteaza((n) => { if (acum) n.add(id); else n.delete(id); return n; });
  };
  const duLa = (id) => {
    seteaza((n) => n.add(id));
    setTimeout(() => {
      try { document.getElementById(ancora(tip, id))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ }
    }, 60);
  };
  const toate = !!deschise && caps.length > 0 && caps.every((c) => deschise.has(c.id));
  const terminate = caps.filter((c) => c.gata).length;

  return (
    <div className="cc">
      <style>{CSS_INEL + CSS}</style>
      {caps.length > 1 && (
        <div className="cc-sir">
          <div className="cc-sir-cap">
            <b>Capitolele clasei</b>
            <small>{cuProgres && terminate ? `${terminate} din ${caps.length} terminate` : `${caps.length} capitole`}</small>
          </div>
          <div className="cc-sir-inele">
            {caps.map((c) => (
              <button key={c.id} type="button" className="cc-sir-b" onClick={() => duLa(c.id)}
                title={`${c.titlu} · ${subtitluCapitol(c, tip, cuProgres)}`}
                aria-label={`${c.titlu}: ${subtitluCapitol(c, tip, cuProgres)}`}>
                <InelCapitol c={c} size={34} />
              </button>
            ))}
          </div>
          <button type="button" className="cc-toate" aria-pressed={toate}
            onClick={() => seteaza(() => (toate ? new Set() : new Set(caps.map((c) => c.id))))}>
            {toate ? '▴ Închide toate' : '▾ Deschide toate'}
          </button>
        </div>
      )}
      {caps.map((c) => (
        <details key={c.id} id={ancora(tip, c.id)} className={`cc-cap${c.gata ? ' gata' : ''}`}
          open={!!deschise && deschise.has(c.id)} onToggle={laToggle(c.id)}>
          <summary className="cc-cap-h">
            <span className="cc-cap-rand">
              <InelCapitol c={c} size={44} />
              <span className="cc-cap-txt">
                <span className="cc-cap-titlu">{c.titlu}</span>
                <span className="cc-cap-sub">{subtitluCapitol(c, tip, cuProgres)}</span>
                {cuProgres && <span className="cc-cap-bara" aria-hidden="true"><span style={{ width: `${procent(c)}%` }} /></span>}
              </span>
              <span className="cc-cap-sag" aria-hidden="true">▾</span>
            </span>
          </summary>
          <div className="cc-cap-lista">{c.items.map(render)}</div>
        </details>
      ))}
    </div>
  );
}

// flex-ul stă pe un <span> din <summary> (Safari mai vechi nu face flex pe <summary>);
// pe telefon: titlul șirului și „Deschide toate" pe un rând, inelele (mai mici) dedesubt
const CSS = `
.cc{margin-top:8px}
.cc-sir{display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px;background:#fdfbf4;border:1px solid var(--cream-dark);border-radius:14px;padding:10px 14px;margin-bottom:14px}
.cc-sir-cap{display:grid;gap:1px}
.cc-sir-cap b{font-family:var(--font-display);font-size:1rem;line-height:1.15;color:var(--navy)}
.cc-sir-cap small{font-size:.72rem;font-weight:700;color:var(--text-light)}
.cc-sir-inele{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 220px;min-width:0}
.cc-sir-b{border:none;background:none;padding:2px;border-radius:50%;cursor:pointer;line-height:0}
.cc-sir-b .inel-cap{transition:transform .15s ease}
.cc-sir-b:hover .inel-cap{transform:scale(1.08)}
.cc-toate{border:1.5px solid var(--cream-dark);background:#fff;color:var(--navy);border-radius:99px;padding:6px 14px;font-size:.78rem;font-weight:700;font-family:var(--font-body);cursor:pointer;white-space:nowrap}
.cc-toate:hover{border-color:var(--gold)}
.cc-cap{background:#fdfbf4;border:1px solid var(--cream-dark);border-radius:14px;margin-bottom:10px;scroll-margin-top:84px}
.cc-cap.gata{border-color:rgba(46,125,50,.3)}
.cc-cap-h{list-style:none;cursor:pointer;border-radius:14px}
.cc-cap-h::-webkit-details-marker{display:none}
.cc-cap-h::marker{content:""}
.cc-cap-rand{display:flex;align-items:center;gap:12px;padding:10px 14px}
.cc-cap-txt{flex:1;min-width:0;display:grid;gap:3px}
.cc-cap-titlu{font-family:var(--font-display);font-weight:600;font-size:1.06rem;line-height:1.2;color:var(--navy)}
.cc-cap-h:hover .cc-cap-titlu{text-decoration:underline;text-decoration-color:var(--gold);text-underline-offset:3px}
.cc-cap-sub{font-size:.76rem;font-weight:700;color:var(--text-light)}
.cc-cap-bara{display:block;height:5px;max-width:260px;border-radius:99px;background:rgba(15,43,68,.08);overflow:hidden}
.cc-cap-bara span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--navy),var(--navy-light))}
.cc-cap.gata .cc-cap-bara span{background:#2e7d32}
.cc-cap-sag{flex-shrink:0;font-size:.85rem;color:var(--text-muted);transition:transform .2s ease}
.cc-cap[open] > .cc-cap-h .cc-cap-sag{transform:rotate(180deg)}
.cc-cap-h:focus-visible,.cc-sir-b:focus-visible,.cc-toate:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.cc-cap-lista{padding:10px 12px 4px;border-top:1px dashed var(--cream-dark)}
@media (max-width:620px){
  .cc-sir{padding:10px 12px;gap:8px 10px}
  .cc-sir-cap{flex:1 1 auto}
  .cc-toate{order:2;padding:5px 11px}
  .cc-sir-inele{order:3;flex:1 1 100%;gap:4px}
  .cc-sir-b .inel-cap{width:30px!important;height:30px!important}
  .cc-cap-rand{gap:10px;padding:9px 10px}
  .cc-cap-titlu{font-size:1rem}
  .cc-cap-lista{padding:8px 6px 2px}
}
@media (prefers-reduced-motion:reduce){.cc-cap-sag,.cc-sir-b .inel-cap{transition:none}}
`;
