import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("DristiGati render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          boxSizing: "border-box",
          padding: 24,
          background: "#071019",
          color: "#eaf4fb",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <section
          role="alert"
          style={{
            maxWidth: 760,
            padding: 24,
            border: "1px solid #854047",
            borderRadius: 12,
            background: "#101c27",
          }}
        >
          <p style={{ color: "#ff817e", fontWeight: 700 }}>
            Dashboard render error
          </p>
          <h1 style={{ fontSize: 20 }}>The console could not be displayed.</h1>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "#f3c5c3",
            }}
          >
            {this.state.error?.stack || String(this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ padding: "10px 14px", cursor: "pointer" }}
          >
            Reload dashboard
          </button>
        </section>
      </main>
    );
  }
}
