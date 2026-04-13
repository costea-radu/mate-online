import { Link } from 'react-router-dom';

export default function Contact() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Contact</span>
          </div>
          <h1>Contact</h1>
          <p>Suntem aici să te ajutăm. Nu ezita să ne contactezi.</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 700 }}>
          <div style={{ display: 'grid', gap: 20 }}>

            <div style={{ background: '#fff', borderRadius: 14, padding: '32px 36px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 24 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(232,185,49,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>
                📞
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Telefon</div>
                <a href="tel:0765173728" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', textDecoration: 'none' }}>
                  0765 173 728
                </a>
                <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: 4 }}>Luni – Vineri, 09:00 – 18:00</div>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 14, padding: '32px 36px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', gap: 24 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'rgba(232,185,49,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', flexShrink: 0 }}>
                ✉️
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>E-mail</div>
                <a href="mailto:costea.radu.ioan@gmail.com" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--font-display)', textDecoration: 'none' }}>
                  costea.radu.ioan@gmail.com
                </a>
                <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: 4 }}>Răspundem în maxim 24 de ore</div>
              </div>
            </div>

            <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '28px 36px', color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', lineHeight: 1.7 }}>
              <div style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.05rem', fontWeight: 700, marginBottom: 8 }}>
                Ai o întrebare despre platformă?
              </div>
              Ne poți contacta pentru orice problemă legată de cont, abonament, conținut sau sugestii de îmbunătățire. Îți vom răspunde cât mai repede posibil.
            </div>

          </div>
        </div>
      </section>
    </>
  );
}
