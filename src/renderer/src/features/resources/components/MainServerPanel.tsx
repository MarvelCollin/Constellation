import type { HostDiagnostics, MainServerState } from "../../../../../shared/hardware";

type MainServerPanelProps = {
  busy: boolean;
  diagnosticBusy: boolean;
  diagnostics: HostDiagnostics | null;
  error: string | null;
  firewallMessage: string;
  portCleanupBusy: boolean;
  portCleanupMessage: string;
  tunnelBusy: boolean;
  zrokBusy: boolean;
  zrokMessage: string;
  onClearPort: () => void;
  onDiagnose: () => void;
  onStartSharing: () => void;
  onStop: () => void;
  state: MainServerState | null;
};

export function MainServerPanel({ busy, diagnosticBusy, diagnostics, error, firewallMessage, portCleanupBusy, portCleanupMessage, tunnelBusy, zrokBusy, zrokMessage, onClearPort, onDiagnose, onStartSharing, onStop, state }: MainServerPanelProps) {
  const running = state?.running ?? false;
  const tunnelRunning = state?.tunnelRunning ?? false;
  const setupBusy = busy || tunnelBusy || zrokBusy;
  const token = state?.token ?? "Generated when server starts";
  const shareUrl = state?.tunnelUrl ?? "Start sharing to get public URL";

  return (
    <section className="server-panel" aria-labelledby="server-heading">
      <div className="server-header">
        <div>
          <span className={running ? "scan-state scan-state-ready" : "scan-state"}>{running ? "Server online" : "Server offline"}</span>
          <h2 id="server-heading">Main node server</h2>
          <p>Start this laptop as the coordinator; zrok only exposes it with a public URL.</p>
        </div>
        <div className="server-actions">
          <button
            className="button-download"
            disabled={setupBusy || tunnelRunning}
            onClick={onStartSharing}
            type="button"
          >
            {setupBusy && !tunnelRunning ? "Starting..." : tunnelRunning ? "Sharing" : "Start sharing"}
          </button>
          <button className="button-secondary" disabled={setupBusy || !running} onClick={onStop} type="button">
            {busy && running ? "Stopping..." : "Stop sharing"}
          </button>
          <button className="button-secondary" disabled={setupBusy || diagnosticBusy} onClick={onDiagnose} type="button">
            {diagnosticBusy ? "Checking..." : "Check access"}
          </button>
          <button className="button-secondary" disabled={setupBusy || portCleanupBusy || running} onClick={onClearPort} type="button">
            {portCleanupBusy ? "Clearing..." : "Force clear port"}
          </button>
        </div>
      </div>

      {error ? <div className="scan-error">{error}</div> : null}
      {diagnostics ? (
        <div className="diagnostic-panel">
          <span>Access diagnostics</span>
          <strong>{diagnostics.summary}</strong>
          <div className="diagnostic-list">
            {diagnostics.checks.map((check) => (
              <div className={`diagnostic-item diagnostic-${check.status}`} key={check.label}>
                <span>{check.label}</span>
                <strong>{check.value}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="server-form">
        <div className="token-note">
          <span>zrok</span>
          <strong>{zrokMessage}</strong>
        </div>
        <div className="token-note">
          <span>Authentication</span>
          <strong>The generated token is required for every connection.</strong>
        </div>
        <div className="token-note">
          <span>Firewall</span>
          <strong>{firewallMessage}</strong>
        </div>
        <div className="token-note">
          <span>Port cleanup</span>
          <strong>{portCleanupMessage}</strong>
        </div>
      </div>

      <div className="server-grid">
        <div>
          <span>Share URL</span>
          <strong>{shareUrl}</strong>
        </div>
        <div>
          <span>Share join secret</span>
          <strong>{token}</strong>
        </div>
        <div>
          <span>What friends need</span>
          <strong>Only the share URL and join secret.</strong>
        </div>
      </div>
    </section>
  );
}
