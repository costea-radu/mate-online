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

export default function TermeniConditii() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Termeni și Condiții</span>
          </div>
          <h1>Termeni și Condiții</h1>
          <p>Ultima actualizare: ianuarie 2025</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)' }}>

            <p style={{ color: 'var(--text-light)', lineHeight: 1.8, marginBottom: 32, fontSize: '0.93rem' }}>
              Vă rugăm să citiți cu atenție acești Termeni și Condiții înainte de a utiliza platforma Mate-Online. Prin crearea unui cont sau utilizarea serviciilor noastre, acceptați în totalitate termenii de mai jos.
            </p>

            <Section title="1. Descrierea serviciului">
              <p>
                Mate-Online este o platformă educațională online care oferă materiale de matematică (exerciții PDF, teste interactive și manuale digitale) pentru elevii din clasele V–XII, precum și pentru pregătirea Evaluării Naționale și a Bacalaureatului. Platforma este operată de Costea Radu Ioan.
              </p>
            </Section>

            <Section title="2. Condiții de utilizare">
              <p>Pentru a utiliza platforma, trebuie să:</p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Ai cel puțin 13 ani. Dacă ești minor, utilizarea platformei se face cu acordul părinților sau tutorilor legali.</li>
                <li>Furnizezi informații corecte și actuale la înregistrare.</li>
                <li>Păstrezi confidențialitatea datelor de autentificare ale contului tău.</li>
                <li>Nu utilizezi platforma în scopuri ilegale sau neautorizate.</li>
              </ul>
            </Section>

            <Section title="3. Conturi de utilizator">
              <p>
                Fiecare utilizator poate deține un singur cont. Ești responsabil pentru toate activitățile desfășurate prin contul tău. În cazul în care suspectezi accesul neautorizat al unui terț la contul tău, ne informezi imediat. Ne rezervăm dreptul de a suspenda sau închide conturi care încalcă acești termeni.
              </p>
            </Section>

            <Section title="4. Abonamente și plăți">
              <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li><strong>Conținut gratuit:</strong> O parte din materialele PDF sunt disponibile gratuit tuturor utilizatorilor înregistrați.</li>
                <li><strong>Abonament Premium:</strong> Accesul complet la toate materialele necesită un abonament lunar de 50 lei, facturat automat prin Stripe.</li>
                <li><strong>Anulare:</strong> Poți anula abonamentul oricând din secțiunea „Contul meu". Accesul Premium rămâne activ până la sfârșitul perioadei plătite.</li>
                <li><strong>Rambursări:</strong> Nu oferim rambursări pentru perioadele parțiale de abonament, cu excepția cazurilor prevăzute de legislația în vigoare.</li>
                <li><strong>Modificarea prețurilor:</strong> Ne rezervăm dreptul de a modifica prețul abonamentului. Modificările vor fi comunicate cu cel puțin 30 de zile înainte.</li>
              </ul>
            </Section>

            <Section title="5. Proprietate intelectuală">
              <p>
                Toate materialele disponibile pe platformă (exerciții, teste, manuale, design, cod sursă) sunt proprietatea Mate-Online sau ale partenerilor licențiatori și sunt protejate de legislația privind drepturile de autor. Este interzisă reproducerea, distribuirea, publicarea sau vânzarea oricărui conținut de pe platformă fără acordul scris prealabil.
              </p>
            </Section>

            <Section title="6. Utilizare acceptabilă">
              <p>Prin utilizarea platformei, te obligi să nu:</p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Distribui materialele premium unor terți neabonați.</li>
                <li>Încerci să accesezi conținut pentru care nu ai drepturi.</li>
                <li>Utilizezi metode automate (boți, scraping) pentru extragerea conținutului.</li>
                <li>Interferezi cu funcționarea normală a platformei.</li>
                <li>Creezi conturi false sau multiple.</li>
              </ul>
            </Section>

            <Section title="7. Limitarea răspunderii">
              <p>
                Mate-Online oferă materialele educaționale „ca atare", fără garanții privind completitudinea sau acuratețea absolută a conținutului. Nu ne asumăm răspunderea pentru rezultatele școlare ale utilizatorilor. Platforma poate fi temporar indisponibilă din cauza lucrărilor de mentenanță, fără preaviz.
              </p>
            </Section>

            <Section title="8. Modificarea serviciului">
              <p>
                Ne rezervăm dreptul de a modifica, suspenda sau întrerupe orice parte a serviciului în orice moment, cu sau fără notificare prealabilă. Nu vom fi răspunzători față de tine sau față de terți pentru orice modificare, suspendare sau întrerupere a serviciului.
              </p>
            </Section>

            <Section title="9. Legea aplicabilă">
              <p>
                Acești termeni sunt guvernați de legislația română. Orice litigiu va fi soluționat de instanțele competente din România. Dacă orice prevedere a acestor termeni este considerată nulă sau inaplicabilă, restul prevederilor rămân în vigoare.
              </p>
            </Section>

            <Section title="10. Contact">
              <p>
                Pentru orice întrebări legate de acești termeni:<br />
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
