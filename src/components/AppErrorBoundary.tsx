import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  declare props: Readonly<Props>;
  declare setState: Component<Props, State>['setState'];
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const scope = this.props.label ?? 'app';
    console.error(`[Sandbox] error boundary (${scope}):`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const scope = this.props.label ?? 'app';
      return (
        <div className="min-h-[12rem] flex flex-col items-center justify-center gap-4 p-8 bg-[var(--bg-void)] text-[var(--text)]">
          <p className="font-display text-xl font-bold text-accent">Sandbox Music</p>
          <p className="text-sm text-[var(--text-mid)] max-w-md text-center">
            Something went wrong in {scope}. Refresh the page or go back and try again.
          </p>
          <pre className="text-xs text-[var(--cl-danger)] max-w-lg overflow-auto p-3 rounded border border-[var(--border)] bg-[var(--bg-card)]">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="px-5 py-2 rounded btn-accent text-sm font-semibold"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded border border-[var(--border)] text-sm"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
