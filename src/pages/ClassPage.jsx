import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

const classNames = {
  '5': 'a V-a',
  '6': 'a VI-a',
  '7': 'a VII-a',
  '8': 'a VIII-a',
};

export default function ClassPage() {
  const { grade } = useParams();
  const [activeTab, setActiveTab] = useState('pdf');
  const name = classNames[grade] || grade;

  const tabs = [
    { id: 'pdf', label: '📄 Exerciții PDF' },
    { id: 'interactive', label: '🧩 Exerciții Interactive' },
  ];

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link>
            <span>›</span>
            <span>Clasa {name}</span>
          </div>
          <h1>Clasa {name}</h1>
          <p>Exerciții și teste de matematică pentru clasa {name}</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          <div className="tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'pdf' && (
            <div className="empty-state">
              <div className="empty-state-icon">📄</div>
              <h3>Exerciții PDF – Clasa {name}</h3>
              <p>Exercițiile PDF vor fi adăugate în curând. Revino mai târziu!</p>
            </div>
          )}

          {activeTab === 'interactive' && (
            <div className="empty-state">
              <div className="empty-state-icon">🧩</div>
              <h3>Exerciții Interactive – Clasa {name}</h3>
              <p>Exercițiile interactive vor fi adăugate în curând. Revino mai târziu!</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
