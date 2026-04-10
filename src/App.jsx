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

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Navbar />
        <main style={{ minHeight: 'calc(100vh - 68px - 200px)' }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/clase/:grade" element={<ClassPage />} />
            <Route path="/evaluare-nationala" element={<EvaluareNationala />} />
            <Route path="/bacalaureat" element={<Bacalaureat />} />
            <Route path="/manuale" element={<Manuale />} />
            <Route path="/autentificare" element={<Login />} />
            <Route path="/inregistrare" element={<Register />} />
            <Route path="/preturi" element={<Pricing />} />
            <Route path="/profil" element={<Profile />} />
          </Routes>
        </main>
        <Footer />
      </AuthProvider>
    </BrowserRouter>
  );
}
