import { useMemo } from "react";
import type { DownloadProgress, ModelLibrary, SavedModelEntry } from "../../../../shared/ai";
import type { HardwareSnapshot } from "../../../../shared/hardware";
import { formatBytes } from "../resources/formatHardware";
import { evaluateFit, recommendedModels, type FitVerdict, type RecommendedModel } from "./recommendedModels";

type ModelPanelProps = {
  library: ModelLibrary | null;
  busy: boolean;
  error: string | null;
  hardware: HardwareSnapshot | null;
  selectedPath: string | null;
  onAddCustom: () => void;
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onDownloadRecommended: (model: RecommendedModel) => void;
  onCancelDownload: (id: string) => void;
  downloads: Record<string, DownloadProgress>;
};

function totalFreeVram(snapshot: HardwareSnapshot | null) {
  if (!snapshot) {
    return 0;
  }

  return snapshot.gpus.reduce((total, gpu) => total + (gpu.memory_free_mb || 0), 0);
}

function freeRamMb(snapshot: HardwareSnapshot | null) {
  if (!snapshot || snapshot.memory_free_bytes === null) {
    return 0;
  }

  return Math.floor(snapshot.memory_free_bytes / (1024 * 1024));
}

function downloadId(model: RecommendedModel) {
  return `model:${model.id}`;
}

function progressPercent(progress: DownloadProgress) {
  if (!progress.totalBytes || progress.totalBytes <= 0) {
    return null;
  }

  return Math.min(100, Math.floor((progress.receivedBytes / progress.totalBytes) * 100));
}

function entryDownloadStatus(downloads: Record<string, DownloadProgress>, model: RecommendedModel) {
  return downloads[downloadId(model)] ?? null;
}

function verdictClass(verdict: FitVerdict) {
  return `model-fit model-fit-${verdict.level}`;
}

function describeProgress(progress: DownloadProgress) {
  if (progress.status === "completed") {
    return "Downloaded";
  }

  if (progress.status === "error") {
    return progress.message ?? "Download failed";
  }

  const percent = progressPercent(progress);
  const received = formatBytes(progress.receivedBytes);
  const total = progress.totalBytes ? formatBytes(progress.totalBytes) : "unknown size";
  return percent === null ? `${received} of ${total}` : `${percent}% (${received} of ${total})`;
}

export function ModelPanel({
  library,
  busy,
  error,
  hardware,
  selectedPath,
  onAddCustom,
  onSelect,
  onRemove,
  onDownloadRecommended,
  onCancelDownload,
  downloads,
}: ModelPanelProps) {
  const vram = useMemo(() => totalFreeVram(hardware), [hardware]);
  const ram = useMemo(() => freeRamMb(hardware), [hardware]);
  const entries = library?.entries ?? [];
  const hasLibrary = entries.length > 0;
  const statusText = selectedPath ? "Model selected" : "No model selected";

  return (
    <section className="server-panel ai-panel" aria-labelledby="model-heading">
      <div className="server-header">
        <div>
          <span className={selectedPath ? "scan-state scan-state-ready" : "scan-state"}>{statusText}</span>
          <h2 id="model-heading">AI model</h2>
          <p>Pick a recommended model or bring your own GGUF. Fit hints use detected free RAM and VRAM.</p>
        </div>
        <div className="server-actions">
          <button className="button-download" disabled={busy} onClick={onAddCustom} type="button">
            Add custom GGUF
          </button>
        </div>
      </div>

      {error ? <div className="scan-error">{error}</div> : null}

      <div className="model-recommended">
        <h3>Recommended</h3>
        <div className="model-grid">
          {recommendedModels.map((model) => {
            const verdict = evaluateFit(model, vram, ram);
            const progress = entryDownloadStatus(downloads, model);
            const isDownloading = progress?.status === "active";

            return (
              <article key={model.id} className="model-card">
                <header>
                  <strong>{model.name}</strong>
                  <span className={verdictClass(verdict)} title={verdict.detail}>
                    {verdict.label}
                  </span>
                </header>
                <p>{model.description}</p>
                <dl className="model-meta">
                  <div>
                    <dt>Size</dt>
                    <dd>{model.sizeMb} MB</dd>
                  </div>
                  <div>
                    <dt>Context</dt>
                    <dd>{model.contextSize}</dd>
                  </div>
                  <div>
                    <dt>VRAM est.</dt>
                    <dd>{model.estVramMb} MB</dd>
                  </div>
                </dl>
                {progress ? (
                  <div className="model-progress">
                    <progress
                      max={progress.totalBytes ?? undefined}
                      value={progress.totalBytes ? progress.receivedBytes : undefined}
                    />
                    <small>{describeProgress(progress)}</small>
                  </div>
                ) : null}
                <div className="model-card-actions">
                  {isDownloading ? (
                    <button
                      className="button-secondary"
                      onClick={() => onCancelDownload(progress.id)}
                      type="button"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => onDownloadRecommended(model)}
                      type="button"
                    >
                      {progress?.status === "completed" ? "Re-download" : "Download"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="model-library">
        <h3>Your models</h3>
        {hasLibrary ? (
          <ul className="model-list">
            {entries.map((entry: SavedModelEntry) => {
              const isSelected = entry.path === selectedPath;

              return (
                <li key={entry.path} className={isSelected ? "model-row model-row-selected" : "model-row"}>
                  <div>
                    <strong>{entry.displayName}</strong>
                    <small>{formatBytes(entry.fileSizeBytes)}</small>
                  </div>
                  <div className="model-row-actions">
                    <button
                      className={isSelected ? "button-secondary button-secondary-disabled" : "button-secondary"}
                      disabled={isSelected || busy}
                      onClick={() => onSelect(entry.path)}
                      type="button"
                    >
                      {isSelected ? "Selected" : "Use"}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={busy}
                      onClick={() => onRemove(entry.path)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="model-empty">No GGUF files yet. Download a recommended model or add a custom file.</p>
        )}
        {library ? <small className="model-folder">Models folder: {library.modelsDir}</small> : null}
      </div>
    </section>
  );
}
