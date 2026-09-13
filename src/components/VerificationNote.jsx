// =====================================================================
// src/components/VerificationNote.jsx — „a fost verificat testul, sau nu?"
//
// După fiecare generare, serverul întoarce raportul verificatorului
// independent (api/_lib/meditatii.js → verifyQuestionSet). Până acum raportul
// venea, dar nu-l arăta nimeni la exerciții/teste interactive — așa se putea
// întâmpla ca verificatorul să nu ruleze LUNI DE ZILE fără ca cineva să
// observe: testul ieșea la fel de frumos, doar că nimeni nu-i mai controlase
// răspunsurile. Rândul ăsta face diferența vizibilă.
//
// Aceeași idee ca bannerul din „Generează subiect examen"
// (src/components/ExamGenerator.jsx).
// =====================================================================
export default function VerificationNote({ report, style = null }) {
  if (!report) return null;
  const ok = report.ran && report.checked > 0;

  const cutie = {
    marginTop: 8, padding: '8px 11px', borderRadius: 8, fontSize: '.78rem', lineHeight: 1.5,
    background: ok ? '#eef7f0' : '#fff4e5',
    border: `1px solid ${ok ? '#cde8d4' : '#f5d7a8'}`,
    color: 'var(--text)',
    ...(style || {}),
  };

  if (ok) {
    return (
      <div style={cutie}>
        🔎 <strong>Verificat:</strong> {report.checked} {report.checked === 1 ? 'item rezolvat' : 'itemi rezolvați'} încă o dată,
        independent{report.model ? ` (${report.model})` : ''} —{' '}
        {report.disagreed
          ? <>{report.disagreed} cu răspuns neconfirmat, {report.dropped ? 'scoși din test' : 'marcați'}{report.regenerated ? ` și ${report.regenerated} înlocuiți` : ''}.</>
          : <>toate răspunsurile confirmate.</>}
        {report.failed ? <> ({report.failed} itemi n-au putut fi verificați.)</> : null}
      </div>
    );
  }

  return (
    <div style={cutie}>
      ⚠️ <strong>Testul NU a fost verificat</strong> de al doilea model — cheile lui n-au fost confirmate de nimeni,
      deci citește-le înainte să dai testul.
      {report.notRun ? <div style={{ marginTop: 3, color: '#8a5a00' }}>Motivul: {report.notRun}</div> : null}
    </div>
  );
}
