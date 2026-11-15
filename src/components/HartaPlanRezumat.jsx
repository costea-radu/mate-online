// =====================================================================
// src/components/HartaPlanRezumat.jsx — progresul din „🗺️ Harta pregătirii" în
// „Rezultate", la profesori și la părinți (13 nov. 2026, după-amiaza):
// „fă să apară progresul din hartă în «rezultate», la profesori și părinți".
//   · PlanChip — în rândul elevului: ținta, 🧩 interactive trecute, 📄 subiecte PDF
//     trecute, 🔥 seria de zile (și, din 15 nov., liga: 🥈 locul 4);
//   · HartaPlanRezumat — în zona deschisă a elevului: cele două hărți, în ordinea
//     de pe pagina elevului (1 · exercițiile interactive, 2 · subiectele PDF cu
//     barem), fiecare cu bara, etapele și pasul la care a ajuns; seria, recordul,
//     zilele de pregătire și ultima zi.
// 15 nov. 2026 — „elevul să vadă progresul pe capitole, dar și pe ligă. Acest progres
// să apară și la părinți și profesori în rezultate dar și ca un card separat":
//   · fiecare hartă arată și CAPITOLELE ei (pictograma în inelul de progres, „3/5"),
//     iar pasul la care e elevul spune și capitolul;
//   · liga săptămânii (divizia, locul în grupa de ligă, punctele, nivelul);
//   · cardul separat, cu toți elevii odată: src/components/HartaEleviCard.jsx.
// Datele: api/teacher-students.js → students[].plan și students[].liga
// (api/_lib/planPregatire.js → rezumat, api/_lib/pregatireZilnica.js → rezumateElevi,
// ligiElevi). Fără lista pașilor și fără notele zilei (acelea le vede doar elevul).
// =====================================================================
import '@fontsource/caveat/700.css';   // numerele hărților, scrise de mână (ca pe pagina elevului)
import { InelCapitol, CSS_INEL } from '../lib/pictograme';

