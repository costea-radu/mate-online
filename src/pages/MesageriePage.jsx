// =====================================================================
// src/pages/MesageriePage.jsx — pagina „/mesagerie"
//
// Mesageria de pe tot site-ul: canalele grupelor + discuțiile 1-la-1 cu
// colegii (elev cu elev, profesor cu profesor, părinte cu părinte).
// Se ajunge aici din bara de sus → „Mai multe" → 💬 Mesagerie, iar pe mobil
// din meniul burger.
// =====================================================================
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Mesagerie from '../components/Mesagerie';
import ColegiiMei from '../components/ColegiiMei';

export default function MesageriePage() {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '40px 20px 60px', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🔒</div>
        <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>
          Autentifică-te ca să vezi mesajele de la colegi și de la grupele tale.
        </p>
        <Link to="/autentificare?redirect=%2Fmesagerie" className="btn btn-primary">Autentificare</Link>
      </div>
    );
  }

  return (
    <section className="container" style={{ padding: '28px 0 60px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.7rem', marginBottom: 4 }}>
        💬 Mesagerie
      </h1>
      <p style={{ fontSize: '.87rem', color: 'var(--text-muted)', marginBottom: 20 }}>
        Canalul fiecărei grupe (profesor, elevi și părinți) și discuțiile 1-la-1 cu colegii tăi.
        Lângă fiecare nume scrie tipul contului, în paranteză.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 280px)', gap: 20, alignItems: 'start' }}
        className="mesagerie-page-grid">
        <div style={{ minWidth: 0 }}>
          <Mesagerie scope="all" height={540} />
        </div>
        <div style={{ minWidth: 0 }}>
          <ColegiiMei defaultOpen />
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .mesagerie-page-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
