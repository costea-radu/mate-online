import { Link } from 'react-router-dom';
import { PremiumGate } from '../components/ProtectedContent';

export default function Manuale() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link>
            <span>›</span>
            <span>Manuale Online</span>
          </div>
          <h1>Manuale Online</h1>
          <p>Manuale digitale de matematică, disponibile oricând</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          <PremiumGate fallbackMessage="Manualele online sunt disponibile exclusiv cu abonament Premium. Abonează-te pentru acces complet.">
            <div className="empty-state">
              <div className="empty-state-icon">📖</div>
              <h3>Manuale Online</h3>
              <p>Manualele digitale vor fi adăugate în curând. Revino mai târziu!</p>
            </div>
          </PremiumGate>
        </div>
      </div>
    </>
  );
}
