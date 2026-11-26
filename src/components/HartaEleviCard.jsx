// =====================================================================
// src/components/HartaEleviCard.jsx — CARDUL SEPARAT „🗺️ Harta pregătirii" la
// profesori și la părinți (15 nov. 2026)
//
// Cererea: „elevul să vadă progresul pe capitole, dar și pe ligă. Acest progres să
// apară și la părinți și profesori în rezultate dar și ca un card separat."
// În „Rezultate" progresul e în rândul fiecărui elev (PlanChip, HartaPlanRezumat);
// aici e TOT dintr-o privire, câte un rând pe elev:
//   · numele, ținta (🗺️ EN / Cl. VII), liga săptămânii (🥈 Argint · locul 4 din 27);
//   · cât a parcurs din fiecare hartă (🧩 12/49 · 📄 1/11) și seria de zile;
//   · capitolele hărții la care lucrează, ca inele cu pictograme (cât a trecut din
//     fiecare), și capitolul în care e acum;
//   · cine nu și-a ales încă ținta — pe un rând, la sfârșit.
// Folosit: în „Rezultate" (src/components/TeacherResults.jsx — aceleași date, deja
// încărcate) și în Home (src/components/AcasaCont.jsx — `<HartaEleviAcasa />` cere doar
// hărțile: api/teacher-students.js cu mode: 'harti').
// =====================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authHeaders } from '../lib/api';
import { CSS_INEL } from '../lib/pictograme';
import { blocata, ligaText, InelePeHarta, CSS_INELE } from './HartaPlanRezumat';

const zile = (n) => (n === 1 ? 'o zi' : `${n} zile`);
const prenume = (s) => String(s || '').trim().split(/\s+/)[0] || 'Elevul';
const numeDe = (e) => e.name || e.full_name || 'Elev';

// harta la care lucrează elevul acum: cea a pasului zilei (interactivă, apoi PDF)
function hartaActiva(plan) {
  if (!plan) return null;
  const i = plan.interactiv, f = plan.pdf;
  if (i && i.total && (i.pas || !i.terminat)) return { id: 'interactiv', h: i };
  if (f && f.total && !blocata(f)) return { id: 'pdf', h: f };
  return i && i.total ? { id: 'interactiv', h: i } : f && f.total ? { id: 'pdf', h: f } : null;
}

// ordinea: întâi cei care au lucrat recent (ultima zi de pregătire), apoi alfabetic
export function ordoneazaElevi(elevi) {
  return [...(elevi || [])].sort((a, b) => {
    const za = (a.plan && a.plan.ultimaZi) || '', zb = (b.plan && b.plan.ultimaZi) || '';
    if (za !== zb) return za < zb ? 1 : -1;
    return numeDe(a).localeCompare(numeDe(b), 'ro');
  });
}

function RandElev({ e }) {
  const p = e.plan;
  const act = hartaActiva(p);
  const cap = act && act.h.capitole ? act.h.capitole.find((c) => c.curent) || null : null;
  const i = p && p.interactiv, f = p && p.pdf;
  return (
    <li className="hec-elev">
      <div className="hec-r1">
        <span className="hec-nume">{numeDe(e)}</span>
        {p && p.tinta && <span className="hec-tinta">🗺️ {p.tinta.scurt || p.tinta.label}</span>}
        {e.liga && <span className="hec-liga" title={ligaText(e.liga)}>{e.liga.icon} {ligaText(e.liga, { scurt: true })}{e.liga.puncte ? ` · ${e.liga.puncte} p` : ''}</span>}
      </div>
      <div className="hec-r2">
        {i && i.total > 0 && <span>🧩 {i.trecute}/{i.total}</span>}
        {f && f.total > 0 && <span>📄 {blocata(f) ? '⭐ Premium' : `${f.trecute}/${f.total}`}</span>}
        {p && p.serie > 0 && <span>🔥 {zile(p.serie)} la rând</span>}
        {cap && <span className="hec-acum">acum: <b>{cap.titlu}</b> ({cap.trecute}/{cap.total})</span>}
        {act && !cap && act.h.terminat && <span className="hec-acum">🏁 harta {act.id === 'pdf' ? 'PDF' : 'interactivă'} parcursă</span>}
      </div>
      {act && (act.h.capitole || []).length > 1 && <InelePeHarta capitole={act.h.capitole} max={10} size={24} />}
    </li>
  );
}

