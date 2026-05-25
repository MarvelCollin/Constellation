import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
};

const navigationItems = ["Overview", "Nodes", "Workloads", "Settings"];

export function AppShell({ children }: AppShellProps) {
  const platform = window.constellation?.platform ?? "desktop";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <strong>Constellation</strong>
            <span>AI compute desktop</span>
          </div>
        </div>
        <nav className="navigation" aria-label="Main">
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
        <div className="node-status">
          <span>Platform</span>
          <strong>{platform}</strong>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <h1>Shared compute control</h1>
            <p>Prepare this machine to contribute memory, GPU, storage, and network capacity.</p>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
