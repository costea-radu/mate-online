import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function EvaluareNationala() {
  const [activeTab, setActiveTab] = useState('pdf');

  const tabs = [
    { id: 'pdf', label: '📄 Teste PDF' },
    { id: 'interactive', label: '🧩 Teste Interactive' },
  ];

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link>
            <span>›</span>
            <span>Evaluare Națională</span>
          </div>
          <h1>Evaluarea Națională</h1>
          <p>Teste și exerciții pentru pregătirea examenului de clasa a VIII-a</p>
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
              <div className="empty-state-icon">📝</div>
              <h3>Teste PDF – Evaluarea Națională</h3>
              <p>Testele PDF vor fi adăugate în curând. Revino mai târziu!</p>
            </div>
          )}

          {activeTab === 'interactive' && (
            <div className="empty-state">
              <div className="empty-state-icon">🧩</div>
              <h3>Teste Interactive – Evaluarea Națională</h3>
              <p>Testele interactive vor fi adăugate în curând. Revino mai târziu!</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
