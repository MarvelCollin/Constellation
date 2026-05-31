import { useEffect, useMemo, useState } from "react";
import type { ConnectedServerState, HardwareSnapshot } from "../../../../shared/hardware";
import type { LendState } from "../../../../shared/ai";

type LendResourcesPanelProps = {
  connection: ConnectedServerState | null;
  hardware: HardwareSnapshot | null;
  lendState: LendState | null;
  busy: boolean;
  error: string | null;
  onStart: (options: { port: number; vramMb: number; ramMb: number }) => Promise<void>;
  onStop: () => Promise<void>;
  onRefresh: () => Promise<void>;
};

const DEFAULT_PORT = 50052;

function totalFreeVram(hardware: HardwareSnapshot | null) {
  if (!hardware) {
    return 0;
  }

  return hardware.gpus.reduce((sum, gpu) => sum + (gpu.memory_free_mb || 0), 0);
}

function freeRamMb(hardware: HardwareSnapshot | null) {
  if (!hardware || hardware.memory_free_bytes === null) {
    return 0;
  }

  return Math.floor(hardware.memory_free_bytes / (1024 * 1024));
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
  const maxVram = useMemo(() => totalFreeVram(hardware), [hardware]);
  const maxRam = useMemo(() => freeRamMb(hardware), [hardware]);
  const initialVram = Math.floor(maxVram * 0.75);
  const initialRam = Math.floor(maxRam * 0.5);
  const [port, setPort] = useState(DEFAULT_PORT);
  const [vramMb, setVramMb] = useState(initialVram);
  const [ramMb, setRamMb] = useState(initialRam);
  const running = lendState?.running === true;

  useEffect(() => {
    if (maxVram > 0 && vramMb === 0) {
      setVramMb(Math.floor(maxVram * 0.75));
    }

    if (maxRam > 0 && ramMb === 0) {
      setRamMb(Math.floor(maxRam * 0.5));
    }
  }, [maxVram, maxRam]);

  useEffect(() => {
    void onRefresh();
  }, []);

  const canStart = Boolean(connection) && !running && !busy;
  const statusText = running ? "Lending resources" : "Idle";
  const statusToneClass = running
    ? "bg-timeline-grep/40 text-ink"
    : "bg-surface-strong text-muted";

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
            Start an llama.cpp rpc-server next to your llama-server binary, then advertise capacity to the host.
            The host can attach your GPU when it loads a model.
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
              onClick={() => void onStart({ port, vramMb, ramMb })}
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

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
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
            VRAM budget ({maxVram} MB free)
          </span>
          <input
            className="h-10 rounded-[8px] border border-hairline-strong bg-surface-card px-3 text-[14px] text-ink outline-none focus:border-ink"
            disabled={running || busy}
            max={Math.max(maxVram, 0)}
            min={0}
            onChange={(event) =>
              setVramMb(Math.max(0, Math.min(maxVram, Number(event.currentTarget.value))))
            }
            step={128}
            type="number"
            value={vramMb}
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
