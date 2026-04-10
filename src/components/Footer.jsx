import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">
              <span style={{ color: 'var(--gold)' }}>Mate</span>Online
            </div>
            <p style={{ fontSize: '0.88rem', lineHeight: 1.7, maxWidth: 320 }}>
              Platforma ta de matematică pentru exerciții, teste și manuale.
              Pregătire completă pentru Evaluarea Națională și Bacalaureat.
            </p>
          </div>
          <div>
            <h4>Clase</h4>
            <ul>
              <li><Link to="/clase/5">Clasa a V-a</Link></li>
              <li><Link to="/clase/6">Clasa a VI-a</Link></li>
              <li><Link to="/clase/7">Clasa a VII-a</Link></li>
              <li><Link to="/clase/8">Clasa a VIII-a</Link></li>
            </ul>
          </div>
          <div>
            <h4>Examene</h4>
            <ul>
              <li><Link to="/evaluare-nationala">Evaluare Națională</Link></li>
              <li><Link to="/bacalaureat">Bacalaureat</Link></li>
              <li><Link to="/manuale">Manuale Online</Link></li>
            </ul>
          </div>
          <div>
            <h4>Cont</h4>
            <ul>
              <li><Link to="/preturi">Prețuri</Link></li>
              <li><Link to="/autentificare">Autentificare</Link></li>
              <li><Link to="/inregistrare">Înregistrare</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          © {new Date().getFullYear()} Mate-Online. Toate drepturile rezervate.
        </div>
      </div>
    </footer>
  );
}
