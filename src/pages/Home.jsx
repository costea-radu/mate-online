import { Link } from 'react-router-dom';

export default function Home() {
  const categories = [
    { to: '/clase/5', icon: '5', title: 'Clasa a V-a', desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/6', icon: '6', title: 'Clasa a VI-a', desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/7', icon: '7', title: 'Clasa a VII-a', desc: 'Exerciții și teste PDF, interactive' },
    { to: '/clase/8', icon: '8', title: 'Clasa a VIII-a', desc: 'Exerciții și teste PDF, interactive' },
  ];

  const features = [
    { icon: '📄', title: 'Exerciții PDF', desc: 'Descarcă fișe de lucru și teste în format PDF. Jumătate din materiale sunt gratuite.' },
    { icon: '🧩', title: 'Exerciții Interactive', desc: 'Rezolvă exerciții direct pe platformă cu feedback instant și explicații pas cu pas.' },
    { icon: '📖', title: 'Manuale Online', desc: 'Acces la manuale digitale complete, disponibile oricând și de oriunde.' },
  ];

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="container hero-content">
          <h1 className="fade-in-up">
            Matematica devine <span>simplă</span> cu Mate-Online
          </h1>
          <p className="fade-in-up delay-1">
            Exerciții PDF, teste interactive și manuale online pentru clasele 5–8,
            Evaluarea Națională și Bacalaureat. Totul într-un singur loc.
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

      {/* Classes */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Alege clasa ta</h2>
            <p className="section-subtitle">
              Materiale adaptate pentru fiecare nivel, de la clasa a V-a până la clasa a VIII-a.
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

      {/* Exams */}
      <section className="section" style={{ background: 'var(--white)' }}>
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Pregătire pentru examene</h2>
            <p className="section-subtitle">
              Teste și exerciții special concepute pentru Evaluarea Națională și Bacalaureat.
            </p>
          </div>
          <div className="card-grid" style={{ maxWidth: 700, margin: '0 auto' }}>
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
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Ce găsești pe Mate-Online</h2>
            <p className="section-subtitle">
              Trei tipuri de resurse care te ajută să înveți eficient.
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
            Jumătate din exercițiile PDF sunt gratuite. Pentru acces complet, abonamentul este de doar 50 lei/lună.
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
