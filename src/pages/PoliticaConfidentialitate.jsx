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
          <p>Ultima actualizare: aprilie 2025</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)' }}>

            <p style={{ color: 'var(--text-light)', lineHeight: 1.8, marginBottom: 32, fontSize: '0.93rem' }}>
              Mate-Online („noi", „platforma") respectă confidențialitatea utilizatorilor săi și se angajează să protejeze datele cu caracter personal colectate în cadrul utilizării serviciilor noastre. Această politică explică ce date colectăm, cum le folosim și drepturile tale în legătură cu acestea.
            </p>

            <Section title="1. Date colectate">
              <p>Colectăm următoarele categorii de date:</p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Date de cont (înregistrare clasică):</strong> numele complet, adresa de e-mail și parola (stocată criptat) furnizate la înregistrare.</li>
                <li><strong>Date de cont (autentificare cu Google):</strong> dacă alegi să te autentifici prin contul Google, primim de la Google numele tău, adresa de e-mail și fotografia de profil asociate contului Google. Nu primim și nu stocăm parola contului tău Google.</li>
                <li><strong>Date de plată:</strong> plățile sunt procesate prin Stripe. Mate-Online nu stochează datele cardului tău bancar; acestea sunt gestionate exclusiv de Stripe în conformitate cu standardul PCI DSS.</li>
                <li><strong>Date de utilizare:</strong> paginile accesate, materialele descărcate sau vizualizate, timpul petrecut pe platformă — colectate în scop de îmbunătățire a serviciului.</li>
                <li><strong>Date tehnice:</strong> adresa IP, tipul browserului, sistemul de operare și cookie-urile tehnice necesare funcționării platformei.</li>
              </ul>
            </Section>

            <Section title="2. Scopul prelucrării datelor">
              <p>Datele colectate sunt folosite exclusiv pentru:</p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Crearea și gestionarea contului tău de utilizator.</li>
                <li>Autentificarea prin e-mail/parolă sau prin contul Google.</li>
                <li>Procesarea plăților și gestionarea abonamentului.</li>
                <li>Furnizarea accesului la materialele educaționale.</li>
                <li>Trimiterea de notificări legate de cont (confirmare e-mail, facturi).</li>
                <li>Îmbunătățirea serviciilor și experiența utilizatorului pe platformă.</li>
              </ul>
            </Section>

            <Section title="3. Partajarea datelor cu terți">
              <p>
                Nu vindem, nu închiriem și nu partajăm datele tale personale cu terți în scopuri comerciale. Datele pot fi partajate exclusiv cu:
              </p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Supabase</strong> — furnizorul nostru de baze de date și autentificare, care stochează datele de cont în siguranță, inclusiv datele primite prin autentificarea Google.</li>
                <li><strong>Google</strong> — dacă alegi opțiunea „Continuă cu Google", datele tale de profil Google sunt transmise către Supabase prin protocolul OAuth 2.0 securizat. Poți consulta politica de confidențialitate Google la <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>policies.google.com</a>.</li>
                <li><strong>Stripe</strong> — procesatorul nostru de plăți, care gestionează tranzacțiile financiare.</li>
                <li><strong>Vercel</strong> — platforma de găzduire a aplicației.</li>
              </ul>
              <p style={{ marginTop: 10 }}>Toți partenerii noștri respectă Regulamentul General privind Protecția Datelor (GDPR).</p>
            </Section>

            <Section title="4. Cookie-uri">
              <p>
                Platforma folosește cookie-uri tehnice strict necesare pentru funcționarea corectă a sesiunii de autentificare. Autentificarea prin Google poate utiliza cookie-uri suplimentare gestionate de Google în cadrul fluxului OAuth. Nu folosim cookie-uri de marketing sau tracking de la terți. Detalii complete în <Link to="/politica-cookies" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica de Cookie-uri</Link>.
              </p>
            </Section>

            <Section title="5. Securitatea datelor">
              <p>
                Luăm măsuri tehnice și organizatorice adecvate pentru protejarea datelor tale: conexiuni criptate (HTTPS), parole stocate prin hashing, autentificare OAuth 2.0 pentru conturile Google, acces restricționat la baza de date. Cu toate acestea, nicio transmisie de date prin internet nu poate fi garantată 100% sigură.
              </p>
            </Section>

            <Section title="6. Drepturile tale">
              <p>În conformitate cu GDPR, ai dreptul de a:</p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Accesa</strong> datele personale pe care le deținem despre tine.</li>
                <li><strong>Rectifica</strong> datele incorecte sau incomplete.</li>
                <li><strong>Șterge</strong> contul și datele asociate („dreptul de a fi uitat") — direct din secțiunea <strong>Contul meu → Șterge contul</strong>, fără a fi necesară contactarea suportului.</li>
                <li><strong>Restricționa</strong> prelucrarea datelor tale în anumite circumstanțe.</li>
                <li><strong>Portabiliza</strong> datele tale într-un format lizibil de mașină.</li>
                <li><strong>Retrage consimțământul</strong> oricând, fără a afecta legalitatea prelucrării anterioare.</li>
              </ul>
              <p style={{ marginTop: 10 }}>
                Ștergerea contului o poți face direct din <strong>Contul meu → Șterge contul</strong>. Pentru celelalte drepturi (acces, rectificare, portabilitate, restricționare), ne contactezi la: <a href="mailto:costea.radu.ioan@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>costea.radu.ioan@gmail.com</a>
              </p>
            </Section>

            <Section title="7. Retenția datelor">
              <p>
                Datele de cont sunt păstrate pe durata existenței contului. La ștergerea contului (inițiată direct de utilizator din <strong>Contul meu</strong> sau la cerere prin suport), datele personale și profilul sunt eliminate imediat din baza de date. Datele de facturare pot fi păstrate conform obligațiilor legale (până la 5 ani). Datele obținute prin autentificarea Google (nume, e-mail, fotografie) sunt eliminate odată cu contul.
              </p>
            </Section>

            <Section title="8. Modificări ale politicii">
              <p>
                Ne rezervăm dreptul de a actualiza această politică. Modificările semnificative vor fi comunicate prin e-mail sau prin anunț pe platformă. Continuarea utilizării serviciului după notificare constituie acceptarea noilor termeni.
              </p>
            </Section>

            <Section title="9. Contact">
              <p>
                Pentru orice întrebări legate de această politică, ne poți contacta la:<br />
                <strong>E-mail:</strong> <a href="mailto:costea.radu.ioan@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>costea.radu.ioan@gmail.com</a><br />
                <strong>Telefon:</strong> 0765 173 728
              </p>
            </Section>

          </div>
        </div>
      </section>
    </>
  );
}
