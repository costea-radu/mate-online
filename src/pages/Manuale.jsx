import ContentPage from '../components/ContentPage';

const tabs = [
  { id: 'interactive', label: '📖 Auxiliare Online' },
];

export default function Manuale() {
  return (
    <ContentPage
      category="manuale"
      title="Auxiliare Online"
      subtitle="Auxiliare și materiale digitale de matematică, disponibile oricând"
      breadcrumb="Auxiliare Online"
      tabs={tabs}
      emptyIcons={{ interactive: '📖' }}
    />
  );
}
