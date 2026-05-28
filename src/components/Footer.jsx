import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">
              <span style={{ color: 'var(--gold)' }}>ExamenMate</span>Online
            </div>
            <p style={{ fontSize: '0.88rem', lineHeight: 1.7, maxWidth: 320 }}>
              Platforma ta de matematică pentru exerciții, teste și auxiliare.
              Pregătire completă pentru clasele 5–12, Evaluarea Națională și Bacalaureat.
            </p>
          </div>
          <div>
            <h4>Clase (5–8)</h4>
            <ul>
              <li><Link to="/clase/5">Clasa a V-a</Link></li>
              <li><Link to="/clase/6">Clasa a VI-a</Link></li>
              <li><Link to="/clase/7">Clasa a VII-a</Link></li>
              <li><Link to="/clase/8">Clasa a VIII-a</Link></li>
            </ul>
          </div>
          <div>
            <h4>Clase (9–12)</h4>
            <ul>
              <li><Link to="/clase/9">Clasa a IX-a</Link></li>
              <li><Link to="/clase/10">Clasa a X-a</Link></li>
              <li><Link to="/clase/11">Clasa a XI-a</Link></li>
              <li><Link to="/clase/12">Clasa a XII-a</Link></li>
            </ul>
          </div>
          <div>
            <h4>Examene</h4>
            <ul>
              <li><Link to="/evaluare-nationala">Evaluare Națională</Link></li>
              <li><Link to="/bacalaureat/mate-info">Bacalaureat Mate-Info</Link></li>
              <li><Link to="/bacalaureat/stiinte-naturii">Bacalaureat Șt. Naturii</Link></li>
              <li><Link to="/bacalaureat/tehnologic">Bacalaureat Tehnologic</Link></li>
              <li><Link to="/manuale">Auxiliare Online</Link></li>
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
          <div>
            <h4>Informații</h4>
            <ul>
              <li><Link to="/despre-noi">Despre Noi</Link></li>
              <li><Link to="/contact">Contact</Link></li>
              <li><Link to="/faq">Întrebări Frecvente</Link></li>
            </ul>
          </div>
          <div>
            <h4>Legal</h4>
            <ul>
              <li><Link to="/termeni-conditii">Termeni și Condiții</Link></li>
              <li><Link to="/politica-confidentialitate">Politica de Confidențialitate</Link></li>
              <li><Link to="/politica-cookies">Politica de Cookie-uri</Link></li>
              <li><Link to="/politica-retur">Politica de Retur</Link></li>
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
