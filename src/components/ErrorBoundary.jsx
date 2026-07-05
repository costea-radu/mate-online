// src/components/ErrorBoundary.jsx — prinde erorile de randare (fără ecran alb)
import { Component } from 'react';
import { Link } from 'react-router-dom';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary a prins o eroare:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 560, margin: '80px auto', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontFamily: 'var(--font-display)', marginBottom: 10 }}>A apărut o eroare</h1>
          <p style={{ color: 'var(--text-light)', marginBottom: 20 }}>
            Ne pare rău, ceva n-a mers cum trebuie. Reîncarcă pagina sau întoarce-te acasă.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="btn btn-outline btn-sm" onClick={() => window.location.reload()}>
              Reîncarcă
            </button>
            <Link to="/" className="btn btn-primary btn-sm" onClick={() => this.setState({ hasError: false })}>
              Pagina principală
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
