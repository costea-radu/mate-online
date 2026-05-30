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

const tabs = [
  { id: 'interactive', label: '🧩 Exerciții Interactive' },
  { id: 'pdf',         label: '📄 Exerciții PDF' },
];

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
      emptyIcons={{ pdf: '📄', interactive: '🧩' }}
    />
  );
}
