import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function PremiumGate({ children, fallbackMessage }) {
  const { user, isPremium, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="lock-overlay">
        <div className="lock-icon">🔒</div>
        <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          Conținut pentru abonați
        </h3>
        <p style={{ color: 'var(--text-light)', marginBottom: 24, maxWidth: 400 }}>
          {fallbackMessage || 'Creează un cont și abonează-te pentru acces complet la toate materialele.'}
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to="/autentificare" className="btn btn-outline btn-sm">Autentificare</Link>
          <Link to="/preturi" className="btn btn-primary btn-sm">Vezi abonamentul</Link>
        </div>
      </div>
    );
  }

  if (!isPremium) {
    return (
      <div className="lock-overlay">
        <div className="lock-icon">⭐</div>
        <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 8 }}>
          Conținut Premium
        </h3>
        <p style={{ color: 'var(--text-light)', marginBottom: 24, maxWidth: 400 }}>
          {fallbackMessage || 'Acest conținut este disponibil doar cu abonament. Abonează-te pentru acces complet.'}
        </p>
        <Link to="/preturi" className="btn btn-primary btn-sm">Abonează-te – 50 lei/lună</Link>
      </div>
    );
  }

  return children;
}

export function ContentItem({ title, type, isFree, description }) {
  const { isPremium } = useAuth();
  const canAccess = isFree || isPremium;

  const typeConfig = {
    pdf: { icon: '📄', class: 'pdf', label: 'PDF' },
    interactive: { icon: '🧩', class: 'interactive', label: 'Interactiv' },
    manual: { icon: '📖', class: 'manual', label: 'Manual' },
  };

  const cfg = typeConfig[type] || typeConfig.pdf;

  return (
    <div className="content-item" style={{ opacity: canAccess ? 1 : 0.65 }}>
      <div className="content-item-info">
        <div className={`content-item-icon ${cfg.class}`}>{cfg.icon}</div>
        <div>
          <h4>{title}</h4>
          <span>{description || cfg.label}</span>
        </div>
      </div>
      <div className="content-item-actions">
        <span className={`badge ${isFree ? 'badge-free' : 'badge-premium'}`}>
          {isFree ? 'Gratuit' : 'Premium'}
        </span>
        {canAccess ? (
          <button className="btn btn-sm btn-secondary">
            {type === 'interactive' ? 'Începe' : type === 'manual' ? 'Citește' : 'Descarcă'}
          </button>
        ) : (
          <Link to="/preturi" className="btn btn-sm btn-outline">🔒 Abonează-te</Link>
        )}
      </div>
    </div>
  );
}