const HARTI = [
  { id: 'interactiv', nr: 1, icon: '🧩', nume: 'Exerciții interactive' },
  { id: 'pdf', nr: 2, icon: '📄', nume: 'Subiecte PDF cu barem' },
];
const ori = (n) => (n === 1 ? 'o dată' : `de ${n} ori`);
const zile = (n) => (n === 1 ? 'o zi' : `${n} zile`);
function ziua(iso) {
  if (!iso) return '';
  try { return new Date(`${iso}T12:00:00`).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' }); }
  catch { return iso; }
}
// toată harta (în afară de ce e trecut) e cu Premium — harta PDF, la un cont gratuit
export const blocata = (h) => !!h && h.ramasePremium > 0 && h.ramasePremium + h.trecute >= h.total;

function starePas(pas) {
  if (pas.stare === 'incercat') return `încercat ${ori(pas.incercari || 1)}, ultima dată ${pas.pct ?? 0}%`;
  if (pas.stare === 'inceput') return 'început, neterminat';
  return 'neînceput';
}

// propoziția de sub bara unei hărți: unde a ajuns elevul
function undeE(h, id, laClasa) {
  if (!h || !h.total) {
    return id === 'pdf'
      ? (laClasa ? 'Încă nu sunt fișe PDF cu barem pentru clasa aleasă.' : 'Încă nu sunt subiecte cu barem legat pentru examenul ales.')
      : 'Încă nu sunt exerciții interactive pentru ținta aleasă.';
  }
  if (blocata(h)) return '⭐ Se deschide cu Premium: profesorul virtual corectează subiectele după barem.';
  if (h.pas) return <>E la pasul {h.pas.nr}{h.pas.capitol ? <>, capitolul <b>{h.pas.capitol}</b></> : null}: <b>„{h.pas.titlu}"</b> — {starePas(h.pas)}.</>;
  if (h.terminat) return h.ramasePremium ? `🏁 A terminat tot ce e gratuit; ${h.ramasePremium} ${h.ramasePremium === 1 ? 'pas e' : 'pași sunt'} cu Premium.` : '🏁 A parcurs toată harta.';
  return 'Neînceput.';
}

// liga săptămânii, pe scurt: „🥈 Argint · locul 4 din 27 · 120 p"
export function ligaText(liga, { scurt = false } = {}) {
  if (!liga) return '';
  const loc = liga.loc ? (scurt ? `#${liga.loc}` : `locul ${liga.loc}${liga.membri ? ` din ${liga.membri}` : ''}`) : '';
  if (scurt) return [liga.nume, loc].filter(Boolean).join(' ');
  return [`Liga ${liga.nume}`, loc, `${liga.puncte || 0} ${liga.puncte === 1 ? 'punct' : 'puncte'}`].filter(Boolean).join(' · ');
}

// stilul șirului de inele (folosit și de cardul separat — src/components/HartaEleviCard.jsx)
export const CSS_INELE = `
.hpr-inele{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.hpr-mai{font-size:.7rem;font-weight:800;color:var(--text-muted)}
`;

// inelele capitolelor unei hărți (cel mult `max`, în jurul capitolului curent)
export function InelePeHarta({ capitole = [], max = 12, size = 26 }) {
  if (!capitole.length) return null;
  let k = capitole.findIndex((c) => c.curent);
  if (k < 0) k = Math.max(0, capitole.findIndex((c) => !c.gata));
  const de = Math.max(0, Math.min(k - 3, capitole.length - max));
  const vazute = capitole.slice(de, de + max);
  return (
    <span className="hpr-inele" aria-label={`Capitolele: ${capitole.filter((c) => c.gata).length} din ${capitole.length} terminate`}>
      {de > 0 && <span className="hpr-mai">+{de}</span>}
      {vazute.map((c, i) => <InelCapitol key={`${c.etapa || ''}-${c.titlu}-${i}`} c={c} size={size} title={`${c.titlu} · ${c.trecute} din ${c.total}${c.gata ? ' · terminat' : ''}${c.curent ? ' · aici e acum' : ''}`} />)}
      {capitole.length > de + vazute.length && <span className="hpr-mai">+{capitole.length - de - vazute.length}</span>}
    </span>
  );
}

// ─── în rândul elevului ──────────────────────────────────────────────────────
export function PlanChip({ plan, liga = null, style }) {
  if ((!plan || !plan.tinta) && !liga) return null;
  const i = plan && plan.interactiv, f = plan && plan.pdf;
  const parti = [];
  if (i && i.total) parti.push(`${i.trecute} din ${i.total} exerciții interactive`);
  if (f && f.total) parti.push(blocata(f) ? 'subiectele PDF cu Premium' : `${f.trecute} din ${f.total} subiecte PDF`);
  if (plan && plan.serie) parti.push(`${zile(plan.serie)} la rând`);
  if (liga) parti.push(ligaText(liga));
  return (
    <span
      title={plan && plan.tinta ? `Harta pregătirii (${plan.tinta.label}): ${parti.join(', ') || 'neîncepută'}` : ligaText(liga)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '2px 8px', flexWrap: 'wrap', marginTop: 5,
        padding: '3px 8px', borderRadius: 8, background: '#fdfbf4', border: '1px solid var(--cream-dark)',
        fontSize: '.72rem', fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap', ...style,
      }}
    >
      {plan && plan.tinta && <span>🗺️ {plan.tinta.scurt || plan.tinta.label}</span>}
      {i && i.total > 0 && <span>🧩 {i.trecute}/{i.total}</span>}
      {f && f.total > 0 && <span>📄 {blocata(f) ? '⭐' : `${f.trecute}/${f.total}`}</span>}
      {plan && plan.serie > 0 && <span>🔥 {plan.serie}</span>}
      {liga && <span>{liga.icon} {ligaText(liga, { scurt: true })}</span>}
    </span>
  );
}

