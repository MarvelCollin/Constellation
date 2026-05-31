import type { HardwareSnapshot } from "../../../../../shared/hardware";
import { formatBytes, formatGpuMemory, formatVendor } from "../formatHardware";

type HardwareScannerProps = {
  error: string | null;
  onScan: () => void;
  snapshot: HardwareSnapshot | null;
  status: "idle" | "scanning" | "ready" | "error";
};

function statusText(status: HardwareScannerProps["status"]) {
  if (status === "scanning") {
    return "Scanning hardware";
  }

  if (status === "ready") {
    return "Scan complete";
  }

  if (status === "error") {
    return "Scan failed";
  }

  return "Ready to scan";
}

function formatRam(snapshot: HardwareSnapshot | null) {
  if (!snapshot) {
    return "Waiting";
  }

  const total = formatBytes(snapshot.memory_bytes);
  const free = formatBytes(snapshot.memory_free_bytes);
  return `${free} free of ${total}`;
}

function formatGpuSummary(snapshot: HardwareSnapshot | null) {
  if (!snapshot) {
    return "Waiting";
  }

  if (snapshot.gpus.length === 0) {
    return formatVendor(snapshot.gpu_vendor);
  }

  return `${snapshot.gpus.length} GPU detected (${formatVendor(snapshot.gpu_vendor)})`;
}

export function HardwareScanner({ error, onScan, snapshot, status }: HardwareScannerProps) {
  return (
    <section className="scanner-panel" aria-labelledby="scanner-heading">
      <div className="scanner-header">
        <div>
          <span className={`scan-state scan-state-${status}`}>{statusText(status)}</span>
          <h1 id="scanner-heading">Hardware scan</h1>
          <p>Scan this desktop before any RAM, GPU, storage, or hosting capacity is shared.</p>
        </div>
        <button className="button-download" disabled={status === "scanning"} onClick={onScan} type="button">
          {status === "scanning" ? "Scanning..." : "Scan hardware"}
        </button>
      </div>

      {error ? <div className="scan-error">{error}</div> : null}

      <div className="scan-summary">
        <div>
          <span>CPU</span>
          <strong>{snapshot?.cpu_count ? `${snapshot.cpu_count} cores` : "Waiting"}</strong>
        </div>
        <div>
          <span>RAM</span>
          <strong>{formatRam(snapshot)}</strong>
        </div>
        <div>
          <span>GPU</span>
          <strong>{formatGpuSummary(snapshot)}</strong>
        </div>
        <div>
          <span>Storage</span>
          <strong>{formatBytes(snapshot?.storage_free_bytes)} free</strong>
        </div>
      </div>

      <div className="scan-details">
        <div className="scan-detail-list">
          <div>
            <span>Platform</span>
            <strong>{snapshot?.platform ?? "Waiting"}</strong>
          </div>
          <div>
            <span>Python worker</span>
            <strong>{snapshot?.python_version ?? "Waiting"}</strong>
          </div>
          <div>
            <span>Total storage</span>
            <strong>{formatBytes(snapshot?.storage_bytes)}</strong>
          </div>
        </div>
        <div className="gpu-list">
          <span>GPU inventory</span>
          {snapshot?.gpus.length ? (
            snapshot.gpus.map((gpu) => (
              <article key={`${gpu.name}-${gpu.driver}-${gpu.vendor}`}>
                <strong>{gpu.name}</strong>
                <p>
                  {gpu.memory_mb > 0 ? formatGpuMemory(gpu.memory_mb) : "VRAM unknown"}
                  {gpu.memory_free_mb > 0 ? ` - ${formatGpuMemory(gpu.memory_free_mb)} free` : ""}
                  {gpu.driver ? ` - Driver ${gpu.driver}` : ""}
                  {` - ${formatVendor(gpu.vendor)}`}
                </p>
              </article>
            ))
          ) : (
            <p>{snapshot ? "No GPU detected by the system." : "Run a scan to detect local GPUs."}</p>
          )}
        </div>
      </div>
    </section>
  );
}