export default function HartaEleviCard({ elevi = [], rol = 'profesor', limita = 6, link = null, titlu = null, style = null, faraDescriere = false }) {
  const [toti, setToti] = useState(false);
  const activi = (elevi || []).filter((e) => e && !e.archived);
  if (!activi.length) return null;
  const cuHarta = ordoneazaElevi(activi.filter((e) => e.plan && e.plan.tinta));
  const fara = activi.filter((e) => !(e.plan && e.plan.tinta));
  const vazuti = toti ? cuHarta : cuHarta.slice(0, limita);
  const parinte = rol === 'parinte';
  return (
    <div className="card hec" id="harta-elevi" style={{ marginBottom: 24, ...style }}>
      <style>{CSS_INEL + CSS_INELE + CSS}</style>
      <div className="hec-cap">
        <h3>🗺️ {titlu || (parinte ? 'Harta pregătirii copilului' : 'Harta pregătirii elevilor')}</h3>
        {!faraDescriere && <span className="hec-sub">
          {cuHarta.length
            ? `${cuHarta.length} ${cuHarta.length === 1 ? (parinte ? 'copil' : 'elev') : (parinte ? 'copii' : 'elevi')} pe hartă · progresul pe capitole și liga săptămânii`
            : (parinte ? 'Copilul nu și-a ales încă ținta.' : 'Niciun elev nu și-a ales încă ținta.')}
        </span>}
      </div>
      {cuHarta.length > 0 && (
        <ul className="hec-lista">
          {vazuti.map((e) => <RandElev key={e.id} e={e} />)}
        </ul>
      )}
      {cuHarta.length > limita && (
        <button type="button" className="hec-toti" onClick={() => setToti((v) => !v)}>
          {toti ? '▴ Arată mai puțini' : `▾ Arată toți (${cuHarta.length})`}
        </button>
      )}
      {fara.length > 0 && (
        <div className="hec-fara">
          {parinte ? 'Fără țintă aleasă' : 'Fără țintă aleasă încă'}: {fara.slice(0, 12).map((e) => prenume(numeDe(e))).join(', ')}{fara.length > 12 ? ` și încă ${fara.length - 12}` : ''}
          {' '}— își aleg examenul sau clasa în „🎯 Pregătește-mă de examen".
          {fara.some((e) => e.liga) && <span className="hec-fara-l"> Liga: {fara.filter((e) => e.liga).slice(0, 6).map((e) => `${prenume(numeDe(e))} ${e.liga.icon}`).join(' · ')}.</span>}
        </div>
      )}
      {link && <div className="hec-link"><Link to={link.to}>{link.label} →</Link></div>}
    </div>
  );
}

// ─── în Home (profesor / părinte): cere doar hărțile, o dată pe minut ─────────
let mem = { la: 0, p: null };
async function incarcaHarti() {
  if (mem.p && Date.now() - mem.la < 60000) return mem.p;
  const p = (async () => {
    const res = await fetch('/api/teacher-students', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ mode: 'harti' }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Eroare server (${res.status})`);
    return json;
  })();
  mem = { la: Date.now(), p };
  p.catch(() => { mem = { la: 0, p: null }; });
  return p;
}

export function HartaEleviAcasa({ rol = 'profesor' }) {
  const [elevi, setElevi] = useState(null);
  useEffect(() => {
    let viu = true;
    incarcaHarti().then((j) => { if (viu) setElevi((j.students || []).map((s) => ({ ...s, name: s.full_name }))); }).catch(() => { if (viu) setElevi([]); });
    return () => { viu = false; };
  }, []);
  if (!elevi || !elevi.length) return null;
  return (
    <HartaEleviCard elevi={elevi} rol={rol} limita={3} style={{ marginTop: 16, marginBottom: 0 }} faraDescriere   /* Home: fără descrierea gri (26 nov. 2026) */
      link={{ to: '/profil?rezultate=1', label: rol === 'parinte' ? 'Toate rezultatele copilului' : 'Toate rezultatele elevilor' }} />
  );
}

const CSS = `
.hec-cap{display:flex;align-items:baseline;justify-content:space-between;gap:6px 14px;flex-wrap:wrap;margin-bottom:10px}
.hec-cap h3{font-family:var(--font-display);color:var(--navy);margin:0;font-size:1.15rem}
.hec-sub{font-size:.78rem;color:var(--text-muted)}
.hec-lista{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.hec-elev{display:grid;gap:6px;padding:10px 12px;border-radius:12px;background:#fdfbf4;border:1px solid var(--cream-dark)}
.hec-r1{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap}
.hec-nume{font-weight:800;color:var(--navy);font-size:.92rem}
.hec-tinta,.hec-liga{font-size:.74rem;font-weight:700;border-radius:999px;padding:2px 9px;white-space:nowrap}
.hec-tinta{background:#fff;border:1px solid var(--border);color:var(--navy)}
.hec-liga{background:rgba(232,185,49,.14);border:1px solid rgba(232,185,49,.5);color:var(--navy)}
.hec-r2{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.78rem;font-weight:700;color:var(--text-light)}
.hec-acum{font-weight:600}
.hec-acum b{color:var(--navy)}
.hec-toti{margin-top:8px;background:none;border:none;color:var(--navy);font-weight:700;cursor:pointer;font-size:.82rem;padding:4px 0}
.hec-fara{margin-top:10px;font-size:.78rem;color:var(--text-muted);line-height:1.5}
.hec-fara-l{color:var(--text-light)}
.hec-link{margin-top:10px;font-size:.84rem;font-weight:700}
.hec-link a{color:var(--navy)}
`;
