// =====================================================================
// src/pages/MesageriePage.jsx — pagina „/mesagerie"
//
// Mesageria de pe tot site-ul: canalele grupelor + discuțiile 1-la-1 cu cei
// din lista mea (profesori, elevi sau părinți — oricine mi-a acceptat cererea).
// Se ajunge aici din bara de sus → „Mai multe" → 💬 Mesagerie, iar pe mobil
// din meniul burger.
//
// Când conversația e închisă cu „✕", panoul „Colegii mei" se lățește, ca
// numele și butoanele să încapă întregi.
// =====================================================================
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Mesagerie from '../components/Mesagerie';
import ColegiiMei from '../components/ColegiiMei';

export default function MesageriePage() {
  const { user, loading } = useAuth();
  const [chatOpen, setChatOpen] = useState(true);
  const onOpenChange = useCallback((open) => setChatOpen(open), []);

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '40px 20px 60px', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🔒</div>
        <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>
          Autentifică-te ca să vezi mesajele primite și canalele grupelor tale.
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
        Canalul fiecărei grupe (profesor, elevi și părinți) și discuțiile 1-la-1 cu oamenii din lista ta.
        Lângă fiecare nume scrie tipul contului, în paranteză.
      </p>

      {/* Conversație deschisă → mesageria ia partea mare. Închisă cu „✕" →
          „Colegii mei" se lățește și se vede tot: nume, roluri, butoane. */}
      <div className="mesagerie-page-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: chatOpen
            ? 'minmax(0, 1fr) minmax(0, 280px)'
            : 'minmax(0, 340px) minmax(0, 1fr)',
          gap: 20, alignItems: 'start',
        }}>
        <div style={{ minWidth: 0 }}>
          <Mesagerie scope="all" height={540} onOpenChange={onOpenChange} />
        </div>
        <div style={{ minWidth: 0 }}>
          <ColegiiMei defaultOpen wide={!chatOpen} />
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
