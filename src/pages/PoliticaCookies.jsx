import { Link } from 'react-router-dom';

import Section from '../components/LegalSection';

export default function PoliticaCookies() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Politica de Cookie-uri</span>
          </div>
          <h1>Politica de Cookie-uri</h1>
          <p>Ultima actualizare: iulie 2026</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)' }}>

            <p style={{ color: 'var(--text-light)', lineHeight: 1.8, marginBottom: 32, fontSize: '0.93rem' }}>
              Această pagină explică ce sunt cookie-urile, ce tipuri de cookie-uri folosim pe ExamenMate și cum le poți controla.
            </p>

            <Section title="1. Ce sunt cookie-urile?">
              <p>
                Cookie-urile sunt fișiere text de mici dimensiuni stocate pe dispozitivul tău (calculator, telefon, tabletă) atunci când vizitezi un site web. Ele permit site-ului să îți recunoască browserul și să rețină anumite informații despre vizita ta, cum ar fi preferințele de limbă sau starea de autentificare.
              </p>
            </Section>

            <Section title="2. Cookie-uri folosite pe ExamenMate">
              <p>Folosim exclusiv cookie-uri tehnice, strict necesare funcționării platformei:</p>

              <div style={{ overflowX: 'auto', marginTop: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.87rem' }}>
                  <thead>
                    <tr style={{ background: '#f7f9fc' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #eee', color: 'var(--navy)', fontWeight: 700 }}>Nume</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #eee', color: 'var(--navy)', fontWeight: 700 }}>Scop</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #eee', color: 'var(--navy)', fontWeight: 700 }}>Durată</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', borderBottom: '2px solid #eee', color: 'var(--navy)', fontWeight: 700 }}>Tip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: 'sb-access-token', scop: 'Autentificare utilizator (Supabase)', durata: 'Sesiune', tip: 'Necesar' },
                      { name: 'sb-refresh-token', scop: 'Reînnoirea sesiunii de autentificare', durata: '7 zile', tip: 'Necesar' },
                      { name: '__stripe_mid', scop: 'Prevenirea fraudelor la plată (Stripe / Apple Pay / Google Pay)', durata: '1 an', tip: 'Necesar' },
                      { name: '__stripe_sid', scop: 'Identificarea sesiunii de plată (Stripe)', durata: '30 minute', tip: 'Necesar' },
                      { name: 'discord_*', scop: 'Autentificare OAuth cu Discord', durata: 'Sesiune', tip: 'Necesar' },
                    ].map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f0f4f8' }}>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '0.83rem', color: '#1565c0' }}>{row.name}</td>
                        <td style={{ padding: '10px 14px' }}>{row.scop}</td>
                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{row.durata}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '2px 8px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 700 }}>{row.tip}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p style={{ marginTop: 16 }}>
                <strong>Nu folosim</strong> cookie-uri de marketing, tracking sau analiză de la terți (Google Analytics, Facebook Pixel etc.).
              </p>
            </Section>

            <Section title="3. Cookie-uri de la terți">
              <p>
                Stripe, procesatorul nostru de plăți (inclusiv Apple Pay și Google Pay), poate plasa propriile cookie-uri tehnice pe dispozitivul tău în momentul efectuării unei plăți. Discord poate plasa cookie-uri de sesiune în momentul autentificării prin contul Discord. Acestea sunt necesare pentru securitatea tranzacției și prevenirea fraudelor. Poți consulta politica de cookie-uri a Stripe la <a href="https://stripe.com/cookies-policy/legal" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>stripe.com</a>.
              </p>
            </Section>

            <Section title="4. Cum poți controla cookie-urile">
              <p>
                Deoarece folosim exclusiv cookie-uri strict necesare funcționării platformei, acestea nu pot fi dezactivate fără a afecta experiența de utilizare (de exemplu, nu vei putea rămâne autentificat). Poți totuși gestiona cookie-urile direct din setările browserului tău:
              </p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Google Chrome:</strong> Setări → Confidențialitate și securitate → Cookie-uri</li>
                <li><strong>Mozilla Firefox:</strong> Opțiuni → Confidențialitate și securitate</li>
                <li><strong>Safari:</strong> Preferințe → Confidențialitate</li>
                <li><strong>Microsoft Edge:</strong> Setări → Cookie-uri și permisiuni de site</li>
              </ul>
            </Section>

            <Section title="5. Profesorul Virtual și stocarea locală">
              <p>
                Funcția Profesorul Virtual nu folosește cookie-uri de publicitate. Istoricul conversațiilor tale cu asistentul este stocat în contul tău (în baza de date), nu în cookie-uri, iar întrebările și materialele trimise sunt procesate de OpenAI conform <Link to="/politica-confidentialitate" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politicii de Confidențialitate</Link>. Aplicația poate folosi stocarea locală a browserului (localStorage) strict pentru funcționarea platformei (de exemplu, menținerea sesiunii de autentificare), nu în scopuri de urmărire.
              </p>
            </Section>

            <Section title="6. Modificări ale politicii">
              <p>
                Putem actualiza această politică de cookie-uri periodic. Modificările vor fi afișate pe această pagină cu data actualizării.
              </p>
            </Section>

            <Section title="7. Contact">
              <p>
                Pentru întrebări despre utilizarea cookie-urilor:<br />
                <strong>E-mail:</strong> <a href="mailto:costea.radu.ioan@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>costea.radu.ioan@gmail.com</a>
              </p>
            </Section>

          </div>
        </div>
      </section>
    </>
  );
}
