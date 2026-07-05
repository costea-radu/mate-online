import { Link } from 'react-router-dom';

import Section from '../components/LegalSection';

export default function TermeniConditii() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Termeni și Condiții</span>
          </div>
          <h1>Termeni și Condiții</h1>
          <p>Ultima actualizare: iulie 2026</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)' }}>

            <p style={{ color: 'var(--text-light)', lineHeight: 1.8, marginBottom: 32, fontSize: '0.93rem' }}>
              Vă rugăm să citiți cu atenție acești Termeni și Condiții înainte de a utiliza platforma ExamenMate. Prin crearea unui cont sau utilizarea serviciilor noastre, acceptați în totalitate termenii de mai jos.
            </p>

            <Section title="1. Descrierea serviciului">
              <p>
                ExamenMate este o platformă educațională online care oferă materiale de matematică (exerciții PDF, teste interactive și manuale digitale) pentru elevii din clasele V–XII, precum și pentru pregătirea Evaluării Naționale și a Bacalaureatului. Platforma este operată de Costea Radu Ioan.
              </p>
            </Section>

            <Section title="2. Condiții de utilizare">
              <p>Pentru a utiliza platforma, trebuie să:</p>
              <ul style={{ marginTop: 10, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Ai cel puțin 13 ani. Dacă ești minor, utilizarea platformei se face cu acordul părinților sau tutorilor legali.</li>
                <li>Furnizezi informații corecte și actuale la înregistrare, indiferent dacă te înregistrezi prin e-mail/parolă sau prin contul Google.</li>
                <li>Păstrezi confidențialitatea datelor de autentificare ale contului tău.</li>
                <li>Nu utilizezi platforma în scopuri ilegale sau neautorizate.</li>
              </ul>
            </Section>

            <Section title="3. Conturi de utilizator">
              <p>
                Fiecare utilizator poate deține un singur cont. Te poți înregistra și autentifica prin e-mail și parolă, prin contul tău Google sau prin contul tău Discord. Prin autentificarea cu Google, ești de acord cu <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Termenii Google</a>. Prin autentificarea cu Discord, ești de acord cu <a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 600 }}>Termenii Discord</a>. Autorizezi ExamenMate să primească informațiile de profil furnizate de aceste servicii (nume, e-mail, fotografie de profil).
              </p>
              <p style={{ marginTop: 10 }}>
                Ești responsabil pentru toate activitățile desfășurate prin contul tău. În cazul în care suspectezi accesul neautorizat al unui terț la contul tău, ne informezi imediat. Ne rezervăm dreptul de a suspenda sau închide conturi care încalcă acești termeni.
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
                Toate materialele disponibile pe platformă (exerciții, teste, manuale, design, cod sursă) sunt proprietatea ExamenMate sau ale partenerilor licențiatori și sunt protejate de legislația privind drepturile de autor. Este interzisă reproducerea, distribuirea, publicarea sau vânzarea oricărui conținut de pe platformă fără acordul scris prealabil.
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

            <Section title="7. Profesorul Virtual (asistent AI)">
              <p>
                Platforma oferă un asistent educațional bazat pe inteligență artificială („Profesorul Virtual"), care generează explicații, exerciții, teste și corectări folosind tehnologia OpenAI. Conținutul generat de AI are caracter orientativ, poate conține erori sau inexactități și <strong>nu înlocuiește</strong> materialele oficiale, manualul sau îndrumarea unui profesor. Îți recomandăm să verifici răspunsurile importante.
              </p>
              <p style={{ marginTop: 12 }}>
                Prin folosirea acestei funcții ești de acord ca întrebările și materialele trimise (text, imagini, voce) să fie procesate de OpenAI conform <Link to="/politica-confidentialitate" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politicii de Confidențialitate</Link>. Te obligi să nu folosești asistentul în scopuri ilegale, pentru a genera conform înșelător, ori pentru a încărca date personale sensibile ale altor persoane.
              </p>
            </Section>

            <Section title="8. Limitarea răspunderii">
              <p>
                ExamenMate oferă materialele educaționale „ca atare", fără garanții privind completitudinea sau acuratețea absolută a conținutului. Nu ne asumăm răspunderea pentru rezultatele școlare ale utilizatorilor. Platforma poate fi temporar indisponibilă din cauza lucrărilor de mentenanță, fără preaviz.
              </p>
            </Section>

            <Section title="9. Servicii terțe">
              <p>
                Platforma utilizează servicii terțe pentru funcționarea sa: Supabase (autentificare și baze de date), Google (autentificare OAuth), Discord (autentificare OAuth), Stripe (procesare plăți, inclusiv Apple Pay și Google Pay) și Vercel (găzduire). Utilizarea acestor servicii este guvernată de propriii termeni și condiții ai fiecărui furnizor. ExamenMate nu este responsabilă pentru disponibilitatea sau funcționarea acestor servicii terțe.
              </p>
            </Section>

            <Section title="10. Modificarea serviciului">
              <p>
                Ne rezervăm dreptul de a modifica, suspenda sau întrerupe orice parte a serviciului în orice moment, cu sau fără notificare prealabilă. Nu vom fi răspunzători față de tine sau față de terți pentru orice modificare, suspendare sau întrerupere a serviciului.
              </p>
            </Section>

            <Section title="11. Legea aplicabilă">
              <p>
                Acești termeni sunt guvernați de legislația română. Orice litigiu va fi soluționat de instanțele competente din România. Dacă orice prevedere a acestor termeni este considerată nulă sau inaplicabilă, restul prevederilor rămân în vigoare.
              </p>
            </Section>

            <Section title="12. Contact">
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
