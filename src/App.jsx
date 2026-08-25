import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ErrorBoundary from './components/ErrorBoundary';
import FloatingTutor from './components/AITutor';
import InstallPrompt from './components/InstallPrompt';
import CookieConsent from './components/CookieConsent';
import { Analytics } from '@vercel/analytics/react';
import { initAnalytics, trackPageView } from './lib/analytics';
import Home from './pages/Home';

// ─── Rute încărcate la cerere (code-splitting) — reduc JS-ul inițial ─────────
const ClassPage = lazy(() => import('./pages/ClassPage'));
const EvaluareNationala = lazy(() => import('./pages/EvaluareNationala'));
const Bacalaureat = lazy(() => import('./pages/Bacalaureat'));
const Manuale = lazy(() => import('./pages/Manuale'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ResetareParola = lazy(() => import('./pages/ResetareParola'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Profile = lazy(() => import('./pages/Profile'));
const Asociere = lazy(() => import('./pages/Asociere'));
const Admin = lazy(() => import('./pages/Admin'));
const InteractiveViewer = lazy(() => import('./pages/InteractiveViewer'));
const PDFViewer = lazy(() => import('./pages/PDFViewer'));
const DiscussionsPage = lazy(() => import('./pages/DiscussionsPage'));
const RezolvariPage = lazy(() => import('./pages/RezolvariPage'));
const ArticolPage = lazy(() => import('./pages/ArticolPage'));
const Contact = lazy(() => import('./pages/Contact'));
const PoliticaConfidentialitate = lazy(() => import('./pages/PoliticaConfidentialitate'));
const TermeniConditii = lazy(() => import('./pages/TermeniConditii'));
const PoliticaCookies = lazy(() => import('./pages/PoliticaCookies'));
const PoliticaRetur = lazy(() => import('./pages/PoliticaRetur'));
const FAQ = lazy(() => import('./pages/FAQ'));
const DespreNoi = lazy(() => import('./pages/DespreNoi'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ProfesorVirtual = lazy(() => import('./pages/ProfesorVirtual'));
const Meditatii = lazy(() => import('./pages/Meditatii'));
const AssignmentSolver = lazy(() => import('./pages/AssignmentSolver'));
const BibliotecaUtilizatorilor = lazy(() => import('./pages/BibliotecaUtilizatorilor'));
const ExercitiuAIViewer = lazy(() => import('./pages/ExercitiuAIViewer'));
const Recenzii = lazy(() => import('./pages/Recenzii'));

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    // Nu resetăm scroll-ul dacă ne întoarcem de la un viewer cu card de restaurat
    if (location.state?.scrollToCardId) return;
    window.scrollTo(0, 0);
  }, [location.pathname, location.state]);
  return null;
}

// Site-ul e un SPA: schimbarea rutei nu reîncarcă pagina, deci GA4 și Meta
// Pixel nu află singure de ea. Trimitem noi câte o vizualizare per rută.
// (Nimic nu pleacă până când vizitatorul nu acceptă cookie-urile de analiză.)
function AnalyticsRouteTracker() {
  const location = useLocation();
  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
  return null;
}

function Layout({ children }) {
  const { pathname } = useLocation();
  const fullscreen = pathname === '/admin' || pathname === '/exercitiu' || pathname === '/pdf-viewer' || pathname === '/exercitiu-ai';

  // Viewerele ocupă exact înălțimea ferestrei (100vh) și au scroll intern.
  // Blocăm scroll-ul documentului cât timp sunt deschise — altfel apare uneori
  // o bară de derulare în plus (ultima din dreapta) care duce la o zonă goală.
  const lockScroll = pathname === '/exercitiu' || pathname === '/pdf-viewer' || pathname === '/exercitiu-ai';
  useEffect(() => {
    if (!lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.scrollTo(0, 0);
    return () => { document.body.style.overflow = prev; };
  }, [lockScroll]);

  return (
    <>
      {!fullscreen && <Navbar />}
      <main style={fullscreen ? {} : { minHeight: 'calc(100vh - 68px - 200px)' }}>
        {children}
      </main>
      {!fullscreen && <Footer />}
      {!fullscreen && <FloatingTutor />}
      {!fullscreen && <InstallPrompt />}
    </>
  );
}

function PageFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
      <div className="spinner" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <ScrollToTop />
          <AnalyticsRouteTracker />
          <Layout>
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/clase/:grade" element={<ClassPage />} />
                <Route path="/evaluare-nationala" element={<EvaluareNationala />} />
                <Route path="/bacalaureat" element={<Bacalaureat />} />
                <Route path="/bacalaureat/:profile" element={<Bacalaureat />} />
                <Route path="/manuale" element={<Manuale />} />
                <Route path="/autentificare" element={<Login />} />
                <Route path="/inregistrare" element={<Register />} />
                <Route path="/resetare-parola" element={<ResetareParola />} />
                <Route path="/preturi" element={<Pricing />} />
                <Route path="/profil" element={<Profile />} />
                <Route path="/asociere" element={<Asociere />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/exercitiu" element={<InteractiveViewer />} />
                <Route path="/exercitiu-ai" element={<ExercitiuAIViewer />} />
                <Route path="/pdf-viewer" element={<PDFViewer />} />
                <Route path="/discutii" element={<DiscussionsPage />} />
                <Route path="/rezolvari" element={<RezolvariPage />} />
                <Route path="/rezolvari/:slug" element={<ArticolPage />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/politica-confidentialitate" element={<PoliticaConfidentialitate />} />
                <Route path="/termeni-conditii" element={<TermeniConditii />} />
                <Route path="/politica-cookies" element={<PoliticaCookies />} />
                <Route path="/politica-retur" element={<PoliticaRetur />} />
                <Route path="/faq" element={<FAQ />} />
                <Route path="/despre-noi" element={<DespreNoi />} />
                <Route path="/profesor-virtual" element={<ProfesorVirtual />} />
                <Route path="/meditatii" element={<Meditatii />} />
                <Route path="/tema" element={<AssignmentSolver />} />
                <Route path="/biblioteca-utilizatorilor" element={<BibliotecaUtilizatorilor />} />
                <Route path="/recenzii" element={<Recenzii />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </Layout>
          <CookieConsent />
          <Analytics />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
