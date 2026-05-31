import { useMemo } from "react";
import type { AIState, PoolOffer } from "../../../../shared/ai";

type PoolPanelProps = {
  offers: PoolOffer[];
  selectedPeerIds: Set<string>;
  busy: boolean;
  applyBusy: boolean;
  applyDirty: boolean;
  error: string | null;
  aiState: AIState | null;
  onRefresh: () => Promise<void>;
  onTogglePeer: (peerId: string, enabled: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onApplyPool: () => Promise<void>;
};

function formatLastSeen(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatMb(value: number) {
  if (value === 0) {
    return "0 MB";
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} GB`;
  }

  return `${value} MB`;
}

export function PoolPanel({
  offers,
  selectedPeerIds,
  busy,
  applyBusy,
  applyDirty,
  error,
  aiState,
  onRefresh,
  onTogglePeer,
  onSelectAll,
  onSelectNone,
  onApplyPool,
}: PoolPanelProps) {
  const modelLoaded = aiState?.running === true;
  const canApply = modelLoaded && applyDirty && !applyBusy;
  const onlineOffers = useMemo(() => offers.filter((offer) => offer.online), [offers]);
  const totalVram = useMemo(
    () => onlineOffers.reduce((sum, offer) => sum + (offer.vramMb || 0), 0),
    [onlineOffers],
  );
  const totalRam = useMemo(
    () => onlineOffers.reduce((sum, offer) => sum + (offer.ramMb || 0), 0),
    [onlineOffers],
  );
  const selectedOnline = onlineOffers.filter((offer) => selectedPeerIds.has(offer.peerId));
  const statusText = onlineOffers.length === 0 ? "No contributors" : `${onlineOffers.length} contributing`;
  const statusToneClass = onlineOffers.length === 0 ? "bg-surface-strong text-muted" : "bg-timeline-grep/40 text-ink";

  return (
    <section
      aria-labelledby="pool-heading"
      className="mt-6 rounded-[12px] border border-hairline bg-surface-card p-6 md:p-8"
    >
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.88px] ${statusToneClass}`}
          >
            {statusText}
          </span>
          <h2 id="pool-heading" className="text-[22px] font-normal tracking-[-0.11px] text-ink">
            GPU pool
          </h2>
          <p className="text-[14px] leading-relaxed text-body max-w-prose">
            Connected peers can lend their GPU and RAM as llama.cpp rpc backends. Selected peers will be
            included on the next model load.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center rounded-[8px] border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink hover:bg-hairline-soft disabled:opacity-60"
            disabled={busy}
            onClick={() => void onRefresh()}
            type="button"
          >
            {busy ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="inline-flex h-10 items-center rounded-[8px] bg-ink px-4 text-[14px] font-medium text-canvas hover:bg-ink/90 disabled:opacity-60"
            disabled={!canApply}
            onClick={() => void onApplyPool()}
            type="button"
            title={
              !modelLoaded
                ? "Load a model first"
                : !applyDirty
                  ? "Pool already in sync with the running model"
                  : "Unload and reload the model with the selected peers"
            }
          >
            {applyBusy ? "Reloading..." : "Apply pool & reload"}
          </button>
        </div>
      </header>

      {error ? (
        <p className="mt-4 rounded-[8px] border border-error/40 bg-error/10 px-3 py-2 text-[13px] text-ink">
          {error}
        </p>
      ) : null}

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-[8px] border border-hairline bg-canvas-soft p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">Online peers</dt>
          <dd className="mt-1 font-mono text-[18px] text-ink">{onlineOffers.length}</dd>
        </div>
        <div className="rounded-[8px] border border-hairline bg-canvas-soft p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">Pooled VRAM</dt>
          <dd className="mt-1 font-mono text-[18px] text-ink">{formatMb(totalVram)}</dd>
        </div>
        <div className="rounded-[8px] border border-hairline bg-canvas-soft p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">Pooled RAM</dt>
          <dd className="mt-1 font-mono text-[18px] text-ink">{formatMb(totalRam)}</dd>
        </div>
        <div className="rounded-[8px] border border-hairline bg-canvas-soft p-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.4px] text-muted">Selected</dt>
          <dd className="mt-1 font-mono text-[18px] text-ink">{selectedOnline.length}</dd>
        </div>
      </dl>

      <div className="mt-6 flex items-center gap-2">
        <button
          className="text-[13px] font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
          disabled={onlineOffers.length === 0}
          onClick={onSelectAll}
          type="button"
        >
          Select all
        </button>
        <span aria-hidden className="text-muted">·</span>
        <button
          className="text-[13px] font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50"
          disabled={selectedOnline.length === 0}
          onClick={onSelectNone}
          type="button"
        >
          Clear
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {offers.length === 0 ? (
          <li className="rounded-[8px] border border-dashed border-hairline bg-canvas-soft px-3 py-3 text-[13px] text-body">
            No peers have offered resources yet. Open the app on another machine, connect to this host, then click
            "Start lending".
          </li>
        ) : (
          offers.map((offer) => {
            const checked = selectedPeerIds.has(offer.peerId);
            const isOnline = offer.online;
            const rowClass = isOnline
              ? "border border-hairline bg-surface-card"
              : "border border-hairline bg-canvas-soft opacity-70";

            return (
              <li
                key={offer.peerId}
                className={`flex flex-col gap-3 rounded-[8px] px-4 py-3 md:flex-row md:items-center md:justify-between ${rowClass}`}
              >
                <label className="flex items-start gap-3">
                  <input
                    checked={checked}
                    className="mt-1 h-4 w-4 accent-ink"
                    disabled={!isOnline}
                    onChange={(event) => onTogglePeer(offer.peerId, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <div>
                    <span className="text-[14px] font-semibold text-ink">{offer.peerName}</span>
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.4px] text-muted">
                      {isOnline ? "online" : `last seen ${formatLastSeen(offer.lastSeen)}`}
                    </span>
                    <p className="mt-1 font-mono text-[12px] text-body break-all">{offer.rpcUrl}</p>
                  </div>
                </label>
                <dl className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 text-right">
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.4px] text-muted">VRAM</dt>
                    <dd className="font-mono text-[13px] text-ink">{formatMb(offer.vramMb)}</dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.4px] text-muted">RAM</dt>
                    <dd className="font-mono text-[13px] text-ink">{formatMb(offer.ramMb)}</dd>
                  </div>
                </dl>
              </li>
            );
          })
        )}
      </ul>

      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.4px] text-muted">
        Selected peers are passed to llama-server as --rpc when you next load a model.
      </p>
    </section>
  );
}
