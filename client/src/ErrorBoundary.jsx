import { Component } from 'react';

/**
 * Last line of defense: if a render error escapes, show a recovery screen
 * instead of a blank page. Autosaved work is already on the server, so a
 * reload is safe.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center">
        <div className="crash">
          <h1>Something went wrong</h1>
          <p className="muted">
            The page hit an unexpected error. Everything that showed as saved is safe on the server.
          </p>
          <div className="home-actions">
            <button className="btn primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <a className="btn" href="#/" onClick={() => this.setState({ error: null })}>
              Back to documents
            </a>
          </div>
        </div>
      </div>
    );
  }
}
