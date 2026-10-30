// =====================================================================
// src/components/OptiuneSpatiuLucru.jsx — „✍️ Spațiu de lucru" pe testele PDF
// generate de profesor: caroiajul de sub problemele de redactat (ca la
// examen) SAU testul compact, fără el — elevii scriu rezolvările pe o foaie
// separată, iar testul încape pe mai puține pagini.
//
// Folosit în „📄 Generează subiect examen" (src/components/ExamGenerator.jsx)
// și în „🧩 Generează exerciții/teste interactive/PDF"
// (src/components/InteractiveGenForm.jsx + src/pages/ProfesorVirtual.jsx).
// Alegerea ajunge la tipărire prin src/lib/examPrint.js (`workSpace`).
// =====================================================================
export default function OptiuneSpatiuLucru({ value = true, onChange, compact = false, style = null }) {
  const cu = value !== false;
  const seg = (on) => ({
    padding: compact ? '4px 9px' : '6px 12px', fontSize: compact ? '.74rem' : '.8rem', fontWeight: 700,
    cursor: 'pointer', borderRadius: 9, whiteSpace: 'nowrap',
    border: `2px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
    background: on ? 'rgba(232,185,49,.12)' : '#fff', color: 'var(--navy)',
  });
  return (
    <div role="group" aria-label="Spațiu de lucru pe foaia testului"
      style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...(style || {}) }}>
      <span style={{ fontSize: compact ? '.76rem' : '.8rem', fontWeight: 700, color: 'var(--navy)' }}>✍️ Spațiu de lucru pe foaie:</span>
      <button type="button" aria-pressed={cu} style={seg(cu)} onClick={() => onChange && onChange(true)}
        title="Sub fiecare problemă de redactat rămâne un caroiaj pentru rezolvare, ca în modelele oficiale">
        Cu spațiu de lucru
      </button>
      <button type="button" aria-pressed={!cu} style={seg(!cu)} onClick={() => onChange && onChange(false)}
        title="Testul e compact: doar enunțurile, fără caroiaj — elevii scriu rezolvările pe o foaie separată">
        Fără spațiu de lucru
      </button>
      <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
        {cu ? 'caroiaj sub problemele de redactat, ca la examen' : 'test compact — rezolvările se scriu pe o foaie separată'}
      </span>
    </div>
  );
}
