import { useParams } from 'react-router-dom';
import ContentPage from '../components/ContentPage';

const classNames = {
  '5':  'a V-a',
  '6':  'a VI-a',
  '7':  'a VII-a',
  '8':  'a VIII-a',
  '9':  'a IX-a',
  '10': 'a X-a',
  '11': 'a XI-a',
  '12': 'a XII-a',
};

// 21 nov. 2026 — 📄 PDF prima filă (deschisă implicit), apoi 🧩 interactive: „Pune rubrica PDF
// prima dată, apoi interactive. La toate categoriile: examene și clase". ?tab=interactive /
// ?tab=pdf / ?tab=bareme deschid direct fila cerută (src/components/ContentPage.jsx).
const tabs = [
  { id: 'pdf',         label: '📄 Exerciții PDF' },
  { id: 'interactive', label: '🧩 Exerciții Interactive' },
  // 15 nov. 2026 — baremele fișelor clasei (src/components/BaremeClasa.jsx, api/bareme.js);
  // fila apare doar când secțiunea e vizibilă elevilor (sau pentru admin)
  { id: 'bareme',      label: '📋 Bareme' },
];
// 18 nov. 2026 — exercițiile interactive și PDF-urile, pe CAPITOLE, cu pictogramele hărții
// (`capitole` → src/components/CapitoleClasa.jsx, src/lib/capitoleClasa.js)

export default function ClassPage() {
  const { grade } = useParams();
  const name = classNames[grade] || grade;

  return (
    <ContentPage
      category={`clasa-${grade}`}
      title={`Clasa ${name}`}
      subtitle={`Exerciții și teste de matematică pentru clasa ${name}`}
      breadcrumb={`Clasa ${name}`}
      tabs={tabs}
      emptyIcons={{ pdf: '📄', interactive: '🧩', bareme: '📋' }}
      capitole
      bareme
    />
  );
}
