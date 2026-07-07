import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ErrorBoundary from './components/ErrorBoundary';
import FloatingTutor from './components/AITutor';
import InstallPrompt from './components/InstallPrompt';
import { Analytics } from '@vercel/analytics/react';
import Home from './pages/Home';

// ─── Rute încărcate la cerere (code-splitting) — reduc JS-ul inițial ─────────
const ClassPage = lazy(() => import('./pages/ClassPage'));
const EvaluareNationala = lazy(() => import('./pages/EvaluareNationala'));
const Bacalaureat = lazy(() => import('./pages/Bacalaureat'));
const Manuale = lazy(() => import('./pages/Manuale'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Profile = lazy(() => import('./pages/Profile'));
const Asociere = lazy(() => import('./pages/Asociere'));
const Admin = lazy(() => import('./pages/Admin'));
const InteractiveViewer = lazy(() => import('./pages/InteractiveViewer'));
const PDFViewer = lazy(() => import('./pages/PDFViewer'));
const DiscussionsPage = lazy(() => import('./pages/DiscussionsPage'));
const RezolvariPage = lazy(() => import('./pages/RezolvariPage'));
const Contact = lazy(() => import('./pages/Contact'));
const PoliticaConfidentialitate = lazy(() => import('./pages/PoliticaConfidentialitate'));
const TermeniConditii = lazy(() => import('./pages/TermeniConditii'));
const PoliticaCookies = lazy(() => import('./pages/PoliticaCookies'));
const PoliticaRetur = lazy(() => import('./pages/PoliticaRetur'));
const FAQ = lazy(() => import('./pages/FAQ'));
const DespreNoi = lazy(() => import('./pages/DespreNoi'));
const NotFound = lazy(() => import('./pages/NotFound'));
const ProfesorVirtual = lazy(() => import('./pages/ProfesorVirtual'));
const AssignmentSolver = lazy(() => import('./pages/AssignmentSolver'));
const BibliotecaUtilizatorilor = lazy(() => import('./pages/BibliotecaUtilizatorilor'));

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    // Nu resetăm scroll-ul dacă ne întoarcem de la un viewer cu card de restaurat
    if (location.state?.scrollToCardId) return;
    window.scrollTo(0, 0);
  }, [location.pathname, location.state]);
  return null;
}

function Layout({ children }) {
  const { pathname } = useLocation();
  const fullscreen = pathname === '/admin' || pathname === '/exercitiu' || pathname === '/pdf-viewer';
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
                <Route path="/preturi" element={<Pricing />} />
                <Route path="/profil" element={<Profile />} />
                <Route path="/asociere" element={<Asociere />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/exercitiu" element={<InteractiveViewer />} />
                <Route path="/pdf-viewer" element={<PDFViewer />} />
                <Route path="/discutii" element={<DiscussionsPage />} />
                <Route path="/rezolvari" element={<RezolvariPage />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/politica-confidentialitate" element={<PoliticaConfidentialitate />} />
                <Route path="/termeni-conditii" element={<TermeniConditii />} />
                <Route path="/politica-cookies" element={<PoliticaCookies />} />
                <Route path="/politica-retur" element={<PoliticaRetur />} />
                <Route path="/faq" element={<FAQ />} />
                <Route path="/despre-noi" element={<DespreNoi />} />
                <Route path="/profesor-virtual" element={<ProfesorVirtual />} />
                <Route path="/tema" element={<AssignmentSolver />} />
                <Route path="/biblioteca-utilizatorilor" element={<BibliotecaUtilizatorilor />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </Layout>
          <Analytics />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
