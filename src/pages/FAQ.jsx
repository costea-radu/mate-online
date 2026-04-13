import { useState } from 'react';
import { Link } from 'react-router-dom';

const faqs = [
  {
    category: 'Cont și Înregistrare',
    items: [
      {
        q: 'Cum îmi creez un cont?',
        a: 'Apasă pe „Înregistrare" din meniul de sus, completează numele, adresa de e-mail și o parolă de minimum 6 caractere, apoi confirmă adresa de e-mail prin linkul primit în inbox.',
      },
      {
        q: 'Am uitat parola. Ce fac?',
        a: 'Pe pagina de autentificare apasă „Ai uitat parola?" și introdu adresa de e-mail. Vei primi un link de resetare a parolei în câteva minute. Verifică și folderul Spam dacă nu găsești e-mailul.',
      },
      {
        q: 'Pot schimba adresa de e-mail asociată contului?',
        a: 'Momentan schimbarea adresei de e-mail se face prin contactarea suportului la costea.radu.ioan@gmail.com. Vom actualiza adresa în cel mai scurt timp.',
      },
      {
        q: 'Pot avea mai multe conturi?',
        a: 'Nu. Termenii și condițiile permit un singur cont per persoană. Conturile duplicate pot fi suspendate.',
      },
    ],
  },
  {
    category: 'Abonament și Plăți',
    items: [
      {
        q: 'Cât costă abonamentul Premium?',
        a: 'Abonamentul Premium costă 50 lei pe lună și se reînnoiește automat. Poți anula oricând, fără penalități.',
      },
      {
        q: 'Ce metode de plată sunt acceptate?',
        a: 'Acceptăm carduri bancare (Visa, Mastercard, American Express) prin procesatorul de plăți Stripe. Nu acceptăm plăți prin transfer bancar sau numerar.',
      },
      {
        q: 'Cum anulez abonamentul?',
        a: 'Din secțiunea „Contul meu" apasă „Gestionează abonamentul". Vei fi redirecționat către portalul Stripe unde poți anula abonamentul în câteva secunde. Accesul Premium rămâne activ până la sfârșitul perioadei plătite.',
      },
      {
        q: 'Se oferă rambursări?',
        a: 'Dacă nu ai accesat conținutul Premium după plată, poți solicita rambursarea în termen de 14 zile. Dacă ai accesat conținutul, rambursarea nu mai este posibilă conform politicii noastre de retur. Detalii complete în Politica de Retur.',
      },
      {
        q: 'Primesc factură pentru abonament?',
        a: 'Da. Stripe generează automat o chitanță la fiecare plată și o trimite pe adresa de e-mail asociată contului tău.',
      },
      {
        q: 'Prețul se poate schimba?',
        a: 'Ne rezervăm dreptul de a modifica prețul abonamentului. Orice modificare va fi comunicată prin e-mail cu cel puțin 30 de zile înainte.',
      },
    ],
  },
  {
    category: 'Conținut și Acces',
    items: [
      {
        q: 'Ce conținut este gratuit?',
        a: 'O parte din exercițiile PDF sunt disponibile gratuit tuturor utilizatorilor care au un cont creat. Conținutul gratuit este marcat cu eticheta „Gratuit".',
      },
      {
        q: 'Ce include abonamentul Premium?',
        a: 'Abonamentul Premium oferă acces complet la toate materialele: toate exercițiile PDF, toate testele interactive, toate manualele online, materiale pentru Evaluare Națională și Bacalaureat (toate profilurile).',
      },
      {
        q: 'Pot descărca materialele PDF?',
        a: 'Da, PDF-urile se deschid direct în browser și pot fi descărcate sau tipărite. Materialele sunt protejate prin drepturi de autor și nu pot fi redistribuite.',
      },
      {
        q: 'Testele interactive funcționează pe telefon?',
        a: 'Da, testele interactive sunt optimizate pentru toate dispozitivele — calculator, tabletă și telefon.',
      },
      {
        q: 'Cât timp am acces la materiale după anularea abonamentului?',
        a: 'Accesul Premium rămâne activ până la data expirării perioadei plătite. După aceea, vei mai putea accesa doar conținutul gratuit.',
      },
    ],
  },
  {
    category: 'Tehnic',
    items: [
      {
        q: 'Nu pot accesa un material deși sunt abonat. Ce fac?',
        a: 'Încearcă să te deconectezi și să te reconectezi la cont. Dacă problema persistă, golește cache-ul browserului sau încearcă din alt browser. Dacă tot nu merge, contactează-ne la costea.radu.ioan@gmail.com.',
      },
      {
        q: 'Ce browsere sunt suportate?',
        a: 'Platforma funcționează optim pe versiunile recente ale Chrome, Firefox, Safari și Edge. Recomandăm actualizarea browserului la cea mai recentă versiune.',
      },
      {
        q: 'Linkul de confirmare a e-mailului nu funcționează.',
        a: 'Linkurile de confirmare expiră după 24 de ore. Încearcă să te autentifici — dacă contul nu e confirmat, îți va fi trimis automat un nou link. Dacă problema persistă, contactează suportul.',
      },
    ],
  },
];

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid #f0f4f8' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 0', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'var(--font-body)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.95rem', paddingRight: 16 }}>{q}</span>
        <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ paddingBottom: 16, color: 'var(--text-light)', lineHeight: 1.8, fontSize: '0.9rem' }}>
          {a}
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Întrebări Frecvente</span>
          </div>
          <h1>Întrebări Frecvente</h1>
          <p>Găsești aici răspunsuri la cele mai comune întrebări despre Mate-Online.</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          {faqs.map(section => (
            <div key={section.category} style={{ background: '#fff', borderRadius: 14, padding: '32px 40px', boxShadow: 'var(--shadow)', marginBottom: 24 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', color: 'var(--navy)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                {section.category}
              </h2>
              <div>
                {section.items.map((item, i) => (
                  <FAQItem key={i} q={item.q} a={item.a} />
                ))}
              </div>
            </div>
          ))}

          <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '32px 40px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.1rem', marginBottom: 10 }}>
              Nu ai găsit răspunsul?
            </div>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', marginBottom: 20 }}>
              Contactează-ne direct și îți răspundem în cel mai scurt timp.
            </p>
            <Link to="/contact" className="btn btn-primary">Mergi la Contact</Link>
          </div>
        </div>
      </section>
    </>
  );
}
