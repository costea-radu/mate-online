import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EinsteinIcon from '../components/EinsteinIcon';
import { Testimonials } from '../components/ReviewWidget';
import { useAuth } from '../context/AuthContext';
import { arenaState, onArenaChange } from '../lib/arena';
import { AcasaElev, AcasaParinte, AcasaProfesor } from '../components/AcasaCont';
import ExercitiuRapid from '../components/ExercitiuRapid';
import { CLASE, EXAMENE, scurtaturi } from '../lib/meniu';
import { PLANS } from '../lib/plans';

// =====================================================================
// HOME — pe tipul de cont, „ca o aplicație" (11 nov. 2026, seara)
//
// Cererea: mai puțin text, mai multe butoane; fiecare tip de cont are în Home
// butoane simple către funcțiile LUI și niciun buton de la alt tip de cont.
//   · bara albastră: titlul (vizitator) sau salutul (cont);
//   · elev / vizitator: „🎯 Pregătește-mă de examen" — vizitatorul rezolvă pe loc
//     un exercițiu (ExercitiuRapid), elevul își vede seria și testul de azi;
//   · cardurile contului (AcasaCont.jsx) + „Tot ce poți face" (butoanele din
//     src/lib/meniu.js → scurtaturi, pe tipul de cont);
//   · „Materiale": examenele și clasele, ca butoane (id="materiale" — aici duce
//     „📚 Materiale" din bara de jos de pe telefon);
//   · doar vizitatorul: „Pentru cine e" (elev / părinte / profesor) și chemarea la cont;
//   · fără abonament: „Gratuit / Premium", pe scurt.
// Paginile lungi de prezentare (cardurile cu paragrafe, lista modelelor AI) au
// plecat de aici: detaliile sunt în paginile lor.
// =====================================================================

const prenumeDin = (profile, user) => String(profile?.full_name || user?.user_metadata?.name || user?.user_metadata?.full_name || '').trim().split(/\s+/)[0] || '';

