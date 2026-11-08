import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EinsteinIcon from '../components/EinsteinIcon';
import AIPoweredBy from '../components/AIPoweredBy';
import { Testimonials } from '../components/ReviewWidget';
import { useAuth } from '../context/AuthContext';
import { arenaState, onArenaChange } from '../lib/arena';

// ─── „🎯 Pregătește-mă de examen" — cardul mare de sub bara albastră (8 nov. 2026)
// Primul card din Home: testul zilei, amintirea zilnică, XP și liga. Pentru
// elevul autentificat arată și seria lui și dacă testul de azi îl așteaptă
// (din starea Arenei — aceeași cerere ca indicatorul din bara de sus).
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
        <Link to="/pregateste-ma" className="pz-home-card">
          <div className="pz-home-text">
            <div className="pz-home-kicker">Nou · un test pe zi, ca la Duolingo</div>
            <h2>🎯 Pregătește-mă de examen</h2>
            <p>
              Alegi examenul — <strong>Evaluarea Națională</strong> sau <strong>Bacalaureatul</strong> — și primești în fiecare zi
              un test. Îți amintim de el, contează și o parte din test, iar fiecare zi lucrată îți aduce XP, monede,
              o serie de zile la rând și un loc mai bun în liga săptămânii.
            </p>
            {inceput && (
              <div className="pz-home-stare">
                <span>🔥 <strong>{z.serie || 0}</strong> {z.serie === 1 ? 'zi' : 'zile'} la rând</span>
                <span>{z.aziFacut ? '✅ Ziua de azi e bifată' : '📝 Testul de azi te așteaptă'}</span>
              </div>
            )}
            <span className="btn btn-primary btn-lg pz-home-btn">{cta}{'\u00a0'}→</span>
          </div>
          <ol className="pz-home-pasi" aria-label="Cum funcționează">
            <li><span>📝</span><div><b>Testul zilei</b><small>interactiv sau pe PDF, ca la examen</small></div></li>
            <li><span>🔔</span><div><b>Amintire zilnică</b><small>la ora aleasă de tine</small></div></li>
            <li><span>🔥</span><div><b>Bifezi ziua</b><small>de la 3 exerciții · +XP și 🪙</small></div></li>
            <li><span>🏆</span><div><b>Urci în ligă</b><small>🥉 → 🥈 → 🥇 → 💎 → 👑</small></div></li>
          </ol>
        </Link>
      </div>
    </section>
  );
}

