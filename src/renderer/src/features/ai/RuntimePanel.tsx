import { useEffect, useState } from "react";
import type { DownloadProgress, RuntimeConfig } from "../../../../shared/ai";

type RuntimePanelProps = {
  runtime: RuntimeConfig | null;
  busy: boolean;
  error: string | null;
  onPick: () => void;
  onClear: () => void;
  onOpenReleases: () => void;
  runtimeDownload: DownloadProgress | null;
};

const RELEASES_URL = "https://github.com/ggml-org/llama.cpp/releases";

function platformHint() {
  const platform = window.constellation?.platform ?? "win32";

  if (platform === "win32") {
    return "Download a Windows Vulkan zip (e.g. llama-*-bin-win-vulkan-x64.zip), extract it, then pick llama-server.exe below.";
  }

  if (platform === "darwin") {
    return "Download the macOS release archive and pick llama-server from inside it.";
  }

  return "Download the Linux release archive and pick llama-server from inside it.";
}

function shortenPath(value: string) {
  if (value.length <= 48) {
    return value;
  }

  return `...${value.slice(value.length - 45)}`;
}

export function RuntimePanel({ runtime, busy, error, onPick, onClear, onOpenReleases, runtimeDownload }: RuntimePanelProps) {
  const [hint] = useState(platformHint);

  useEffect(() => {
    if (runtime?.path && !runtime.exists) {
      console.warn("Runtime path is configured but file is missing", runtime.path);
    }
  }, [runtime?.path, runtime?.exists]);

  const configured = runtime !== null && runtime.path !== null && runtime.exists;
  const statusText = configured ? "Runtime ready" : "Runtime not configured";

  return (
    <section className="server-panel ai-panel" aria-labelledby="runtime-heading">
      <div className="server-header">
        <div>
          <span className={configured ? "scan-state scan-state-ready" : "scan-state"}>{statusText}</span>
          <h2 id="runtime-heading">AI runtime</h2>
          <p>Constellation runs llama.cpp. Point it at a downloaded llama-server build for this machine.</p>
        </div>
        <div className="server-actions">
          <button className="button-secondary" onClick={onOpenReleases} type="button">
            Open llama.cpp releases
          </button>
          <button className="button-download" disabled={busy} onClick={onPick} type="button">
            {busy ? "Working..." : configured ? "Change executable" : "Pick llama-server"}
          </button>
          {configured ? (
            <button className="button-secondary" disabled={busy} onClick={onClear} type="button">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="scan-error">{error}</div> : null}

      <div className="server-form">
        <div className="token-note">
          <span>Status</span>
          <strong>
            {configured
              ? `Using ${shortenPath(runtime.path ?? "")}`
              : runtime?.path && !runtime.exists
                ? `Path is configured but the file is missing: ${shortenPath(runtime.path)}`
                : "No runtime configured. Pick an llama-server executable."}
          </strong>
        </div>
        <div className="token-note">
          <span>How to install</span>
          <strong>{hint}</strong>
        </div>
        <div className="token-note">
          <span>Releases page</span>
          <strong>{RELEASES_URL}</strong>
        </div>
      </div>

      {runtimeDownload ? (
        <div className="diagnostic-panel">
          <span>Runtime download</span>
          <strong>{runtimeDownload.status === "active" ? "Downloading runtime archive..." : runtimeDownload.message ?? runtimeDownload.status}</strong>
        </div>
      ) : null}
    </section>
  );
}
