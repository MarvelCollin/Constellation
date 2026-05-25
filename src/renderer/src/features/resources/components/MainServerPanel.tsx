import { useState } from "react";
import type { HostDiagnostics, MainServerState, StartMainServerOptions } from "../../../../../shared/hardware";

type MainServerPanelProps = {
  busy: boolean;
  diagnosticBusy: boolean;
  diagnostics: HostDiagnostics | null;
  error: string | null;
  firewallAllowed: boolean;
  firewallBusy: boolean;
  firewallMessage: string;
  portCleanupBusy: boolean;
  portCleanupMessage: string;
  tunnelBusy: boolean;
  zrokBusy: boolean;
  zrokMessage: string;
  onAllowFirewall: () => void;
  onClearPort: () => void;
  onDiagnose: () => void;
  onEnableZrok: (token: string) => void;
  onStart: (options: StartMainServerOptions) => void;
  onStartTunnel: () => void;
  onStop: () => void;
  onStopTunnel: () => void;
  state: MainServerState | null;
};

export function MainServerPanel({ busy, diagnosticBusy, diagnostics, error, firewallAllowed, firewallBusy, firewallMessage, portCleanupBusy, portCleanupMessage, tunnelBusy, zrokBusy, zrokMessage, onAllowFirewall, onClearPort, onDiagnose, onEnableZrok, onStart, onStartTunnel, onStop, onStopTunnel, state }: MainServerPanelProps) {
  const [zrokToken, setZrokToken] = useState("");
  const running = state?.running ?? false;
  const tunnelRunning = state?.tunnelRunning ?? false;
  const token = state?.token ?? "Generated when server starts";
  const url = state?.tunnelUrl ?? state?.url ?? "Start server to get URL";

  return (
    <section className="server-panel" aria-labelledby="server-heading">
      <div className="server-header">
        <div>
          <span className={running ? "scan-state scan-state-ready" : "scan-state"}>{running ? "Server online" : "Server offline"}</span>
          <h2 id="server-heading">Main node server</h2>
          <p>Start this machine as the coordinator with internet exposure enabled.</p>
        </div>
        <div className="server-actions">
          <button
            className="button-download"
            disabled={busy || running}
            onClick={() => onStart({ exposure: "internet" })}
            type="button"
          >
            {busy && !running ? "Starting..." : "Start server"}
          </button>
          <button className="button-secondary" disabled={busy || !running} onClick={onStop} type="button">
            {busy && running ? "Stopping..." : "Stop"}
          </button>
          <button className="button-secondary" disabled={busy || firewallBusy || firewallAllowed} onClick={onAllowFirewall} type="button">
            {firewallAllowed ? "Firewall allowed" : firewallBusy ? "Opening..." : "Allow firewall"}
          </button>
          <button className="button-secondary" disabled={busy || diagnosticBusy} onClick={onDiagnose} type="button">
            {diagnosticBusy ? "Checking..." : "Check access"}
          </button>
          <button className="button-secondary" disabled={busy || portCleanupBusy || running} onClick={onClearPort} type="button">
            {portCleanupBusy ? "Clearing..." : "Force clear port"}
          </button>
          <button className="button-secondary" disabled={busy || tunnelBusy || !running || tunnelRunning} onClick={onStartTunnel} type="button">
            {tunnelBusy && !tunnelRunning ? "Starting tunnel..." : "Start tunnel"}
          </button>
          <button className="button-secondary" disabled={busy || tunnelBusy || !tunnelRunning} onClick={onStopTunnel} type="button">
            {tunnelBusy && tunnelRunning ? "Stopping tunnel..." : "Stop tunnel"}
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
        <label className="field">
          <span>zrok account token</span>
          <input
            disabled={zrokBusy}
            onChange={(event) => setZrokToken(event.currentTarget.value)}
            placeholder="Paste free zrok token"
            type="password"
            value={zrokToken}
          />
        </label>
        <div className="token-note">
          <span>zrok</span>
          <strong>{zrokMessage}</strong>
          <button className="button-secondary" disabled={zrokBusy || zrokToken.trim().length < 8} onClick={() => onEnableZrok(zrokToken)} type="button">
            {zrokBusy ? "Enabling..." : "Enable zrok"}
          </button>
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
          <span>Exposure</span>
          <strong>{state?.exposure === "internet" ? "Internet" : "LAN"}</strong>
        </div>
        <div>
          <span>Connect URL</span>
          <strong>{url}</strong>
        </div>
        <div>
          <span>LAN URL</span>
          <strong>{state?.lanUrl ?? "Waiting"}</strong>
        </div>
        <div>
          <span>Internet URL</span>
          <strong>{state?.tunnelUrl ?? state?.publicUrl ?? "Requires public IP, port forwarding, or tunnel"}</strong>
        </div>
        <div>
          <span>zrok tunnel</span>
          <strong>{state?.tunnelUrl ?? "Start tunnel after server is online"}</strong>
        </div>
        <div>
          <span>Tunnel status</span>
          <strong>{state?.tunnelNote ?? "zrok public shares are temporary unless you reserve one."}</strong>
        </div>
        <div>
          <span>Join secret</span>
          <strong>{token}</strong>
        </div>
        <div>
          <span>Authentication</span>
          <strong>Generated bearer token</strong>
        </div>
        <div>
          <span>Health endpoint</span>
          <strong>{state?.running ? `${url}/health` : "Waiting"}</strong>
        </div>
        <div>
          <span>Hardware endpoint</span>
          <strong>{state?.running ? `${url}/api/hardware` : "Waiting"}</strong>
        </div>
        <div>
          <span>Exposure note</span>
          <strong>{state?.exposureNote ?? "Firewall access is only local. Public access still needs router port forwarding or a tunnel."}</strong>
        </div>
      </div>
    </section>
  );
}