export default function Home() {
  const { user, isPremium } = useAuth();
  const categories = [
    { to: '/clase/5',  icon: '5',  title: 'Clasa a V-a',    desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/6',  icon: '6',  title: 'Clasa a VI-a',   desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/7',  icon: '7',  title: 'Clasa a VII-a',  desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/8',  icon: '8',  title: 'Clasa a VIII-a', desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/9',  icon: '9',  title: 'Clasa a IX-a',   desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/10', icon: '10', title: 'Clasa a X-a',    desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/11', icon: '11', title: 'Clasa a XI-a',   desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/12', icon: '12', title: 'Clasa a XII-a',  desc: 'Exerciții și teste PDF, interactive' },
  ];

  const features = [
    { icon: '📄', title: 'Exerciții PDF', desc: 'Descarcă fișe de lucru și teste în format PDF. Jumătate din materiale sunt gratuite.' },
    { icon: '🧩', title: 'Exerciții Interactive', desc: 'Rezolvă exerciții direct pe platformă cu feedback instant și explicații pas cu pas.' },
    { icon: '📖', title: 'Auxiliare Online', desc: 'Acces la auxiliare și manuale digitale complete, disponibile oricând și de oriunde.' },
    { icon: <EinsteinIcon size={30} />, title: 'Meditații live cu Profesorul Virtual', desc: 'Zilnic, la aceeași oră, profesorul rezolvă la tablă câte un subiect în 4 săli: EN, BAC Mate-Info, BAC Științele Naturii și BAC Tehnologic — pe baremul oficial. Întrebi în chat, răspunzi la grile — sau 1-la-1, oricând.' },
    { icon: '🤖', title: 'Profesor Virtual (AI)', desc: 'Tutor AI disponibil non-stop: explică pas cu pas, generează teste interactive și fișe PDF și îți corectează rezolvările.' },
    { icon: '🧑‍🏫', title: 'Generator de teste (profesori)', desc: 'Profesorii creează teste interactive sau PDF, inclusiv după modele oficiale, le trimit elevilor și văd rezultatele automat.' },
  ];

  return (
    <>
      {/* Bara albastră (fostul „hero" mare — 8 nov. 2026: „fă mai mică secțiunea
          albastră din Home, ca o bară orizontală") */}
      <section className="hero hero-bara">
        <div className="container hero-bara-in">
          <div className="hero-bara-text">
            <h1>Matematica devine <span>simplă</span> cu ExamenMate</h1>
            <p>Exerciții PDF, teste interactive, auxiliare și un Profesor Virtual (AI) — clasele 5–12, Evaluarea Națională și Bacalaureat.</p>
          </div>
          {(!user || !isPremium) && (
            <div className="hero-bara-btns">
              {!user && <Link to="/inregistrare" className="btn btn-primary">Începe gratuit</Link>}
              <Link to="/preturi" className="btn hero-bara-sec">{user ? '⭐ Abonamentul' : 'Vezi abonamentul'}</Link>
            </div>
          )}
        </div>
      </section>

      {/* 🎯 Pregătește-mă de examen — cardul mare, înaintea tuturor cardurilor */}
      <PregatireCard />

      {/* Exams */}
      <section className="section" id="examene">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Pregătire pentru examene</h2>
            <p className="section-subtitle">
              Teste și exerciții special concepute pentru Evaluarea Națională și Bacalaureat.
            </p>
          </div>
          <div className="card-grid" style={{ maxWidth: 1000, margin: '0 auto' }}>
            <Link to="/evaluare-nationala" style={{ textDecoration: 'none' }}>
              <div className="card" style={{ borderLeft: '4px solid var(--gold)' }}>
                <div className="card-icon">📝</div>
                <h3>Evaluarea Națională</h3>
                <p>Teste, exerciții PDF și interactive pentru pregătirea examenului de clasa a VIII-a.</p>
              </div>
            </Link>
            <Link to="/bacalaureat" style={{ textDecoration: 'none' }}>
              <div className="card" style={{ borderLeft: '4px solid var(--navy)' }}>
                <div className="card-icon">🎓</div>
                <h3>Bacalaureat</h3>
                <p>Materiale complete pentru pregătirea examenului de bacalaureat la matematică.</p>
              </div>
            </Link>
            <Link to="/biblioteca-utilizatorilor" style={{ textDecoration: 'none' }}>
              <div className="card" style={{ borderLeft: '4px solid #7c5cbf' }}>
                <div className="card-icon">🏛️</div>
                <h3>Biblioteca utilizatorilor</h3>
                <p>Teste și exerciții create și publicate de profesori cu Profesorul Virtual.</p>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Profesorul Virtual (AI) + Generatorul de teste */}
      <section className="section" style={{ background: 'linear-gradient(180deg, #f4f7fb, #fff)' }} id="profesor-virtual">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Învață cu Profesorul Virtual (AI)</h2>
            <p className="section-subtitle" style={{ marginBottom: 14 }}>
              Un tutor inteligent pentru elevi și un generator de teste pentru profesori — incluse în platformă.
            </p>
            {/* Modelele AI folosite pentru utilizatori (src/lib/aiModels.js → AI_STACK) */}
            <AIPoweredBy variant="chips" showIntern center style={{ marginBottom: 40 }} />
          </div>
          <div className="card-grid" style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div className="card" style={{ borderTop: '4px solid #7c5cbf' }}>
              <div className="card-icon"><EinsteinIcon size={34} /></div>
              <h3>Meditații live cu Profesorul Virtual</h3>
              <p>
                O meditație online la ora fixă: în fiecare zi, profesorul rezolvă la tablă câte un subiect în 4 săli —
                <strong> Evaluarea Națională, BAC Mate-Info, BAC Științele Naturii și BAC Tehnologic</strong> —
                <strong> strict pe baremul oficial</strong>.
                Întrebi în chat, răspunzi la grile și vezi cum au răspuns colegii — sau alegi o ședință
                <strong> 1-la-1</strong>, oricând. În „Planul meu" ai în continuare testul inițial, planul de învățare,
                temele corectate și simulările.
              </p>
              <Link to="/meditatii" className="btn btn-primary" style={{ marginTop: 14 }}>
                Vezi programul de azi
              </Link>
            </div>
            <div className="card" style={{ borderTop: '4px solid var(--gold)' }}>
              <div className="card-icon">🤖</div>
              <h3>Profesor Virtual — teste interactive și PDF</h3>
              <p>
                Asistentul AI îți explică noțiunile pas cu pas, te ajută la teme (poți chiar
                fotografia exercițiul), generează <strong>teste interactive</strong> cu feedback
                instant și <strong>fișe PDF</strong> de antrenament, apoi îți corectează
                rezolvările și îți urmărește progresul.
              </p>
              <Link to="/profesor-virtual" className="btn btn-primary" style={{ marginTop: 14 }}>
                Încearcă Profesorul Virtual
              </Link>
            </div>
            <div className="card" style={{ borderTop: '4px solid var(--navy)' }}>
              <div className="card-icon">🧑‍🏫</div>
              <h3>Generator de teste pentru profesori</h3>
              <p>
                Profesorii creează în câteva minute <strong>teste interactive sau PDF</strong> —
                inclusiv după modelele oficiale de Evaluare Națională și Bacalaureat — le trimit
                elevilor direct din platformă și văd automat rezultatele și progresul fiecărui elev.
              </p>
              <Link to="/profesor-virtual" className="btn btn-outline" style={{ marginTop: 14 }}>
                Descoperă uneltele pentru profesori
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Classes */}
      <section className="section" style={{ background: 'var(--white)' }}>
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Alege clasa ta</h2>
            <p className="section-subtitle">
              Materiale adaptate pentru fiecare nivel, de la clasa a V-a până la clasa a XII-a.
            </p>
          </div>
          <div className="card-grid">
            {categories.map(cat => (
              <Link to={cat.to} key={cat.to} style={{ textDecoration: 'none' }}>
                <div className="card">
                  <div className="card-icon" style={{ fontSize: '1.3rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                    {cat.icon}
                  </div>
                  <h3>{cat.title}</h3>
                  <p>{cat.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Ce găsești pe ExamenMate</h2>
            <p className="section-subtitle">
              Resurse clasice plus inteligență artificială — tot ce te ajută să înveți eficient.
            </p>
          </div>
          <div className="card-grid">
            {features.map(f => (
              <div className="card" key={f.title}>
                <div className="card-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recenzii: „Ce spun elevii, părinții și profesorii" — apare doar când
          există recenzii aprobate în Admin (src/components/ReviewWidget.jsx) */}
      <Testimonials limit={6} />

      {/* CTA */}
      <section className="section" style={{ background: 'linear-gradient(135deg, var(--navy), var(--navy-light))', textAlign: 'center' }}>
        <div className="container">
          <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--white)', fontSize: '2rem', marginBottom: 12 }}>
            Pregătit să începi?
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 32, maxWidth: 480, margin: '0 auto 32px' }}>
            Majoritatea exercițiilor PDF sunt gratuite. Pentru acces complet, abonamentul este de doar 50 lei/lună.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/inregistrare" className="btn btn-primary btn-lg">Creează cont gratuit</Link>
            <Link to="/preturi" className="btn btn-lg" style={{ color: 'var(--white)', border: '2px solid rgba(255,255,255,0.3)' }}>
              Detalii abonament
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
