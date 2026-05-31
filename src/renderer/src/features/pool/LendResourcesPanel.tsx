import { useEffect, useMemo, useState } from "react";
import type { ConnectedServerState, GpuInfo, HardwareSnapshot } from "../../../../shared/hardware";
import type { LendState } from "../../../../shared/ai";
import { formatVendor } from "../resources/formatHardware";

type LendResourcesPanelProps = {
  connection: ConnectedServerState | null;
  hardware: HardwareSnapshot | null;
  lendState: LendState | null;
  busy: boolean;
  error: string | null;
  onStart: (options: { port: number; vramMb: number; ramMb: number; selectedGpus: number[] }) => Promise<void>;
  onStop: () => Promise<void>;
  onRefresh: () => Promise<void>;
};

const DEFAULT_PORT = 50052;

function freeRamMb(hardware: HardwareSnapshot | null) {
  if (!hardware || hardware.memory_free_bytes === null) {
    return 0;
  }

  return Math.floor(hardware.memory_free_bytes / (1024 * 1024));
}

function gpuLabel(gpu: GpuInfo, index: number) {
  const memory = gpu.memory_free_mb > 0 ? `${gpu.memory_free_mb} MB free` : "VRAM unknown";
  return `#${index} · ${gpu.name} · ${formatVendor(gpu.vendor)} · ${memory}`;
}

