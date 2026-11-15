// =====================================================================
// src/lib/pictograme.jsx — PICTOGRAMELE capitolelor din „🗺️ Harta pregătirii"
// (15 nov. 2026 — „Hărți cu pictograme, împărțită pe capitole")
//
// Un set mic de desene SVG (24 × 24, linie de 1,8, colțuri rotunjite), în stilul
// site-ului: cerneala bleumarin (currentColor), fără culori proprii — culoarea o dă
// locul în care stau (inelul capitolului, cipul din „Rezultate"). Cheile vin de pe
// server: api/_lib/capitoleHarta.js (`icon`) și api/_lib/planPregatire.js (subiectele
// I / II / III, testele, variantele, simulările, „Alte exerciții").
//   <Pictograma nume="radical" size={22} />
//   <InelCapitol c={{ icon, total, trecute, gata, curent }} size={44} />  — pictograma în
//     inelul de progres al capitolului (cât s-a trecut din pașii lui)
// =====================================================================

const T = ({ children, size = 11, y = 16, style = 'normal', weight = 800 }) => (
  <text x="12" y={y} textAnchor="middle" fontSize={size} fontWeight={weight} fontStyle={style}
    fontFamily="var(--font-body, system-ui), sans-serif" fill="currentColor" stroke="none">{children}</text>
);
const Pct = ({ x, y, r = 1.3 }) => <circle cx={x} cy={y} r={r} fill="currentColor" stroke="none" />;

// fiecare pictogramă: conținutul unui <svg viewBox="0 0 24 24">
export const ICONURI = {
  naturale: <T size={9.5}>123</T>,
  metode: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.4c.8.8 1 1.6 1 2.6h6c0-1 .2-1.8 1-2.6A6 6 0 0 0 12 3z" />,
  divizibilitate: <><path d="M5 12h14" /><Pct x={12} y={6.5} r={1.7} /><Pct x={12} y={17.5} r={1.7} /></>,
  fractii: <><T size={8} y={9.5}>3</T><path d="M7.5 12h9" /><T size={8} y={20.5}>4</T></>,
  zecimale: <T size={9.5}>0,5</T>,
  masura: <><path d="M3 16.5 16.5 3 21 7.5 7.5 21z" /><path d="m7 12.5 2 2M10 9.5l1.6 1.6M13 6.5l2 2" /></>,
  date: <><path d="M3 21h18" /><rect x="5" y="12" width="3.2" height="8" rx=".6" /><rect x="10.4" y="6.5" width="3.2" height="13.5" rx=".6" /><rect x="15.8" y="9.5" width="3.2" height="10.5" rx=".6" /></>,
  rationale: <T size={9} style="italic">p/q</T>,
  intregi: <path d="M12 4v8M8 8h8M8 17.5h8" />,
  procent: <><circle cx="7.5" cy="7.5" r="2.6" /><circle cx="16.5" cy="16.5" r="2.6" /><path d="M18.5 5.5 5.5 18.5" /></>,
  multimi: <><circle cx="9" cy="12" r="6" /><circle cx="15" cy="12" r="6" /></>,
  triunghi: <path d="M12 4.5 20.5 19h-17z" />,
  cerc: <><circle cx="12" cy="12" r="8" /><path d="M12 12 18 8.2" /><Pct x={12} y={12} r={1.3} /></>,
  unghi: <><path d="M4 19h16M4 19 15 5.5" /><path d="M10 19a6 6 0 0 0-1.8-4.3" /></>,
  reper: <><path d="M5 20V4M5 20h15" /><path d="m5 4-1.6 2.2M5 4l1.6 2.2M20 20l-2.2-1.6M20 20l-2.2 1.6" /><path d="M14 10v10M5 10h9" strokeDasharray="1.6 2" /><Pct x={14} y={10} r={1.8} /></>,
  radical: <path d="m3 13 3-1 3 7.5 5-16h7" />,
  ecuatie: <T size={11} style="italic">x=?</T>,
  asemanare: <path d="M3 19.5 7.5 11 12 19.5zM12.5 19.5 16.8 6l4.3 13.5z" />,
  dreptunghic: <><path d="M5 4v15h14z" /><path d="M5 15h4v4" /></>,
  patrulater: <path d="M7.5 6H20l-3.5 12H4z" />,
  functie: <><path d="M4 20V4M4 20h16" /><path d="M6.5 17 19 6" /></>,
  interval: <><path d="M2 12h20" /><path d="M7 8v8M7 8h2M7 16h2M17 8v8M17 8h-2M17 16h-2" /></>,
  cub: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5" />,
  spatiu: <><path d="m3 15.5 5-5h13l-5 5z" /><path d="M12 3v16" /><Pct x={12} y={13} r={1.2} /></>,
  algebra: <T size={7.6}>(a+b)²</T>,
  geometrie: <><path d="M12 5 6 20M12 5l6 15M8.6 14h6.8" /><circle cx="12" cy="4" r="1.5" /></>,
  integrala: <path d="M16.5 4c-1.6-1.2-3.8-.6-4.1 2l-1.6 12c-.3 2.6-2.5 3.2-4.1 2" />,
  derivata: <><path d="M3 19c5 0 6.5-13 12-13 2.6 0 4.4 1.6 6 4.2" /><path d="M7.5 4.5l12 4.6" /></>,
  matrice: <><path d="M7 4H5v16h2M17 4h2v16h-2" /><Pct x={10} y={9} /><Pct x={14} y={9} /><Pct x={10} y={15} /><Pct x={14} y={15} /></>,
  legi: <T size={10} style="italic">x∘y</T>,
  polinom: <T size={9.5} style="italic">P(x)</T>,
  trigonometrie: <><path d="M2 12h20" /><path d="M3 12c2-6.5 4-6.5 6 0s4 6.5 6 0 4-6.5 6 0" /></>,
  vector: <path d="M5 19 19 5M19 5h-7M19 5v7" />,
  combinatorica: <><rect x="4" y="4" width="16" height="16" rx="3" /><Pct x={8.5} y={8.5} /><Pct x={15.5} y={15.5} /><Pct x={12} y={12} /><Pct x={15.5} y={8.5} /><Pct x={8.5} y={15.5} /></>,
  complex: <T size={8.5} style="italic">a+bi</T>,
  progresie: <path d="M3 20h4v-4h4v-4h4V8h4V4" />,
  alte: <path d="m12 3.5 2.5 5.3 5.8.6-4.3 3.9 1.2 5.7-5.2-3-5.2 3 1.2-5.7-4.3-3.9 5.8-.6z" />,
  sub1: <><circle cx="12" cy="12" r="8.5" /><T size={10} y={15.5}>I</T></>,
  sub2: <><circle cx="12" cy="12" r="8.5" /><T size={9.5} y={15.4}>II</T></>,
  sub3: <><circle cx="12" cy="12" r="8.5" /><T size={8.5} y={15}>III</T></>,
  test: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4.5V3h6v1.5" /><path d="m9 13 2 2 4-4" /></>,
  varianta: <><path d="M7 3h7l4 4v14H7zM14 3v4h4" /><path d="M9.5 12h6M9.5 15.5h6" /></>,
  antrenament: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" /><Pct x={12} y={12} r={1.4} /></>,
  simulare: <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 13.5v-4M10 2.5h4M12 2.5V6M18 6.5 19.5 5" /></>,
};

