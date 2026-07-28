import { Link } from 'react-router-dom';

export default function Home() {
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
    { icon: '🤖', title: 'Profesor Virtual (AI)', desc: 'Tutor AI disponibil non-stop: explică pas cu pas, generează teste interactive și fișe PDF și îți corectează rezolvările.' },
    { icon: '🧑‍🏫', title: 'Generator de teste (profesori)', desc: 'Profesorii creează teste interactive sau PDF, inclusiv după modele oficiale, le trimit elevilor și văd rezultatele automat.' },
  ];

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="container hero-content">
          <h1 className="fade-in-up">
            Matematica devine <span>simplă</span> cu ExamenMate
          </h1>
          <p className="fade-in-up delay-1">
            Exerciții PDF, teste interactive, auxiliare online și un Profesor Virtual (AI)
            care te ajută pas cu pas — pentru clasele 5–12, Evaluarea Națională și Bacalaureat.
            Totul într-un singur loc.
          </p>
          <div className="hero-actions fade-in-up delay-2">
            <Link to="/inregistrare" className="btn btn-primary btn-lg">Începe gratuit</Link>
            <Link to="/preturi" className="btn btn-lg" style={{
              color: 'rgba(255,255,255,0.85)',
              border: '2px solid rgba(255,255,255,0.25)'
            }}>
              Vezi abonamentul
            </Link>
          </div>
        </div>
      </section>

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
            <p className="section-subtitle">
              Un tutor inteligent pentru elevi și un generator de teste pentru profesori — incluse în platformă.
            </p>
          </div>
          <div className="card-grid" style={{ maxWidth: 1000, margin: '0 auto' }}>
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
