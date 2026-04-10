import ContentPage from '../components/ContentPage';

const tabs = [
  { id: 'pdf',         label: '📄 Teste PDF' },
  { id: 'interactive', label: '🧩 Teste Interactive' },
];

export default function EvaluareNationala() {
  return (
    <ContentPage
      category="evaluare-nationala"
      title="Evaluarea Națională"
      subtitle="Teste și exerciții pentru pregătirea examenului de clasa a VIII-a"
      breadcrumb="Evaluare Națională"
      tabs={tabs}
      emptyIcons={{ pdf: '📝', interactive: '🧩' }}
    />
  );
}
