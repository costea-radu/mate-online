import { Link } from 'react-router-dom';
import Discussions from '../components/Discussions';

export default function DiscussionsPage() {
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
          <Discussions contentId={null} />
        </div>
      </div>
    </>
  );
}
