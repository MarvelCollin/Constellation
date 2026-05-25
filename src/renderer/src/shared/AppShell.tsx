import type { ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const platform = window.constellation?.platform ?? "desktop";

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="brand">
          <span className="brand-mark">C</span>
          <strong>Constellation</strong>
        </div>
        <div className="nav-actions">
          <span>Hardware scan</span>
          <span>{platform}</span>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
