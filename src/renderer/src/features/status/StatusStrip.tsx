import type { AIState, PoolOffer, RuntimeConfig } from "../../../../shared/ai";
import type { MainServerState } from "../../../../shared/hardware";

type StatusTone = "ok" | "warn" | "off";

type StatusItem = {
  label: string;
  value: string;
  tone: StatusTone;
};

type StatusStripProps = {
  server: MainServerState | null;
  runtime: RuntimeConfig | null;
  ai: AIState | null;
  pool: PoolOffer[];
  modelDisplayName: string | null;
};

function toneClass(tone: StatusTone) {
  if (tone === "ok") {
    return "bg-timeline-grep/30 text-ink border-timeline-grep/60";
  }

  if (tone === "warn") {
    return "bg-timeline-thinking/30 text-ink border-timeline-thinking/60";
  }

  return "bg-surface-strong text-muted border-hairline";
}

function dotClass(tone: StatusTone) {
  if (tone === "ok") {
    return "bg-success";
  }

  if (tone === "warn") {
    return "bg-timeline-done";
  }

  return "bg-muted-soft";
}

function serverStatus(server: MainServerState | null): StatusItem {
  if (server?.running) {
    return {
      label: "Server",
      value: `${server.host}:${server.port}`,
      tone: server.tunnelRunning ? "ok" : "ok",
    };
  }

  return { label: "Server", value: "offline", tone: "off" };
}

function runtimeStatus(runtime: RuntimeConfig | null): StatusItem {
  if (runtime?.path && runtime.exists) {
    return { label: "Runtime", value: "ready", tone: "ok" };
  }

  if (runtime?.path && !runtime.exists) {
    return { label: "Runtime", value: "missing file", tone: "warn" };
  }

  return { label: "Runtime", value: "not set", tone: "off" };
}

function modelStatus(ai: AIState | null, displayName: string | null): StatusItem {
  if (ai?.ready) {
    return { label: "Model", value: displayName ?? "loaded", tone: "ok" };
  }

  if (ai?.running) {
    return { label: "Model", value: "loading", tone: "warn" };
  }

  if (displayName) {
    return { label: "Model", value: `${displayName} (idle)`, tone: "off" };
  }

  return { label: "Model", value: "none selected", tone: "off" };
}

function poolStatus(pool: PoolOffer[]): StatusItem {
  const online = pool.filter((offer) => offer.online).length;

  if (online === 0) {
    return { label: "Pool", value: "no peers", tone: "off" };
  }

  return {
    label: "Pool",
    value: `${online} peer${online === 1 ? "" : "s"}`,
    tone: "ok",
  };
}

export function StatusStrip({ server, runtime, ai, pool, modelDisplayName }: StatusStripProps) {
  const items: StatusItem[] = [
    serverStatus(server),
    runtimeStatus(runtime),
    modelStatus(ai, modelDisplayName),
    poolStatus(pool),
  ];

  return (
    <div className="flex flex-wrap gap-2" aria-label="System status">
      {items.map((item) => (
        <span
          key={item.label}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${toneClass(item.tone)}`}
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${dotClass(item.tone)}`} />
          <span className="font-mono text-[11px] uppercase tracking-[0.88px] text-muted">
            {item.label}
          </span>
          <strong className="font-mono text-[12px] text-ink truncate max-w-[160px]" title={item.value}>
            {item.value}
          </strong>
        </span>
      ))}
    </div>
  );
}
