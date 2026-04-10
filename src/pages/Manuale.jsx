import ContentPage from '../components/ContentPage';

const tabs = [
  { id: 'manual', label: '📖 Manuale' },
];

export default function Manuale() {
  return (
    <ContentPage
      category="manuale"
      title="Manuale Online"
      subtitle="Manuale digitale de matematică, disponibile oricând"
      breadcrumb="Manuale Online"
      tabs={tabs}
      emptyIcons={{ manual: '📖' }}
    />
  );
}