export function Pictograma({ nume, size = 24, title = null, style = null, className = '' }) {
  const desen = ICONURI[nume] || ICONURI.alte;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}
      className={`pictograma ${className}`.trim()} style={style || undefined}>
      {title && <title>{title}</title>}
      {desen}
    </svg>
  );
}

// procentul trecut dintr-un capitol (0…100)
export const procentCapitol = (c) => (c && c.total ? Math.round(((c.trecute || 0) / c.total) * 100) : 0);

// Pictograma capitolului în INELUL lui de progres: bleumarin cât s-a trecut, auriu la
// capitolul pasului curent, plin cu ✓ când e gata.
export function InelCapitol({ c, size = 44, title = null }) {
  const p = procentCapitol(c);
  const cls = `inel-cap${c?.gata ? ' gata' : ''}${c?.curent ? ' curent' : ''}`;
  return (
    <span className={cls} style={{ '--p': p, width: size, height: size }} title={title || undefined}>
      <span className="inel-cap-in">
        <Pictograma nume={c?.icon} size={Math.round(size * 0.5)} />
      </span>
      {c?.gata && <span className="inel-cap-ok" aria-hidden="true">✓</span>}
    </span>
  );
}

// stilul inelului — o singură dată, oriunde apare (harta, Home, „Rezultate")
export const CSS_INEL = `
.inel-cap{--inel:var(--navy,#0f2b44);position:relative;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:50%;background:conic-gradient(var(--inel) calc(var(--p)*1%),rgba(15,43,68,.12) 0);box-sizing:border-box}
.inel-cap.curent{--inel:var(--gold,#e8b931);box-shadow:0 0 0 3px rgba(232,185,49,.22)}
.inel-cap.gata{--inel:var(--navy,#0f2b44)}
.inel-cap-in{position:absolute;inset:3px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;color:var(--navy,#0f2b44)}
.inel-cap.gata .inel-cap-in{background:#f3f6fa}
.inel-cap-ok{position:absolute;right:-3px;bottom:-3px;width:17px;height:17px;border-radius:50%;background:#2e7d32;color:#fff;font-size:.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;line-height:1}
`;