// ─── în zona deschisă a elevului ─────────────────────────────────────────────
export default function HartaPlanRezumat({ plan, liga = null, nume = 'Elevul' }) {
  if (!plan || !plan.tinta) {
    return (
      <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '0 2px 14px' }}>
        🗺️ Harta pregătirii: {nume} nu și-a ales încă examenul sau clasa în „Pregătește-mă de examen".
        {liga && <> · {liga.icon} {ligaText(liga)}.</>}
      </div>
    );
  }
  const laClasa = plan.tinta.tip === 'clasa';
  return (
    <div className="hpr" style={{ background: '#fff', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '12px 14px', marginBottom: 14 }}>
      <style>{CSS_INEL + CSS_INELE + CSS}</style>
      <div className="hpr-cap">
        <strong>🗺️ Harta pregătirii · {plan.tinta.label}</strong>
        <span className="hpr-serie">
          🔥 {plan.serie ? `${zile(plan.serie)} la rând` : 'fără serie acum'}{plan.record > 1 ? ` · record ${zile(plan.record)}` : ''}
        </span>
      </div>
      {liga && (
        <div className="hpr-liga">
          <span className="hpr-liga-ic" aria-hidden="true">{liga.icon}</span>
          <span><b>{ligaText(liga)}</b>{liga.zona === 'promovare' ? ' · 🔼 în zona de promovare' : ''}{liga.nivel ? ` · nivelul ${liga.nivel.level} (${liga.nivel.name})` : ''}</span>
        </div>
      )}
      {HARTI.map((m) => {
        const h = plan[m.id];
        const fara = !h || !h.total || blocata(h);
        const extra = [];
        if (h && h.neterminate) extra.push(`${h.neterminate} ${h.neterminate === 1 ? 'neterminat' : 'neterminate'}`);
        if (h && h.sarite) extra.push(`${h.sarite} ${h.sarite === 1 ? 'sărit' : 'săriți'} după ${plan.reguli?.incercariSarire ?? 3} încercări`);
        const caps = (h && h.capitole) || [];
        const capGata = caps.filter((c) => c.gata).length;
        return (
          <div key={m.id} className="hpr-h">
            <div className="hpr-r">
              <span className="hpr-n"><b aria-hidden="true">{m.nr}</b> {m.icon} {m.id === 'pdf' && laClasa ? 'Fișe PDF cu barem' : m.nume}</span>
              {!fara && <span className="hpr-c">{h.trecute} din {h.total} · {h.procent}%</span>}
            </div>
            {!fara && <div className="hpr-bara" aria-hidden="true"><span style={{ width: `${h.procent}%` }} /></div>}
            <div className="hpr-unde">{undeE(h, m.id, laClasa)}{extra.length > 0 && <span className="hpr-extra"> {extra.join(' · ')}.</span>}</div>
            {!fara && caps.length > 1 && (
              <div className="hpr-caps">
                <span className="hpr-caps-t">Capitole: {capGata} din {caps.length} terminate</span>
                <InelePeHarta capitole={caps} />
              </div>
            )}
            {h && h.total > 0 && !blocata(h) && (h.etape || []).length > 1 && (
              <ul className="hpr-et" aria-label={`Etapele hărții ${m.nr}`}>
                {h.etape.map((e) => (
                  <li key={e.titlu} className={e.total && e.trecute >= e.total ? 'gata' : ''}>
                    {e.total && e.trecute >= e.total ? '✓ ' : ''}{e.titlu} <b>{e.trecute}/{e.total}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <div className="hpr-jos">
        {plan.zile
          ? <>Zile de pregătire bifate: <b>{plan.zile}</b>{plan.ultimaZi ? ` · ultima: ${ziua(plan.ultimaZi)}` : ''}.</>
          : 'Încă nicio zi de pregătire bifată (ziua se bifează de la 3 exerciții lucrate).'}
      </div>
    </div>
  );
}

const CSS = `
.hpr-cap{display:flex;align-items:baseline;justify-content:space-between;gap:8px 14px;flex-wrap:wrap;margin-bottom:6px}
.hpr-cap strong{font-size:.85rem;color:var(--navy)}
.hpr-serie{font-size:.76rem;font-weight:700;color:var(--text-light)}
.hpr-liga{display:flex;align-items:center;gap:8px;font-size:.8rem;color:var(--text-light);background:rgba(232,185,49,.1);border:1px solid rgba(232,185,49,.4);border-radius:10px;padding:5px 10px;margin:4px 0 2px}
.hpr-liga b{color:var(--navy)}
.hpr-liga-ic{font-size:1.15rem;line-height:1}
.hpr-h{padding:10px 0 2px}
.hpr-h + .hpr-h{border-top:1px dashed var(--cream-dark);margin-top:6px}
.hpr-r{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.hpr-n{font-size:.82rem;font-weight:800;color:var(--navy)}
.hpr-n b{font-family:"Caveat",cursive;color:#c62828;font-size:1.2rem;margin-right:2px}
.hpr-c{font-size:.76rem;font-weight:800;color:var(--text-light);white-space:nowrap}
.hpr-bara{height:6px;border-radius:99px;background:var(--cream-dark);overflow:hidden;margin:5px 0 6px}
.hpr-bara span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--navy),var(--navy-light))}
.hpr-unde{font-size:.8rem;color:var(--text-light);line-height:1.45}
.hpr-unde b{color:var(--navy);font-weight:700}
.hpr-extra{color:var(--text-muted)}
.hpr-caps{display:grid;gap:5px;margin:8px 0 2px}
.hpr-caps-t{font-size:.72rem;font-weight:800;color:var(--text-muted)}
.hpr-et{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px;padding:0}
.hpr-et li{font-size:.72rem;color:var(--text-light);background:var(--cream);border-radius:99px;padding:2px 9px}
.hpr-et li b{color:var(--navy)}
.hpr-et li.gata{background:rgba(15,43,68,.08);color:var(--navy)}
.hpr-jos{font-size:.76rem;color:var(--text-muted);margin-top:10px}
`;
