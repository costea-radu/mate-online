import { Link } from 'react-router-dom';

export default function DespreNoi() {
  const values = [
    { icon: '🎯', title: 'Claritate', desc: 'Explicații clare, structurate și adaptate nivelului fiecărui elev — fără jargon inutil.' },
    { icon: '📐', title: 'Rigoare', desc: 'Toate materialele sunt verificate matematic. Nu există scurtături care să creeze confuzii.' },
    { icon: '🚀', title: 'Accesibilitate', desc: 'Jumătate din materiale sunt gratuite. Credem că educația de calitate nu trebuie să fie un privilegiu.' },
    { icon: '🔄', title: 'Actualizare continuă', desc: 'Adăugăm materiale noi în mod regulat, adaptate programei școlare în vigoare.' },
  ];

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Despre Noi</span>
          </div>
          <h1>Despre ExamenMate</h1>
          <p>Platforma de matematică creată de profesori, pentru elevi.</p>
        </div>
      </div>

      <section className="section">
        <div className="container" style={{ maxWidth: 820 }}>

          {/* Misiune */}
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)', marginBottom: 24 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--navy)', marginBottom: 16 }}>
              Misiunea noastră
            </h2>
            <p style={{ color: 'var(--text)', lineHeight: 1.9, fontSize: '0.97rem', marginBottom: 16 }}>
              ExamenMate a luat naștere dintr-o nevoie reală: elevii din România aveau dificultăți în a găsi materiale de matematică de calitate, bine organizate, accesibile oricând și de oriunde. Manualele fizice nu sunt mereu la îndemână, meditațiile sunt costisitoare, iar internetul e plin de resurse disparate și greu de verificat.
            </p>
            <p style={{ color: 'var(--text)', lineHeight: 1.9, fontSize: '0.97rem' }}>
              Am creat Mate-Online pentru a oferi o alternativă: o platformă cu exerciții PDF descărcabile, teste interactive cu feedback instant și manuale digitale — toate organizate pe clase și examene, verificate și actualizate constant.
            </p>
          </div>

          {/* Ce oferim */}
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)', marginBottom: 24 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--navy)', marginBottom: 20 }}>
              Ce oferim
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {[
                { icon: '📄', label: 'Exerciții PDF', desc: 'Fișe de lucru și teste pentru clasele V–XII' },
                { icon: '🧩', label: 'Teste Interactive', desc: 'Exerciții cu feedback instant și explicații' },
                { icon: '📖', label: 'Manuale Online', desc: 'Manuale digitale complete, accesibile oricând' },
                { icon: '📝', label: 'Evaluare Națională', desc: 'Materiale complete pentru examenul de clasa a VIII-a' },
                { icon: '🎓', label: 'Bacalaureat', desc: 'Toate profilurile: Mate-Info, Șt. Naturii, Tehnologic' },
              ].map(item => (
                <div key={item.label} style={{ background: '#f7f9fc', borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>{item.icon}</div>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.9rem', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Valorile noastre */}
          <div style={{ background: '#fff', borderRadius: 14, padding: '40px 48px', boxShadow: 'var(--shadow)', marginBottom: 24 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--navy)', marginBottom: 20 }}>
              Valorile noastre
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {values.map(v => (
                <div key={v.title} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>{v.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>{v.title}</div>
                    <div style={{ color: 'var(--text-light)', fontSize: '0.88rem', lineHeight: 1.6 }}>{v.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '36px 48px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.2rem', marginBottom: 8 }}>
                Vrei să ne contactezi?
              </div>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>
                Suntem deschiși la sugestii, întrebări și colaborări.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link to="/contact" className="btn btn-primary">Contact</Link>
              <Link to="/faq" className="btn btn-lg" style={{ color: '#fff', border: '2px solid rgba(255,255,255,0.3)', padding: '10px 24px' }}>
                Întrebări Frecvente
              </Link>
            </div>
          </div>

        </div>
      </section>
    </>
  );
}
