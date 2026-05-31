import { useState } from "react";
import type { ConnectMainServerRequest, ConnectedServerState } from "../../../../../shared/hardware";
import { formatBytes, formatGpuMemory, formatVendor } from "../formatHardware";

type ConnectServerPanelProps = {
  busy: boolean;
  connection: ConnectedServerState | null;
  error: string | null;
  onConnect: (request: ConnectMainServerRequest) => void;
};

export function ConnectServerPanel({ busy, connection, error, onConnect }: ConnectServerPanelProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const canConnect = url.trim().length > 0 && token.trim().length >= 8;
  const statusText = connection ? "Connected to server" : "Not connected";
  const gpuText = connection?.hardware.gpus.length
    ? connection.hardware.gpus
        .map((gpu) => `${gpu.name} (${gpu.memory_mb > 0 ? formatGpuMemory(gpu.memory_mb) : formatVendor(gpu.vendor)})`)
        .join(", ")
    : connection
      ? formatVendor(connection.hardware.gpu_vendor)
      : "Waiting";

  return (
    <section className="server-panel" aria-labelledby="connect-heading">
      <div className="server-header">
        <div>
          <span className={connection ? "scan-state scan-state-ready" : "scan-state"}>{statusText}</span>
          <h2 id="connect-heading">Connect to main server</h2>
          <p>{connection ? "This laptop is joined and can use the remote coordinator." : "Join another coordinator with the shared URL and join secret."}</p>
        </div>
        <div className="server-actions">
          <button
            className="button-download"
            disabled={busy || !canConnect}
            onClick={() => onConnect({ url, token })}
            type="button"
          >
            {busy ? "Connecting..." : connection ? "Reconnect" : "Connect"}
          </button>
        </div>
      </div>

      {error ? <div className="scan-error">{error}</div> : null}

      <div className="server-form">
        <label className="field">
          <span>Server URL</span>
          <input
            disabled={busy}
            onChange={(event) => setUrl(event.currentTarget.value)}
            placeholder="http://192.168.1.20:8765"
            type="url"
            value={url}
          />
        </label>
        <label className="field">
          <span>Join secret</span>
          <input
            disabled={busy}
            minLength={8}
            onChange={(event) => setToken(event.currentTarget.value)}
            placeholder="Join secret"
            type="password"
            value={token}
          />
        </label>
      </div>

      <div className="server-grid">
        <div>
          <span>Connected URL</span>
          <strong>{connection?.url ?? "Waiting"}</strong>
        </div>
        <div>
          <span>Remote CPU</span>
          <strong>{connection?.hardware.cpu_count ? `${connection.hardware.cpu_count} cores` : "Waiting"}</strong>
        </div>
        <div>
          <span>Remote RAM</span>
          <strong>
            {connection
              ? `${formatBytes(connection.hardware.memory_free_bytes)} free of ${formatBytes(connection.hardware.memory_bytes)}`
              : "Waiting"}
          </strong>
        </div>
        <div>
          <span>Remote GPU</span>
          <strong>{gpuText}</strong>
        </div>
      </div>
    </section>
  );
}
