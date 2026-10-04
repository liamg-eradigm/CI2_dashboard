import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps one failing part of a page from taking down the whole dashboard: it
 * shows a short message in its place (with a retry) and logs the error.
 */
export class ErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="card" role="alert" data-testid="error-boundary">
        <div>
          <h2 className="card-title">{this.props.label} could not be shown</h2>
          <span className="card-sub">
            {this.state.error.message || "Something went wrong."} If the service was just updated, make sure the API was deployed too, then reload.
          </span>
        </div>
        <div>
          <button className="btn secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </section>
    );
  }
}
