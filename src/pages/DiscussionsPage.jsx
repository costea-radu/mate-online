import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Discussions from '../components/Discussions';

export default function DiscussionsPage() {
  const location = useLocation();

  // Scroll la postare dacă vine din căutare
  useEffect(() => {
    if (!location.state?.scrollTo) return;
    const id = location.state.scrollTo;
    const tryScroll = (attempts = 0) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid var(--gold)';
        el.style.borderRadius = '12px';
        setTimeout(() => { el.style.outline = ''; }, 2500);
      } else if (attempts < 10) {
        setTimeout(() => tryScroll(attempts + 1), 300);
      }
    };
    setTimeout(() => tryScroll(), 200);
  }, [location.state]);
  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Discuții</span>
          </div>
          <h1>💬 Discuții și Rezolvări</h1>
          <p>Postează întrebări, comentarii sau rezolvări. Poți atașa poze sau PDF-uri.</p>
        </div>
      </div>
      <div className="content-list">
        <div className="container">
          <Discussions />
        </div>
      </div>
    </>
  );
}
