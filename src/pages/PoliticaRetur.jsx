import { Link } from 'react-router-dom';

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 32 }}>
    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--navy)', marginBottom: 12, paddingBottom: 8, borderBottom: '2px solid #f0f4f8' }}>
      {title}
    </h2>
    <div style={{ color: 'var(--text)', lineHeight: 1.8, fontSize: '0.93rem' }}>
      {children}
    </div>
  </div>
);

export default function PoliticaRetur() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Politica de Retur</span>
          </div>
          <h1>Politica de Retur</h1>
          <p>Dreptul de retragere pentru servicii digitale — OUG 34/2014</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)' }}>

            <div style={{ background: 'rgba(232,185,49,0.1)', border: '1px solid rgba(232,185,49,0.4)', borderRadius: 10, padding: '16px 20px', marginBottom: 32, fontSize: '0.9rem', color: 'var(--navy)', lineHeight: 1.7 }}>
              <strong>Rezumat:</strong> Ai dreptul de a te retrage din contract în termen de 14 zile de la achiziție, fără a da nicio explicație. Dacă ai accesat conținutul digital imediat după plată și ai confirmat renunțarea la dreptul de retragere, rambursarea nu mai este posibilă.
            </div>

            <Section title="1. Dreptul legal de retragere">
              <p>
                În conformitate cu OUG nr. 34/2014 privind drepturile consumatorilor în cadrul contractelor încheiate cu profesioniștii, ai dreptul de a te retrage din contractul de abonament în termen de <strong>14 zile calendaristice</strong> de la data încheierii contractului (data plății), fără a fi necesar să justifici decizia și fără a suporta alte costuri.
              </p>
            </Section>

            <Section title="2. Excepție pentru conținut digital accesat imediat">
              <p>
                Conform art. 16 lit. m) din OUG 34/2014, dreptul de retragere <strong>nu se aplică</strong> în cazul contractelor pentru furnizarea de conținut digital care nu este livrat pe un suport material, dacă executarea a început cu acordul prealabil expres al consumatorului și după ce acesta a confirmat că a luat cunoștință de faptul că își va pierde dreptul de retragere.
              </p>
              <p style={{ marginTop: 12 }}>
                Prin finalizarea plății și accesarea imediată a materialelor Premium, confirmi că:
              </p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Ești de acord cu executarea imediată a contractului.</li>
                <li>Ai luat cunoștință că vei pierde dreptul de retragere odată cu accesarea conținutului digital.</li>
              </ul>
            </Section>

            <Section title="3. Cum exerciți dreptul de retragere (dacă nu ai accesat conținutul)">
              <p>
                Dacă dorești să te retragi din contract în termen de 14 zile și nu ai accesat conținutul Premium, ne contactezi la:
              </p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>E-mail:</strong> <a href="mailto:costea.radu.ioan@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>costea.radu.ioan@gmail.com</a></li>
                <li><strong>Telefon:</strong> 0765 173 728</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                Cererea ta va fi procesată în termen de <strong>14 zile</strong> de la primire, iar suma plătită va fi rambursată prin același mijloc de plată utilizat la achiziție (card bancar, Apple Pay sau Google Pay). Rambursările prin Apple Pay sau Google Pay revin în contul bancar asociat wallet-ului respectiv.
              </p>
            </Section>

            <Section title="4. Funcțiile AI (Profesorul Virtual)">
              <p>
                Asistentul „Profesorul Virtual" și funcțiile sale (generare de exerciții, teste, corectări) fac parte din abonamentul Premium și se supun acelorași condiții de retur și anulare descrise în această politică. Fiind conținut digital furnizat imediat, se aplică și excepția de la punctul 2 în cazul în care ai folosit deja aceste funcții.
              </p>
            </Section>

            <Section title="5. Anularea abonamentului recurent">
              <p>
                Abonamentul ExamenMate se reînnoiește automat lunar. Îl poți anula oricând din secțiunea <Link to="/profil" style={{ color: 'var(--navy)', fontWeight: 600 }}>Contul meu</Link> → „Gestionează abonamentul". Accesul Premium rămâne activ până la sfârșitul perioadei deja plătite. Nu se oferă rambursări pro-rata pentru perioadele parțiale.
              </p>
            </Section>

            <Section title="6. Probleme tehnice">
              <p>
                Dacă întâmpini probleme tehnice care te împiedică să accesezi conținutul pentru care ai plătit, ne contactezi imediat. Vom rezolva problema sau vom oferi o extensie a abonamentului echivalentă cu perioada de indisponibilitate.
              </p>
            </Section>

            <Section title="7. Contact">
              <p>
                Pentru orice întrebări legate de retururi sau anulări:<br />
                <strong>E-mail:</strong> <a href="mailto:costea.radu.ioan@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>costea.radu.ioan@gmail.com</a><br />
                <strong>Telefon:</strong> 0765 173 728<br />
                <strong>Program:</strong> Luni – Vineri, 09:00 – 18:00
              </p>
            </Section>

          </div>
        </div>
      </section>
    </>
  );
}
