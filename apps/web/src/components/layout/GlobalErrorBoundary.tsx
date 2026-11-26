import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('CRITICAL UNCAUGHT EXCEPTION:', error, errorInfo);
  }

  private handleRecover = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private isBulgarian(): boolean {
    try {
      const storedLang = window.localStorage.getItem('wakeflow_language');
      if (storedLang === 'en') {
        return false;
      }
      if (storedLang === 'bg') {
        return true;
      }
      const stored = window.localStorage.getItem('ai_net_ui_store_v1');
      if (stored && stored.includes('"language":"en"')) {
        return false;
      }
      if (document.documentElement.lang === 'en') {
        return false;
      }
    } catch {
      // Ignore storage access errors in error boundary fallback
    }
    return true;
  }

  public render() {
    if (this.state.hasError) {
      const isBg = this.isBulgarian();
      return (
        <div
          className="min-h-screen flex items-center justify-center p-4"
          style={{ background: 'var(--canvas-gradient, #090b1d)' }}
        >
          <div className="max-w-md w-full rounded-[2rem] glass-liquid-modal p-6 text-center shadow-2xl">
            <div className="w-14 h-14 rounded-2xl squircle-badge squircle-rose flex items-center justify-center mx-auto mb-4">
              <AlertOctagon className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-display font-bold ink-primary tracking-tight">
              {isBg ? 'Възникна системна грешка в интерфейса' : 'A UI system error occurred'}
            </h2>
            <p className="text-xs ink-muted mt-2 leading-relaxed break-words">
              {this.state.error?.message ||
                (isBg
                  ? 'Неочакван срив в рендерирането на React компонента.'
                  : 'An unexpected error interrupted rendering of the interface.')}
            </p>
            <button
              type="button"
              onClick={this.handleRecover}
              className="mt-6 px-6 py-2.5 rounded-full liquid-hero-btn font-semibold text-xs flex items-center justify-center gap-2 mx-auto transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isBg ? 'Възстанови сесията' : 'Recover Session'}</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
