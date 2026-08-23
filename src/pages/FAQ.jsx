import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AI_STACK } from '../lib/aiModels';

// „Pastilă" cu numele unui model (folosită în răspunsurile despre AI)
function ModelChip({ children, intern }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: '0.76rem', fontWeight: 700,
      margin: '2px 4px 2px 0', whiteSpace: 'nowrap',
      background: intern ? '#f3e5f5' : 'rgba(232,185,49,.12)',
      border: `1px solid ${intern ? '#d7b8e8' : 'rgba(232,185,49,.5)'}`,
      color: intern ? '#5b2c83' : 'var(--navy)',
    }}>{children}</span>
  );
}

const faqs = [
  // Ancora /faq#ai (linkurile din <AIPoweredBy />, Footer, Despre noi duc aici).
  // Textele despre modele vin din src/lib/aiModels.js → AI_STACK.
  {
    id: 'ai',
    category: 'Profesorul Virtual (AI)',
    items: [
      {
        q: 'Ce modele de inteligență artificială folosește ExamenMate?',
        a: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>Pentru tine, pe site — modele {AI_STACK.clienti.furnizor}:</div>
              <div style={{ marginBottom: 6 }}>{AI_STACK.clienti.modele.map((m) => <ModelChip key={m}>{m}</ModelChip>)}</div>
              <div>Profesorul Virtual, Meditațiile, generatorul de teste și corectarea rezolvărilor rulează pe aceste modele. {AI_STACK.clienti.descriere}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>Pentru uneltele noastre administrative interne — modele {AI_STACK.intern.furnizor}:</div>
              <div style={{ marginBottom: 6 }}>{AI_STACK.intern.modele.map((m) => <ModelChip key={m} intern>{m}</ModelChip>)}</div>
              <div>{AI_STACK.intern.descriere}</div>
            </div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              Actualizăm modelele pe măsură ce apar versiuni mai bune — această pagină reflectă mereu configurația curentă.
            </div>
          </div>
        ),
      },
      {
        q: 'Ce se întâmplă cu întrebările, pozele și înregistrările vocale pe care le trimit Profesorului Virtual?',
        a: (
          <span>
            Sunt transmise către {AI_STACK.clienti.furnizor} strict pentru a genera răspunsul; conform politicii pentru dezvoltatori (API), ele <strong>nu sunt folosite la antrenarea modelelor</strong>. Istoricul conversațiilor rămâne în contul tău, îl poți șterge oricând și dispare definitiv la ștergerea contului. Chatul, pozele și înregistrările vocale NU ajung la {AI_STACK.intern.furnizor}; acolo merge doar generarea exercițiilor din „Meditații" — iar la exercițiile de remediere, exercițiul greșit și răspunsul tău la el, fără nume sau e-mail. Nu introduce date personale sensibile în conversații. Detalii în <Link to="/politica-confidentialitate" style={{ color: 'var(--navy)', fontWeight: 600 }}>Politica de Confidențialitate</Link>, secțiunea „Profesorul Virtual (AI)”.
          </span>
        ),
      },
      {
        q: 'Profesorul Virtual poate greși?',
        a: 'Da. Conținutul generat de AI are caracter orientativ și poate conține erori de calcul sau de raționament — mai ales în testele generate cu numere modificate. Verifică răspunsurile importante cu manualul sau cu profesorul tău și folosește butoanele 👍/👎 de sub fiecare răspuns: feedbackul ajunge la noi și ne ajută să corectăm. La testele interactive din site poți lăsa, după ce le rezolvi, și o notă cu stele plus un comentariu — așa aflăm repede dacă un test are o problemă.',
      },
      {
        q: 'Pot încerca Profesorul Virtual fără abonament?',
        a: 'Da. Orice cont are câteva acțiuni gratuite de probă (o întrebare în chat, o generare de exercițiu etc.). Accesul complet la Profesorul Virtual, Meditații și generatorul de teste face parte din abonamentul Premium, în limitele de utilizare corectă pe care le vezi în „Contul meu” → „Consum AI”.',
      },
    ],
  },
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
        a: 'Da. Intră în „Contul meu”, apoi „Setări cont”, la „Date de autentificare”, și introdu noua adresă; vei primi un email de confirmare, iar schimbarea are loc după ce o confirmi. Alternativ, ne poți scrie la admin.examenmate@gmail.com.',
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
        a: 'Încearcă să te deconectezi și să te reconectezi la cont. Dacă problema persistă, golește cache-ul browserului sau încearcă din alt browser. Dacă tot nu merge, contactează-ne la admin.examenmate@gmail.com.',
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

function FAQItem({ q, a, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
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
  // Ancoră: /faq#ai deschide toate întrebările din categoria respectivă și
  // derulează la ea (cu o mică întârziere — ScrollToTop din App derulează
  // mai întâi pagina la început).
  const { hash } = useLocation();
  const anchor = (hash || '').replace('#', '');
  useEffect(() => {
    if (!anchor) return;
    const t = setTimeout(() => {
      document.getElementById(`faq-${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(t);
  }, [anchor]);

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Întrebări Frecvente</span>
          </div>
          <h1>Întrebări Frecvente</h1>
          <p>Găsești aici răspunsuri la cele mai comune întrebări despre ExamenMate.</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 780 }}>
          {faqs.map(section => (
            <div key={section.category} id={section.id ? `faq-${section.id}` : undefined}
              style={{ background: '#fff', borderRadius: 14, padding: '32px 40px', boxShadow: 'var(--shadow)', marginBottom: 24, scrollMarginTop: 90 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', color: 'var(--navy)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                {section.category}
              </h2>
              <div>
                {section.items.map((item, i) => (
                  <FAQItem key={i} q={item.q} a={item.a} defaultOpen={!!section.id && section.id === anchor} />
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
