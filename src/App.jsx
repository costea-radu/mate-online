import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import ClassPage from './pages/ClassPage';
import EvaluareNationala from './pages/EvaluareNationala';
import Bacalaureat from './pages/Bacalaureat';
import Manuale from './pages/Manuale';
import Login from './pages/Login';
import Register from './pages/Register';
import Pricing from './pages/Pricing';
import Profile from './pages/Profile';
import Asociere from './pages/Asociere';
import Admin from './pages/Admin';
import InteractiveViewer from './pages/InteractiveViewer';
import PDFViewer from './pages/PDFViewer';
import DiscussionsPage from './pages/DiscussionsPage';
import RezolvariPage from './pages/RezolvariPage';
import Contact from './pages/Contact';
import PoliticaConfidentialitate from './pages/PoliticaConfidentialitate';
import TermeniConditii from './pages/TermeniConditii';
import PoliticaCookies from './pages/PoliticaCookies';
import PoliticaRetur from './pages/PoliticaRetur';
import FAQ from './pages/FAQ';
import DespreNoi from './pages/DespreNoi';
import NotFound from './pages/NotFound';
import { Analytics } from '@vercel/analytics/react';
import ProfesorVirtual from './pages/ProfesorVirtual';
import FloatingTutor from './components/AITutor';

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
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Layout>
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
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
        <Analytics />
      </AuthProvider>
    </BrowserRouter>
  );
}