// ─── „🎯 Pregătește-mă de examen" — cardul mare de sub bara albastră (8 nov. 2026)
// Primul card din Home: testul zilei, amintirea zilnică, XP și liga. Pentru
// elevul autentificat arată și seria lui și dacă testul de azi îl așteaptă
// (din starea Arenei — aceeași cerere ca indicatorul din bara de sus).
// Vizitatorul are lângă el un exercițiu pe care îl rezolvă pe loc.
function PregatireCard() {
  const { user } = useAuth();
  const [z, setZ] = useState(null);   // { examen, azi, serie, aziFacut } — api/_lib/pregatireZilnica.js → rezumat
  useEffect(() => {
    if (!user) { setZ(null); return undefined; }
    let viu = true;
    const load = (force = false) => arenaState({ force }).then((r) => { if (viu) setZ(r?.pregatireAzi || null); }).catch(() => {});
    load();
    const off = onArenaChange(() => load(true));
    return () => { viu = false; off(); };
  }, [user]);
  const inceput = !!(z && z.examen);
  const cta = !user ? 'Începe azi — gratuit' : !inceput ? 'Alege examenul și începe' : z.aziFacut ? '↻ Mai lucrează azi' : '▶ Testul de azi';
  return (
    <section className="pz-home" aria-label="Pregătește-mă de examen">
      <div className="container">
        <div className={`pz-home-card${user ? '' : ' cu-exercitiu'}`}>
          <div className="pz-home-text">
            <div className="pz-home-kicker">Un test pe zi, cu serie și ligă</div>
            <h2>🎯 Pregătește-mă de examen</h2>
            <p>
              Alegi <strong>Evaluarea Națională</strong> sau <strong>Bacalaureatul</strong> și primești în fiecare zi un test scurt.
            </p>
            {inceput && (
              <div className="pz-home-stare">
                <span>🔥 <strong>{z.serie || 0}</strong> {z.serie === 1 ? 'zi' : 'zile'} la rând</span>
                <span>{z.aziFacut ? '✅ Ziua de azi e bifată' : '📝 Testul de azi te așteaptă'}</span>
              </div>
            )}
            <Link to="/pregateste-ma" className="btn btn-primary btn-lg pz-home-btn">{cta}</Link>
            <ul className="pz-home-pasi" aria-label="Ce primești">
              <li>📝 testul zilei</li>
              <li>🔔 amintire zilnică</li>
              <li>🔥 serie de zile</li>
              <li>🏆 ligă săptămânală</li>
            </ul>
          </div>
          {!user && <ExercitiuRapid />}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { user, profile, isPremium, isTeacher, isParent } = useAuth();
  const { hash } = useLocation();
  // prima pagină pe tipul de cont (11 nov. 2026 — src/components/AcasaCont.jsx):
  // elevul (și vizitatorul) păstrează „Pregătește-mă de examen"; părintele și
  // profesorul au în locul lui cardurile contului lor
  const cont = !user ? 'vizitator' : isTeacher ? 'profesor' : isParent ? 'parinte' : 'elev';
  const prenume = prenumeDin(profile, user);

  // „📚 Materiale" din bara de jos (/#materiale): derulăm la blocul de materiale
  useEffect(() => {
    if (hash !== '#materiale') return undefined;
    const t = setTimeout(() => {
      try { document.getElementById('materiale')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { /* ignore */ }
    }, 60);
    return () => clearTimeout(t);
  }, [hash]);

  return (
    <>
      {/* Bara albastră (fostul „hero" mare — 8 nov. 2026: „fă mai mică secțiunea
          albastră din Home, ca o bară orizontală"). Vizitator: ce e site-ul;
          cont: salutul. */}
      <section className="hero hero-bara">
        <div className={`container hero-bara-in${user ? ' cu-cont' : ''}`}>
          <div className="hero-bara-text">
            {user ? (
              <h1>{cont === 'profesor' ? 'Bună ziua' : 'Bună'}{prenume ? `, ${prenume}` : ''}! 👋</h1>
            ) : (
              <>
                <h1>Matematică pentru Evaluarea Națională și BAC</h1>
                <p>Teste cu nota pe loc, fișe PDF și un profesor virtual care explică pas cu pas — clasele 5–12.</p>
              </>
            )}
          </div>
          {(!user || !isPremium) && (
            <div className="hero-bara-btns">
              {!user && <Link to="/inregistrare" className="btn btn-primary">Începe gratuit</Link>}
              <Link to="/preturi" className="btn hero-bara-sec">{user ? '⭐ Abonamentul' : 'Vezi abonamentul'}</Link>
            </div>
          )}
        </div>
      </section>

      {/* 🎯 Pregătește-mă de examen — cardul mare, înaintea tuturor cardurilor (elev / vizitator);
          sub el, la elev: insignele, rezultatele, temele, mesageria.
          Părintele și profesorul: cardurile contului lor, fără „Pregătește-mă" */}
      {(cont === 'vizitator' || cont === 'elev') && <PregatireCard />}
      {cont === 'elev' && <AcasaElev />}
      {cont === 'parinte' && <AcasaParinte />}
      {cont === 'profesor' && <AcasaProfesor />}

      {/* examenele și clasele: la vizitator și la elev înaintea restului butoanelor */}
      {(cont === 'vizitator' || cont === 'elev') && <Materiale />}
      <Scurtaturi rol={cont} />
      {(cont === 'parinte' || cont === 'profesor') && <Materiale />}

      {cont === 'vizitator' && <PentruCine />}
      {!isPremium && cont !== 'profesor' && <GratuitPremium rol={cont} />}

      {/* Recenzii: „Ce spun elevii, părinții și profesorii" — apare doar când
          există recenzii aprobate în Admin (src/components/ReviewWidget.jsx) */}
      <Testimonials limit={6} />
      {cont !== 'vizitator' && <div className="acasa-capat" />}

      {/* Chemarea la cont — doar vizitatorului */}
      {cont === 'vizitator' && (
        <section className="acasa-cta">
          <div className="container">
            <h2>Începe cu un test. Contul e gratuit.</h2>
            <div className="acasa-cta-btns">
              <Link to="/inregistrare" className="btn btn-primary btn-lg">Creează cont gratuit</Link>
              <Link to="/evaluare-nationala?tab=interactive" className="btn btn-lg acasa-cta-sec">Vezi testele</Link>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

// ═══ Blocurile paginii (declarate după Home: funcțiile se ridică singure) ═══════

// ─── „Tot ce poți face": butoanele contului (src/lib/meniu.js → scurtaturi) ──
function Scurtaturi({ rol }) {
  const lista = scurtaturi(rol);
  const titlu = rol === 'profesor' ? 'Uneltele tale' : rol === 'parinte' ? 'Mai poți face' : 'Învață și joacă';
  return (
    <section className="acasa acasa-scurt" aria-label={titlu}>
      <div className="container">
        <h2 className="acasa-titlu">{titlu}</h2>
        <div className="dale" data-n={lista.length}>
          {lista.map((s) => (
            <Link key={s.to + s.label} to={s.to} className="dala">
              <span className="dala-ic" aria-hidden="true">{s.icon === 'einstein' ? <EinsteinIcon size={30} /> : s.icon}</span>
              <span className="dala-txt">{s.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── „Materiale": examenele și clasele, ca butoane ───────────────────────────
const CIFRE = { '/clase/5': 'V', '/clase/6': 'VI', '/clase/7': 'VII', '/clase/8': 'VIII', '/clase/9': 'IX', '/clase/10': 'X', '/clase/11': 'XI', '/clase/12': 'XII' };
function Materiale() {
  return (
    <section className="acasa acasa-mat" id="materiale" aria-label="Materiale">
      <div className="container">
        <h2 className="acasa-titlu">Materiale</h2>
        <div className="mat-examene" id="examene">
          {EXAMENE.map((e, i) => (
            <Link key={e.to} to={e.to} className={`mat-ex${i === 0 ? ' en' : ''}`}>
              <span className="mat-ex-ic" aria-hidden="true">{i === 0 ? '📝' : '🎓'}</span>
              <span className="mat-ex-txt">{e.label}</span>
            </Link>
          ))}
        </div>
        <div className="mat-clase" role="group" aria-label="Clase">
          {CLASE.map((c) => (
            <Link key={c.to} to={c.to} className="mat-cl" aria-label={c.label}>
              <small>clasa</small>
              <b>{CIFRE[c.to]}</b>
            </Link>
          ))}
        </div>
        <div className="mat-alte">
          <Link to="/manuale">📖 Auxiliare</Link>
          <Link to="/rezolvari">📝 Rezolvări și teorie</Link>
          <Link to="/biblioteca-utilizatorilor">🏛️ Biblioteca utilizatorilor</Link>
        </div>
      </div>
    </section>
  );
}

// ─── Doar vizitatorul: pentru cine e site-ul (trei uși, cu contul potrivit) ──
const PENTRU = [
  {
    tip: 'elev', icon: '🎒', titlu: 'Elev',
    ce: ['Teste cu nota pe loc', 'Un test pe zi, cu serie și ligă', 'Profesorul Virtual îți explică pas cu pas'],
    buton: 'Cont de elev',
  },
  {
    tip: 'parinte', icon: '👨‍👩‍👧', titlu: 'Părinte',
    ce: ['Vezi notele și temele copilului', 'Îi dai o temă din două atingeri', 'Vorbești cu profesorul lui'],
    buton: 'Cont de părinte',
  },
  {
    tip: 'profesor', icon: '🧑‍🏫', titlu: 'Profesor',
    ce: ['Generezi teste interactive sau PDF', 'Le trimiți elevilor cu un link', 'Rezultatele și catalogul se completează singure'],
    buton: 'Cont de profesor',
  },
];
function PentruCine() {
  return (
    <section className="acasa acasa-cine" aria-label="Pentru cine e ExamenMate">
      <div className="container">
        <h2 className="acasa-titlu">Alege contul tău</h2>
        <div className="cine-grid">
          {PENTRU.map((p) => (
            <div className="cine" key={p.tip}>
              <h3><span aria-hidden="true">{p.icon}</span> {p.titlu}</h3>
              <ul>
                {p.ce.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <Link to={`/inregistrare?tip=${p.tip}`} className="btn btn-outline btn-sm">{p.buton}</Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Fără abonament: ce e gratuit și ce aduce Premium, pe scurt ──────────────
function GratuitPremium({ rol }) {
  const lunar = PLANS.find((p) => p.id === 'lunar') || PLANS[0];
  const anual = PLANS.find((p) => p.id === 'anual');
  return (
    <section className="acasa acasa-plan" aria-label="Gratuit și Premium">
      <div className="container">
        <div className="plan-grid">
          <div className="plan plan-gratuit">
            <h3>Gratuit</h3>
            <ul>
              <li>Teste interactive, cu nota pe loc</li>
              <li>Fișe și subiecte PDF gratuite</li>
              <li>Testul zilei, Arena și insignele</li>
            </ul>
          </div>
          <div className="plan plan-premium">
            <h3>⭐ Premium <span>{lunar.pret} lei pe lună{anual ? ` sau ${anual.pret} lei pe an` : ''}</span></h3>
            <ul>
              <li>Profesorul Virtual: explicații la orice exercițiu</li>
              <li>Corectarea rezolvărilor scrise de mână, după barem</li>
              <li>Meditații live zilnice și 8 ședințe 1-la-1 pe lună</li>
              <li>Toate materialele PDF și rezolvările</li>
            </ul>
            <Link to="/preturi" className="btn btn-primary">{rol === 'parinte' ? 'Abonament pentru copil' : 'Vezi abonamentul'}</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
