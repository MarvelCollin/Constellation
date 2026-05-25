import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
};

const navigationItems = ["Overview", "Nodes", "Workloads", "Settings"];

export function AppShell({ children }: AppShellProps) {
  const platform = window.constellation?.platform ?? "desktop";

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">
          <span className="brand-mark">C</span>
          <strong>Constellation</strong>
        </div>
        <nav className="navigation" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <button
              className={item === "Overview" ? "nav-item active" : "nav-item"}
              key={item}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
        <div className="nav-actions">
          <span>{platform}</span>
          <button className="button-primary" type="button">
            Prepare node
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
