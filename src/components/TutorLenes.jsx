// =====================================================================
// src/components/TutorLenes.jsx — Profesorul Virtual plutitor, încărcat DUPĂ
// prima afișare a paginii (12 nov. 2026).
// Widgetul (src/components/AITutor.jsx) aduce cu el chatul, generatorul de
// teste, spațiul de lucru, vocea și figurile — cam o treime din codul cu care
// pornea site-ul, deși pe prima pagină se vede din el doar un buton rotund.
// Acum vine într-o bucată separată: pagina apare mai repede (mai ales pe
// telefon, pe date mobile), iar butonul apare o clipă mai târziu.
// Dacă bucata nu se poate încărca (rețea slabă, versiune veche în cache) sau
// widgetul dă o eroare, pagina rămâne întreagă — doar fără buton.
// =====================================================================
import { Component, lazy, Suspense } from 'react';
import { reportError } from '../lib/errorReport';

const FloatingTutor = lazy(() => import('./AITutor'));

class FaraWidget extends Component {
  constructor(props) {
    super(props);
    this.state = { picat: false };
  }
  static getDerivedStateFromError() {
    return { picat: true };
  }
  componentDidCatch(error) {
    reportError(error, 'React:FloatingTutor');
  }
  render() {
    return this.state.picat ? null : this.props.children;
  }
}

export default function TutorLenes() {
  return (
    <FaraWidget>
      <Suspense fallback={null}>
        <FloatingTutor />
      </Suspense>
    </FaraWidget>
  );
}
