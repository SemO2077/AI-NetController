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
        <div className="min-h-screen bg-[#050811] flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-[2rem] bg-[#0c1424]/80 backdrop-blur-[36px] border border-white/10 p-6 text-center shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto mb-4">
              <AlertOctagon className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              {isBg ? 'Възникна системна грешка в интерфейса' : 'A UI system error occurred'}
            </h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {this.state.error?.message ||
                (isBg
                  ? 'Неочакван срив в рендерирането на React компонента.'
                  : 'An unexpected error interrupted rendering of the interface.')}
            </p>
            <button
              type="button"
              onClick={this.handleRecover}
              className="mt-6 px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white font-semibold text-xs flex items-center justify-center space-x-2 mx-auto transition"
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
