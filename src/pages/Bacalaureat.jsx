import ContentPage from '../components/ContentPage';

const tabs = [
  { id: 'pdf',         label: '📄 Teste PDF' },
  { id: 'interactive', label: '🧩 Teste Interactive' },
];

export default function Bacalaureat() {
  return (
    <ContentPage
      category="bacalaureat"
      title="Bacalaureat"
      subtitle="Teste și exerciții pentru pregătirea examenului de bacalaureat la matematică"
      breadcrumb="Bacalaureat"
      tabs={tabs}
      emptyIcons={{ pdf: '🎓', interactive: '🧩' }}
    />
  );
}