export function LendResourcesPanel({
  connection,
  hardware,
  lendState,
  busy,
  error,
  onStart,
  onStop,
  onRefresh,
}: LendResourcesPanelProps) {
  const gpus = hardware?.gpus ?? [];
  const maxRam = useMemo(() => freeRamMb(hardware), [hardware]);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [ramMb, setRamMb] = useState(0);
  const [selectedGpus, setSelectedGpus] = useState<Set<number>>(() => new Set());
  const running = lendState?.running === true;

  useEffect(() => {
    if (gpus.length === 0) {
      setSelectedGpus(new Set());
      return;
    }

    setSelectedGpus((current) => {
      if (current.size > 0) {
        return current;
      }

      const next = new Set<number>();

      for (let index = 0; index < gpus.length; index += 1) {
        if (gpus[index].memory_free_mb > 0 || gpus[index].memory_mb > 0) {
          next.add(index);
        }
      }

      if (next.size === 0 && gpus.length > 0) {
        next.add(0);
      }

      return next;
    });
  }, [gpus.length]);

  useEffect(() => {
    if (maxRam > 0 && ramMb === 0) {
      setRamMb(Math.floor(maxRam * 0.5));
    }
  }, [maxRam]);

  useEffect(() => {
    void onRefresh();
  }, []);

  const selectedVramMb = useMemo(() => {
    let total = 0;

    for (const index of selectedGpus) {
      const gpu = gpus[index];

      if (gpu) {
        total += gpu.memory_free_mb || 0;
      }
    }

    return total;
  }, [gpus, selectedGpus]);

  const canStart =
    Boolean(connection) && !running && !busy && (gpus.length === 0 || selectedGpus.size > 0);
  const statusText = running ? "Lending resources" : "Idle";
  const statusToneClass = running
    ? "bg-timeline-grep/40 text-ink"
    : "bg-surface-strong text-muted";

  function toggleGpu(index: number) {
    setSelectedGpus((current) => {
      const next = new Set(current);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  }

  function selectAllGpus() {
    setSelectedGpus(new Set(gpus.map((_, index) => index)));
  }

  function clearGpus() {
    setSelectedGpus(new Set());
  }

  return (
    <section
      aria-labelledby="lend-heading"
      className="rounded-[12px] border border-hairline bg-surface-card p-6 md:p-8 mt-6"
    >
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.88px] ${statusToneClass}`}
          >
            {statusText}
          </span>
          <h2 id="lend-heading" className="text-[22px] font-normal tracking-[-0.11px] text-ink">
            Lend GPU and RAM
          </h2>
          <p className="text-[14px] leading-relaxed text-body max-w-prose">
            Choose which GPUs to share, then start an llama.cpp rpc-server next to your llama-server
            binary. The host can attach selected GPUs when it loads a model.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {running ? (
            <button
              className="inline-flex h-10 items-center rounded-[8px] border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink hover:bg-hairline-soft disabled:opacity-60"
              disabled={busy}
              onClick={() => void onStop()}
              type="button"
            >
              Stop lending
            </button>
          ) : (
            <button
              className="inline-flex h-11 items-center rounded-[8px] bg-ink px-5 text-[14px] font-medium text-canvas hover:bg-ink/90 disabled:opacity-60"
              disabled={!canStart}
              onClick={() =>
                void onStart({
                  port,
                  vramMb: selectedVramMb,
                  ramMb,
                  selectedGpus: Array.from(selectedGpus).sort((a, b) => a - b),
                })
              }
              type="button"
            >
              {busy ? "Working..." : "Start lending"}
            </button>
          )}
        </div>
      </header>

      {error ? (
        <p className="mt-4 rounded-[8px] border border-error/40 bg-error/10 px-3 py-2 text-[13px] text-ink">
          {error}
        </p>
      ) : null}

      {!connection ? (
        <p className="mt-4 rounded-[8px] border border-dashed border-hairline bg-canvas-soft px-3 py-3 text-[13px] text-body">
          Connect to a host first - lending publishes your address to that host.
        </p>
      ) : null}

      <div className="mt-6 rounded-[8px] border border-hairline bg-canvas-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-ink">
            GPUs to share <span className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">{selectedGpus.size} of {gpus.length}</span>
          </h3>
          <div className="flex gap-3 text-[12px]">
            <button
              className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
              disabled={running || busy || gpus.length === 0 || selectedGpus.size === gpus.length}
              onClick={selectAllGpus}
              type="button"
            >
              Select all
            </button>
            <span aria-hidden className="text-muted">·</span>
            <button
              className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
              disabled={running || busy || selectedGpus.size === 0}
              onClick={clearGpus}
              type="button"
            >
              Clear
            </button>
          </div>
        </div>

        {gpus.length === 0 ? (
          <p className="mt-3 text-[13px] text-body">
            No GPUs detected. You can still lend CPU/RAM by leaving the GPU list empty.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {gpus.map((gpu, index) => {
              const checked = selectedGpus.has(index);

              return (
                <li
                  key={`${gpu.name}-${index}`}
                  className={`flex items-center gap-3 rounded-[8px] border px-3 py-2 ${
                    checked ? "border-ink bg-surface-card" : "border-hairline bg-surface-card"
                  }`}
                >
                  <input
                    checked={checked}
                    className="h-4 w-4 accent-ink"
                    disabled={running || busy}
                    onChange={() => toggleGpu(index)}
                    type="checkbox"
                  />
                  <span className="font-mono text-[12px] text-ink break-all">{gpuLabel(gpu, index)}</span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.4px] text-muted">
          Combined VRAM offered: <strong className="text-ink">{selectedVramMb} MB</strong>
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.88px] text-muted">RPC port</span>
          <input
            className="h-10 rounded-[8px] border border-hairline-strong bg-surface-card px-3 text-[14px] text-ink outline-none focus:border-ink"
            disabled={running || busy}
            max={65535}
            min={1024}
            onChange={(event) => setPort(Math.max(1024, Math.min(65535, Number(event.currentTarget.value))))}
            type="number"
            value={port}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.88px] text-muted">
            RAM fallback ({maxRam} MB free)
          </span>
          <input
            className="h-10 rounded-[8px] border border-hairline-strong bg-surface-card px-3 text-[14px] text-ink outline-none focus:border-ink"
            disabled={running || busy}
            max={Math.max(maxRam, 0)}
            min={0}
            onChange={(event) =>
              setRamMb(Math.max(0, Math.min(maxRam, Number(event.currentTarget.value))))
            }
            step={256}
            type="number"
            value={ramMb}
          />
        </label>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-[8px] border border-hairline bg-canvas-soft p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">RPC URL</dt>
          <dd className="mt-1 font-mono text-[13px] text-ink break-all">
            {lendState?.rpcUrl ?? "Not running"}
          </dd>
        </div>
        <div className="rounded-[8px] border border-hairline bg-canvas-soft p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">Host offer id</dt>
          <dd className="mt-1 font-mono text-[13px] text-ink break-all">
            {lendState?.offerId ?? "No offer"}
          </dd>
        </div>
        <div className="rounded-[8px] border border-hairline bg-canvas-soft p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">Status note</dt>
          <dd className="mt-1 text-[13px] text-ink leading-relaxed">
            {lendState?.message ?? "Not lending yet."}
          </dd>
        </div>
      </dl>

      {lendState && lendState.log.length > 0 ? (
        <details className="mt-4 rounded-[8px] border border-hairline bg-canvas-soft p-3 text-[12px] text-body">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.4px] text-muted">
            rpc-server log
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[12px] text-ink">
            {lendState.log.join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
