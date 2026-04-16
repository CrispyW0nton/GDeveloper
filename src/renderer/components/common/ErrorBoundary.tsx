/**
 * Global Error Boundary — Sprint 15.1
 * Catches unhandled React rendering errors in the entire renderer tree.
 * Displays a themed recovery screen instead of a blank white crash page.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Log to console for developer visibility
    console.error('[ErrorBoundary] Uncaught renderer error:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleDismiss = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;

      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#000', color: '#e0e0e0', fontFamily: '"JetBrains Mono", monospace',
        }}>
          <div style={{
            maxWidth: 600, width: '90%', padding: '2rem',
            border: '1px solid rgba(255, 60, 60, 0.4)',
            borderRadius: 8, background: 'rgba(30, 0, 0, 0.85)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff4444" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ff4444' }}>
                Renderer Crash Detected
              </span>
            </div>

            {/* Error message */}
            <div style={{ fontSize: 12, color: '#ccc', marginBottom: 12, lineHeight: 1.6 }}>
              An unexpected error occurred in the GDeveloper UI.
              Your data is safe. You can try dismissing this screen or reloading the app.
            </div>

            {/* Error details */}
            <details style={{ marginBottom: 16 }}>
              <summary style={{
                fontSize: 11, color: '#888', cursor: 'pointer',
                userSelect: 'none', marginBottom: 8,
              }}>
                Error details
              </summary>
              <pre style={{
                fontSize: 10, color: '#ff8888',
                background: 'rgba(0,0,0,0.5)', padding: 12,
                borderRadius: 4, overflow: 'auto', maxHeight: 200,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {error?.message || 'Unknown error'}
                {'\n\n'}
                {error?.stack || ''}
                {errorInfo?.componentStack ? `\n\nComponent stack:${errorInfo.componentStack}` : ''}
              </pre>
            </details>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={this.handleDismiss} style={{
                flex: 1, padding: '8px 16px', fontSize: 12,
                background: 'transparent', color: '#aaa',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 4, cursor: 'pointer',
              }}>
                Dismiss &amp; Try Again
              </button>
              <button onClick={this.handleReload} style={{
                flex: 1, padding: '8px 16px', fontSize: 12,
                background: 'rgba(255, 60, 60, 0.15)', color: '#ff6666',
                border: '1px solid rgba(255, 60, 60, 0.3)',
                borderRadius: 4, cursor: 'pointer',
              }}>
                Reload App
              </button>
            </div>

            {/* Footer */}
            <div style={{ marginTop: 16, fontSize: 9, color: '#555', textAlign: 'center' }}>
              GDeveloper v5.1 &middot; Sprint 15.1 Error Boundary
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
