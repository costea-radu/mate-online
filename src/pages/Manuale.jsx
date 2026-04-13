import ContentPage from '../components/ContentPage';

const tabs = [
  { id: 'manual',      label: '📖 Auxiliare' },
  { id: 'interactive', label: '🧩 Interactive' },
];

export default function Manuale() {
  return (
    <ContentPage
      category="manuale"
      title="Auxiliare Online"
      subtitle="Auxiliare și materiale digitale de matematică, disponibile oricând"
      breadcrumb="Auxiliare Online"
      tabs={tabs}
      emptyIcons={{ manual: '📖', interactive: '🧩' }}
    />
  );
}
