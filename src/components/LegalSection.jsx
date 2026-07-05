// src/components/LegalSection.jsx — secțiune reutilizabilă pentru paginile legale
export default function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--navy)', marginBottom: 12, paddingBottom: 8, borderBottom: '2px solid #f0f4f8' }}>
        {title}
      </h2>
      <div style={{ color: 'var(--text)', lineHeight: 1.8, fontSize: '0.93rem' }}>
        {children}
      </div>
    </div>
  );
}
