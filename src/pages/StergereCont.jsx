import { Link } from 'react-router-dom';

import Section from '../components/LegalSection';

export default function StergereCont() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Ștergerea contului</span>
          </div>
          <h1>Ștergerea contului și a datelor</h1>
          <p>ExamenMate · aplicația Android <code>com.examenmate.app</code></p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)' }}>

            <div style={{ background: 'rgba(232,185,49,0.1)', border: '1px solid rgba(232,185,49,0.4)', borderRadius: 10, padding: '16px 20px', marginBottom: 32, fontSize: '0.9rem', color: 'var(--navy)', lineHeight: 1.7 }}>
              <strong>Pe scurt:</strong> îți poți șterge contul singur, din <Link to="/profil" style={{ color: 'var(--navy)', fontWeight: 600 }}>Profilul tău</Link>, în mai puțin de un minut. Ștergerea este permanentă și elimină definitiv contul și datele asociate. Dacă nu te poți autentifica, ne poți scrie și ștergem noi contul.
            </div>

            <Section title="1. Cum îți ștergi contul din aplicație sau de pe site">
              <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li>Autentifică-te în aplicația ExamenMate sau pe examenmate.com.</li>
                <li>Deschide <strong>Contul meu → Profil</strong>.</li>
                <li>Derulează până la secțiunea <strong>Ștergerea contului</strong>.</li>
                <li>Apasă <strong>Șterge contul</strong> și confirmă de două ori.</li>
              </ol>
              <p style={{ marginTop: 12 }}>
                Contul este șters imediat, iar sesiunea se încheie automat. Acțiunea <strong>nu poate fi anulată</strong>.
              </p>
            </Section>

            <Section title="2. Dacă nu te poți autentifica">
              <p>
                Trimite o cerere de la adresa de e-mail cu care te-ai înregistrat, către{' '}
                <a href="mailto:admin.examenmate@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>admin.examenmate@gmail.com</a>,
                cu subiectul <strong>„Ștergere cont”</strong>. Pentru a preveni ștergerea contului altcuiva, verificăm
                că cererea vine de la adresa titularului. Rezolvăm cererea în cel mult <strong>30 de zile</strong>,
                de regulă în 48 de ore.
              </p>
            </Section>

            <Section title="3. Ce date se șterg">
              <p>La ștergerea contului sunt eliminate definitiv:</p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>contul de autentificare (e-mail și parolă, sau legătura cu Google ori Discord);</li>
                <li>datele de profil: nume, nume de utilizator, clasă, avatar;</li>
                <li>progresul la exerciții și teste, notele și rezultatele proprii;</li>
                <li>temele primite și rezolvările trimise;</li>
                <li>conversațiile cu Profesorul Virtual și cu meditatorul AI;</li>
                <li>mesajele, postările din forum și recenziile scrise de tine;</li>
                <li>asocierile cu profesori, părinți sau grupe.</li>
              </ul>
            </Section>

            <Section title="4. Ce se păstrează și de ce">
              <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <li>
                  <strong>Rezultatele arhivate pentru profesor sau părinte.</strong> Dacă ai fost asociat cu un
                  profesor ori cu un părinte, notele și rezultatele obținute la temele primite de la aceștia
                  rămân în arhiva lor, fără datele tale de contact. Este informație care aparține activității
                  didactice a profesorului, la fel ca un catalog.
                </li>
                <li>
                  <strong>Documentele financiare.</strong> Facturile și evidențele plăților se păstrează
                  <strong> 10 ani</strong>, conform Legii contabilității nr. 82/1991. Nu le putem șterge la cerere.
                </li>
                <li>
                  <strong>Datele de plată</strong> sunt procesate și stocate de Stripe, nu de noi. Pentru ștergerea
                  lor, contactează direct Stripe.
                </li>
                <li>
                  <strong>Copiile de siguranță</strong> ale bazei de date se rotesc automat și se elimină complet
                  în cel mult <strong>30 de zile</strong> de la ștergere.
                </li>
              </ul>
            </Section>

            <Section title="5. Ștergerea parțială a datelor, fără ștergerea contului">
              <p>
                Poți cere ștergerea unor categorii de date păstrând contul activ — de exemplu istoricul
                conversațiilor cu Profesorul Virtual sau postările din forum. Scrie-ne la{' '}
                <a href="mailto:admin.examenmate@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>admin.examenmate@gmail.com</a>{' '}
                și precizezi ce anume vrei eliminat.
              </p>
            </Section>

            <Section title="6. Conturi inactive">
              <p>
                Conturile fără nicio activitate timp îndelungat sunt șterse automat, după notificare prealabilă
                pe e-mail. Detaliile sunt în{' '}
                <Link to="/politica-confidentialitate" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica de Confidențialitate</Link>.
              </p>
            </Section>

            <Section title="7. Drepturile tale">
              <p>
                Conform Regulamentului (UE) 2016/679 (GDPR), ai dreptul la ștergerea datelor („dreptul de a fi
                uitat”), dar și la acces, rectificare, restricționare, portabilitate și opoziție. Le poți exercita
                la aceeași adresă de contact. Dacă nu ești mulțumit de răspuns, te poți adresa{' '}
                <a href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>
                  Autorității Naționale de Supraveghere a Prelucrării Datelor cu Caracter Personal
                </a>.
              </p>
            </Section>

            <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #f0f4f8', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Pentru orice întrebare legată de datele tale:{' '}
              <a href="mailto:admin.examenmate@gmail.com" style={{ color: 'var(--navy)', fontWeight: 600 }}>admin.examenmate@gmail.com</a>
              {' · '}
              <Link to="/politica-confidentialitate" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica de Confidențialitate</Link>
            </div>

          </div>
        </div>
      </section>
    </>
  );
}
