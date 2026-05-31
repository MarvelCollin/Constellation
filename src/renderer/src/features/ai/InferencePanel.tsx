import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AIState } from "../../../../shared/ai";
import type { HardwareSnapshot } from "../../../../shared/hardware";
import { streamChat, type ChatMessage } from "./aiClient";
import {
  activeSession,
  appendTurn,
  clearActiveTurns,
  createSession,
  deleteSession,
  describeSession,
  loadSessionsState,
  newTurnId,
  patchLastTurn,
  persistSessionsState,
  renameSession,
  selectSession,
  serializeSession,
  sessionExportFilename,
  type SessionsState,
  type SessionTurn,
} from "./sessions";

type InferencePanelProps = {
  aiState: AIState | null;
  selectedModelPath: string | null;
  selectedModelName: string | null;
  hardware: HardwareSnapshot | null;
  busy: boolean;
  error: string | null;
  onLoad: (options: { nGpuLayers: number; contextSize: number }) => Promise<void>;
  onUnload: () => Promise<void>;
};

type StreamMetrics = {
  tokens: number;
  elapsedMs: number;
  tokensPerSec: number;
  active: boolean;
};

const EMPTY_METRICS: StreamMetrics = { tokens: 0, elapsedMs: 0, tokensPerSec: 0, active: false };

const SETTINGS_STORAGE_KEY = "constellation:inference";

type Persisted = {
  systemPrompt: string;
  temperature: number;
  nGpuLayers: number;
  contextSize: number;
};

function defaultsForFreshSession(): Persisted {
  return {
    systemPrompt: "You are a concise, helpful assistant.",
    temperature: 0.7,
    nGpuLayers: 999,
    contextSize: 4096,
  };
}

function readPersistedSettings(): Persisted {
  if (typeof window === "undefined") {
    return defaultsForFreshSession();
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

  if (!raw) {
    return defaultsForFreshSession();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const fallback = defaultsForFreshSession();
    return {
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : fallback.systemPrompt,
      temperature: typeof parsed.temperature === "number" ? parsed.temperature : fallback.temperature,
      nGpuLayers: typeof parsed.nGpuLayers === "number" ? parsed.nGpuLayers : fallback.nGpuLayers,
      contextSize: typeof parsed.contextSize === "number" ? parsed.contextSize : fallback.contextSize,
    };
  } catch {
    return defaultsForFreshSession();
  }
}

function writePersistedSettings(value: Persisted) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
}

function recommendedNGpuLayers(hardware: HardwareSnapshot | null) {
  if (!hardware || hardware.gpus.length === 0) {
    return 0;
  }

  const totalFree = hardware.gpus.reduce((sum, gpu) => sum + (gpu.memory_free_mb || 0), 0);

  if (totalFree <= 0) {
    return 0;
  }

  return 999;
}

