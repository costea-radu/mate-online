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

export default function PoliticaConfidentialitate() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Politica de Confidențialitate</span>
          </div>
          <h1>Politica de Confidențialitate</h1>
          <p>Ultima actualizare: iulie 2026</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)' }}>

            <p style={{ color: 'var(--text-light)', lineHeight: 1.8, marginBottom: 32, fontSize: '0.93rem' }}>
              ExamenMate respectă confidențialitatea datelor tale. Această politică explică ce date colectăm, cum le folosim și cum le protejăm.
            </p>

            <Section title="1. Date colectate">
              <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li><strong>Date de cont (înregistrare prin email):</strong> nume complet, adresă de e-mail, parolă (stocată criptat prin hashing).</li>
                <li><strong>Date de cont (autentificare cu Google sau Discord):</strong> dacă alegi să te autentifici prin contul Google sau Discord, primim de la aceste servicii numele tău, adresa de e-mail și fotografia de profil/avatarul asociate contului respectiv.</li>
                <li><strong>Date de utilizare:</strong> paginile accesate, exercițiile parcurse, progresul înregistrat, postările din secțiunea Forum.</li>
                <li><strong>Date de plată:</strong> procesate exclusiv prin Stripe (card bancar, Apple Pay sau Google Pay). Nu stocăm datele cardului, ale Apple Pay sau Google Pay — acestea sunt gestionate direct de Stripe.</li>
                <li><strong>Date tehnice:</strong> adresa IP, tipul browserului și dispozitivului, necesare pentru securitate și diagnosticarea erorilor.</li>
                <li><strong>Date trimise către asistentul AI (Profesorul Virtual):</strong> întrebările tale, textul și fotografiile exercițiilor pe care le încarci, precum și înregistrările vocale (dacă folosești dictarea) sunt trimise către OpenAI pentru a genera răspunsuri. Vezi secțiunea „8. Profesorul Virtual (AI)".</li>
              </ul>
            </Section>

            <Section title="2. Cum folosim datele">
              <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li>Furnizarea și îmbunătățirea serviciilor platformei.</li>
                <li>Gestionarea contului și a abonamentului.</li>
                <li>Procesarea plăților și a rambursărilor.</li>
                <li>Comunicări legate de cont (confirmare email, notificări de abonament).</li>
                <li>Securizarea platformei și prevenirea fraudelor.</li>
              </ul>
              <p style={{ marginTop: 12 }}>Nu folosim datele tale pentru publicitate și nu le vindem niciodată terților.</p>
            </Section>

            <Section title="3. Conținut generat de utilizatori">
              <p>
                Conținutul pe care îl postezi în secțiunea Forum (texte, imagini, fișiere PDF) este stocat în Supabase Storage și afișat public celorlalți utilizatori autentificați ai platformei. Poți șterge propriile postări oricând direct din platformă. La ștergerea contului, toate postările și fișierele asociate sunt eliminate automat.
              </p>
            </Section>

            <Section title="4. Drepturile tale">
              <p>În conformitate cu GDPR, ai dreptul să:</p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Accesezi</strong> datele personale pe care le deținem despre tine.</li>
                <li><strong>Rectifici</strong> datele incorecte sau incomplete.</li>
                <li><strong>Ștergi</strong> contul și datele asociate („dreptul de a fi uitat") — direct din secțiunea <strong>Contul meu → Șterge contul</strong>, fără a fi necesară contactarea suportului.</li>
                <li><strong>Restricționezi</strong> prelucrarea datelor tale în anumite circumstanțe.</li>
                <li><strong>Portabilizezi</strong> datele tale într-un format structurat.</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                Ștergerea contului o poți face direct din <strong>Contul meu → Șterge contul</strong>. Pentru celelalte drepturi (acces, rectificare, portabilitate, restricționare), ne contactezi la: <a href="mailto:costea.radu.ioan@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>costea.radu.ioan@gmail.com</a>
              </p>
            </Section>

            <Section title="5. Retenția datelor">
              <p>
                Datele de cont sunt păstrate pe durata existenței contului. La ștergerea contului (inițiată direct de utilizator din <strong>Contul meu</strong> sau la cerere prin suport), datele personale și profilul sunt eliminate imediat din baza de date. Datele de facturare pot fi păstrate conform obligațiilor legale (până la 5 ani). Datele obținute prin autentificarea Google sau Discord sunt eliminate odată cu contul.
              </p>
            </Section>

            <Section title="6. Securitate">
              <p>
                Protejăm datele tale prin: conexiuni criptate (HTTPS), parole stocate prin hashing, autentificare OAuth 2.0 pentru conturile Google și Discord, acces restricționat la baza de date. Cu toate acestea, nicio metodă de transmitere pe internet nu este 100% sigură.
              </p>
            </Section>

            <Section title="7. Servicii terțe">
              <p>Platforma utilizează:</p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Supabase</strong> — autentificare, baze de date și stocare fișiere. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica Supabase</a></li>
                <li><strong>Google</strong> — autentificare OAuth. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica Google</a></li>
                <li><strong>Discord</strong> — autentificare OAuth. <a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica Discord</a></li>
                <li><strong>Stripe</strong> — procesare plăți (card, Apple Pay, Google Pay). <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica Stripe</a></li>
                <li><strong>Vercel</strong> — găzduire. <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica Vercel</a></li>
                <li><strong>OpenAI</strong> — procesarea întrebărilor și materialelor pentru funcțiile de inteligență artificială (Profesorul Virtual). <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica OpenAI</a></li>
              </ul>
            </Section>

            <Section title="8. Profesorul Virtual (AI)">
              <p>
                Platforma include un asistent educațional bazat pe inteligență artificială („Profesorul Virtual"). Când îl folosești, întrebările tale, textul exercițiilor, fotografiile pe care le încarci și eventualele înregistrări vocale (pentru dictare) sunt transmise către <strong>OpenAI, L.L.C.</strong> (Statele Unite), care procesează aceste date pentru a genera răspunsuri, exerciții și corectări. Transferul implică o transmitere internațională de date către SUA, realizată cu garanțiile contractuale corespunzătoare.
              </p>
              <p style={{ marginTop: 12 }}>
                Conform politicii pentru dezvoltatori a OpenAI (API), datele trimise prin acest tip de integrare <strong>nu sunt folosite pentru antrenarea modelelor</strong>. Îți recomandăm să nu introduci date personale sensibile în conversațiile cu Profesorul Virtual. Istoricul conversațiilor tale cu asistentul este stocat în contul tău și poate fi șters de tine. Vezi și <a href="https://openai.com/policies/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica de confidențialitate OpenAI</a>.
              </p>
            </Section>

            <Section title="9. Contact">
              <p>
                Pentru orice întrebări legate de această politică, ne poți contacta la:<br />
                <strong>E-mail:</strong> <a href="mailto:costea.radu.ioan@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>costea.radu.ioan@gmail.com</a>
              </p>
            </Section>

          </div>
        </div>
      </section>
    </>
  );
}
