import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      textAlign: 'center',
      padding: '48px 24px',
    }}>
      <div style={{ fontSize: '4rem', marginBottom: 16 }}>🔍</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', marginBottom: 12 }}>
        Pagina nu a fost găsită
      </h1>
      <p style={{ color: 'var(--text-light)', maxWidth: 400, marginBottom: 32 }}>
        Pagina pe care o cauți nu există sau a fost mutată.
      </p>
      <Link to="/" className="btn btn-primary">
        Înapoi la pagina principală
      </Link>
    </div>
  );
}