export function InferencePanel({
  aiState,
  selectedModelPath,
  selectedModelName,
  hardware,
  busy,
  error,
  onLoad,
  onUnload,
}: InferencePanelProps) {
  const persisted = useMemo(readPersistedSettings, []);
  const [systemPrompt, setSystemPrompt] = useState(persisted.systemPrompt);
  const [temperature, setTemperature] = useState(persisted.temperature);
  const [nGpuLayers, setNGpuLayers] = useState(persisted.nGpuLayers);
  const [contextSize, setContextSize] = useState(persisted.contextSize);
  const [sessionsState, setSessionsState] = useState<SessionsState>(loadSessionsState);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StreamMetrics>(EMPTY_METRICS);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<{ startedAt: number | null; tokens: number }>({ startedAt: null, tokens: 0 });

  const current = activeSession(sessionsState);
  const turns = current.turns;

  useEffect(() => {
    writePersistedSettings({ systemPrompt, temperature, nGpuLayers, contextSize });
  }, [systemPrompt, temperature, nGpuLayers, contextSize]);

  useEffect(() => {
    persistSessionsState(sessionsState);
  }, [sessionsState]);

  useEffect(() => {
    const recommended = recommendedNGpuLayers(hardware);

    if (hardware && nGpuLayers === 0 && recommended > 0) {
      setNGpuLayers(recommended);
    }
  }, [hardware]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [turns, sessionsState.activeId]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const running = aiState?.running === true;
  const ready = aiState?.ready === true;
  const loaded = running && ready;
  const canLoad = Boolean(selectedModelPath) && !running && !busy;
  const canSend = loaded && input.trim().length > 0 && !streaming;
  const statusText = loaded ? "Model online" : running ? "Loading model" : "Model offline";

  const handleLoad = useCallback(async () => {
    if (!selectedModelPath) {
      return;
    }

    setChatError(null);
    await onLoad({ nGpuLayers, contextSize });
  }, [selectedModelPath, nGpuLayers, contextSize, onLoad]);

  const handleUnload = useCallback(async () => {
    abortRef.current?.abort();
    await onUnload();
  }, [onUnload]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!canSend) {
        return;
      }

      const endpoint = await window.constellation?.getAIChatEndpoint();

      if (!endpoint || !endpoint.ok) {
        setChatError(endpoint && !endpoint.ok ? endpoint.error : "Server is not available.");
        return;
      }

      const userTurn: SessionTurn = { id: newTurnId(), role: "user", content: input.trim() };
      const assistantTurn: SessionTurn = { id: newTurnId(), role: "assistant", content: "" };

      const afterUser = appendTurn(sessionsState, userTurn);
      const afterAssistant = appendTurn(afterUser, assistantTurn);
      setSessionsState(afterAssistant);
      setPendingTurnId(assistantTurn.id);
      setInput("");
      setStreaming(true);
      setChatError(null);
      metricsRef.current = { startedAt: null, tokens: 0 };
      setMetrics({ tokens: 0, elapsedMs: 0, tokensPerSec: 0, active: true });

      const conversationTurns = activeSession(afterAssistant).turns.filter((turn) => turn.id !== assistantTurn.id);
      const messages: ChatMessage[] = [];

      if (systemPrompt.trim().length > 0) {
        messages.push({ role: "system", content: systemPrompt.trim() });
      }

      for (const turn of conversationTurns) {
        messages.push({ role: turn.role, content: turn.content });
      }

      const controller = new AbortController();
      abortRef.current = controller;

      await streamChat({
        url: endpoint.data.url,
        token: endpoint.data.token,
        messages,
        temperature,
        signal: controller.signal,
        onEvent: (streamEvent) => {
          if (streamEvent.kind === "delta") {
            if (metricsRef.current.startedAt === null) {
              metricsRef.current.startedAt = performance.now();
            }

            metricsRef.current.tokens += 1;
            const elapsedMs = performance.now() - (metricsRef.current.startedAt ?? performance.now());
            const tokensPerSec = elapsedMs > 0 ? (metricsRef.current.tokens / elapsedMs) * 1000 : 0;

            setMetrics({
              tokens: metricsRef.current.tokens,
              elapsedMs,
              tokensPerSec,
              active: true,
            });

            setSessionsState((current) =>
              patchLastTurn(current, assistantTurn.id, (turn) => ({
                ...turn,
                content: turn.content + streamEvent.text,
              })),
            );
          }

          if (streamEvent.kind === "done") {
            const startedAt = metricsRef.current.startedAt;
            const elapsedMs = startedAt === null ? 0 : performance.now() - startedAt;
            const tokensPerSec = elapsedMs > 0 ? (metricsRef.current.tokens / elapsedMs) * 1000 : 0;

            setMetrics({
              tokens: metricsRef.current.tokens,
              elapsedMs,
              tokensPerSec,
              active: false,
            });
            setPendingTurnId(null);
            setStreaming(false);
          }

          if (streamEvent.kind === "error") {
            setChatError(streamEvent.message);
            setMetrics((value) => ({ ...value, active: false }));
            setPendingTurnId(null);
            setStreaming(false);
          }
        },
      });
    },
    [canSend, input, systemPrompt, temperature, sessionsState],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setPendingTurnId(null);
    setMetrics((value) => ({ ...value, active: false }));
  }, []);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    setSessionsState((current) => clearActiveTurns(current));
    setPendingTurnId(null);
    setChatError(null);
    setStreaming(false);
    setMetrics(EMPTY_METRICS);
  }, []);

  const handleNewSession = useCallback(() => {
    abortRef.current?.abort();
    setSessionsState((current) => createSession(current));
    setPendingTurnId(null);
    setChatError(null);
    setStreaming(false);
    setMetrics(EMPTY_METRICS);
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    abortRef.current?.abort();
    setSessionsState((current) => selectSession(current, id));
    setPendingTurnId(null);
    setStreaming(false);
    setMetrics(EMPTY_METRICS);
  }, []);

  const handleDeleteSession = useCallback(() => {
    abortRef.current?.abort();
    setSessionsState((current) => deleteSession(current, current.activeId));
    setPendingTurnId(null);
    setStreaming(false);
    setMetrics(EMPTY_METRICS);
  }, []);

  const handleStartRename = useCallback(() => {
    setRenameDraft(current.title);
    setRenaming(true);
  }, [current.title]);

  const handleConfirmRename = useCallback(() => {
    setSessionsState((state) => renameSession(state, state.activeId, renameDraft));
    setRenaming(false);
  }, [renameDraft]);

  const handleCancelRename = useCallback(() => {
    setRenaming(false);
    setRenameDraft("");
  }, []);

  const handleExportSession = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const json = serializeSession(current);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sessionExportFilename(current);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [current]);

  return (
    <section className="server-panel ai-panel" aria-labelledby="inference-heading">
      <div className="server-header">
        <div>
          <span className={loaded ? "scan-state scan-state-ready" : "scan-state"}>{statusText}</span>
          <h2 id="inference-heading">Chat with the model</h2>
          <p>
            {loaded
              ? `Talking to ${selectedModelName ?? "selected model"}. Tokens stream as they are generated.`
              : selectedModelPath
                ? "Load the selected model to start chatting."
                : "Choose a model above, then load it here."}
          </p>
        </div>
        <div className="server-actions">
          {loaded ? (
            <button className="button-secondary" disabled={busy} onClick={handleUnload} type="button">
              Unload
            </button>
          ) : (
            <button className="button-download" disabled={!canLoad} onClick={handleLoad} type="button">
              {busy ? "Loading..." : running ? "Loading..." : "Load model"}
            </button>
          )}
        </div>
      </div>

      {error ? <div className="scan-error">{error}</div> : null}
      {chatError ? <div className="scan-error">{chatError}</div> : null}

      <div className="border-b border-hairline-soft px-8 py-6">
        <div className="flex flex-wrap items-end gap-3">
          {renaming ? (
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.88px] text-muted">
                Rename conversation
              </span>
              <input
                autoFocus
                className="h-10 min-w-0 rounded-[8px] border border-ink bg-surface-card px-3 text-[14px] text-ink outline-none"
                maxLength={48}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleConfirmRename();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    handleCancelRename();
                  }
                }}
                placeholder="Give this chat a name"
                value={renameDraft}
              />
            </label>
          ) : (
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.88px] text-muted">
                Conversation ({sessionsState.sessions.length})
              </span>
              <select
                className="h-10 min-w-0 rounded-[8px] border border-hairline-strong bg-surface-card px-3 text-[14px] text-ink outline-none focus:border-ink"
                disabled={streaming}
                onChange={(event) => handleSelectSession(event.currentTarget.value)}
                value={sessionsState.activeId}
              >
                {sessionsState.sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {describeSession(session)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {renaming ? (
            <>
              <button
                className="inline-flex h-10 items-center rounded-[8px] bg-ink px-4 text-[14px] font-medium text-canvas hover:bg-ink/90"
                onClick={handleConfirmRename}
                type="button"
              >
                Save
              </button>
              <button
                className="inline-flex h-10 items-center rounded-[8px] border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink hover:bg-hairline-soft"
                onClick={handleCancelRename}
                type="button"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className="inline-flex h-10 items-center rounded-[8px] border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink hover:bg-hairline-soft disabled:opacity-60"
                disabled={streaming}
                onClick={handleStartRename}
                type="button"
                title="Rename the current conversation"
              >
                Rename
              </button>
              <button
                className="inline-flex h-10 items-center rounded-[8px] border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink hover:bg-hairline-soft disabled:opacity-60"
                disabled={streaming || turns.length === 0}
                onClick={handleExportSession}
                type="button"
                title="Download this conversation as JSON"
              >
                Export
              </button>
              <button
                className="inline-flex h-10 items-center rounded-[8px] border border-hairline-strong bg-surface-card px-4 text-[14px] font-medium text-ink hover:bg-hairline-soft disabled:opacity-60"
                disabled={streaming}
                onClick={handleNewSession}
                type="button"
              >
                New chat
              </button>
              <button
                className="inline-flex h-10 items-center rounded-[8px] border border-error/40 bg-surface-card px-4 text-[14px] font-medium text-error hover:bg-error/10 disabled:opacity-60"
                disabled={streaming || (sessionsState.sessions.length <= 1 && turns.length === 0)}
                onClick={handleDeleteSession}
                type="button"
                title="Delete the current conversation"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="inference-config">
        <label className="field">
          <span>System prompt</span>
          <textarea
            disabled={streaming}
            onChange={(event) => setSystemPrompt(event.currentTarget.value)}
            rows={2}
            value={systemPrompt}
          />
        </label>
        <div className="inference-config-grid">
          <label className="field">
            <span>GPU layers (n_gpu_layers)</span>
            <input
              disabled={running}
              max={999}
              min={0}
              onChange={(event) => setNGpuLayers(Math.max(0, Math.min(999, Number(event.currentTarget.value))))}
              type="number"
              value={nGpuLayers}
            />
          </label>
          <label className="field">
            <span>Context size</span>
            <input
              disabled={running}
              max={131072}
              min={256}
              onChange={(event) => setContextSize(Math.max(256, Math.min(131072, Number(event.currentTarget.value))))}
              step={256}
              type="number"
              value={contextSize}
            />
          </label>
          <label className="field">
            <span>Temperature</span>
            <input
              max={2}
              min={0}
              onChange={(event) => setTemperature(Math.max(0, Math.min(2, Number(event.currentTarget.value))))}
              step={0.05}
              type="number"
              value={temperature}
            />
          </label>
        </div>
      </div>

      <div className="inference-transcript" ref={transcriptRef} aria-live="polite">
        {turns.length === 0 ? (
          <p className="inference-empty">No messages yet. Ask the model anything.</p>
        ) : (
          turns.map((turn) => {
            const isPending = pendingTurnId === turn.id;

            return (
              <article key={turn.id} className={`inference-turn inference-turn-${turn.role}`}>
                <span>{turn.role === "user" ? "You" : "Model"}</span>
                <p>{turn.content || (isPending ? "..." : "")}</p>
              </article>
            );
          })
        )}
      </div>

      <form className="inference-form" onSubmit={handleSubmit}>
        <textarea
          disabled={!loaded || streaming}
          maxLength={6000}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              const form = event.currentTarget.form;

              if (form) {
                form.requestSubmit();
              }
            }
          }}
          placeholder={loaded ? "Type a message - Ctrl+Enter to send" : "Load a model first"}
          rows={3}
          value={input}
        />
        <div className="inference-actions">
          {metrics.tokens > 0 ? (
            <span className="inference-metrics" aria-live="polite">
              <strong>{metrics.tokens}</strong>
              <span> tok</span>
              <span aria-hidden> · </span>
              <strong>{metrics.tokensPerSec.toFixed(1)}</strong>
              <span> tok/s</span>
              {metrics.active ? <span aria-hidden className="inference-metrics-dot" /> : null}
            </span>
          ) : null}
          {streaming ? (
            <button className="button-secondary" onClick={handleStop} type="button">
              Stop
            </button>
          ) : (
            <button className="button-secondary" disabled={turns.length === 0} onClick={handleClear} type="button">
              Clear
            </button>
          )}
          <button className="button-download" disabled={!canSend} type="submit">
            {streaming ? "Generating..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
