import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AIState } from "../../../../shared/ai";
import type { HardwareSnapshot } from "../../../../shared/hardware";
import { streamChat, type ChatMessage } from "./aiClient";

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

type Turn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending: boolean;
};

const STORAGE_KEY = "constellation:inference";

type Persisted = {
  systemPrompt: string;
  temperature: number;
  nGpuLayers: number;
  contextSize: number;
};

function readPersisted(): Persisted {
  if (typeof window === "undefined") {
    return defaultsForFreshSession();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return defaultsForFreshSession();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : defaultsForFreshSession().systemPrompt,
      temperature: typeof parsed.temperature === "number" ? parsed.temperature : 0.7,
      nGpuLayers: typeof parsed.nGpuLayers === "number" ? parsed.nGpuLayers : 999,
      contextSize: typeof parsed.contextSize === "number" ? parsed.contextSize : 4096,
    };
  } catch {
    return defaultsForFreshSession();
  }
}

function defaultsForFreshSession(): Persisted {
  return {
    systemPrompt: "You are a concise, helpful assistant.",
    temperature: 0.7,
    nGpuLayers: 999,
    contextSize: 4096,
  };
}

function writePersisted(value: Persisted) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
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

function newId() {
  return `turn-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
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
  const persisted = useMemo(readPersisted, []);
  const [systemPrompt, setSystemPrompt] = useState(persisted.systemPrompt);
  const [temperature, setTemperature] = useState(persisted.temperature);
  const [nGpuLayers, setNGpuLayers] = useState(persisted.nGpuLayers);
  const [contextSize, setContextSize] = useState(persisted.contextSize);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    writePersisted({ systemPrompt, temperature, nGpuLayers, contextSize });
  }, [systemPrompt, temperature, nGpuLayers, contextSize]);

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
  }, [turns]);

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
    setTurns([]);
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

      const userTurn: Turn = { id: newId(), role: "user", content: input.trim(), pending: false };
      const assistantTurn: Turn = { id: newId(), role: "assistant", content: "", pending: true };

      const nextTurns = [...turns, userTurn, assistantTurn];
      setTurns(nextTurns);
      setInput("");
      setStreaming(true);
      setChatError(null);

      const messages: ChatMessage[] = [];

      if (systemPrompt.trim().length > 0) {
        messages.push({ role: "system", content: systemPrompt.trim() });
      }

      for (const turn of nextTurns) {
        if (turn.pending) {
          continue;
        }

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
        onEvent: (event) => {
          if (event.kind === "delta") {
            setTurns((current) =>
              current.map((turn) =>
                turn.id === assistantTurn.id ? { ...turn, content: turn.content + event.text } : turn,
              ),
            );
          }

          if (event.kind === "done") {
            setTurns((current) =>
              current.map((turn) => (turn.id === assistantTurn.id ? { ...turn, pending: false } : turn)),
            );
            setStreaming(false);
          }

          if (event.kind === "error") {
            setChatError(event.message);
            setTurns((current) =>
              current.map((turn) => (turn.id === assistantTurn.id ? { ...turn, pending: false } : turn)),
            );
            setStreaming(false);
          }
        },
      });
    },
    [canSend, input, systemPrompt, temperature, turns],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setTurns((current) => current.map((turn) => (turn.pending ? { ...turn, pending: false } : turn)));
  }, []);

  const handleClear = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setChatError(null);
    setStreaming(false);
  }, []);

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
          turns.map((turn) => (
            <article key={turn.id} className={`inference-turn inference-turn-${turn.role}`}>
              <span>{turn.role === "user" ? "You" : "Model"}</span>
              <p>{turn.content || (turn.pending ? "..." : "")}</p>
            </article>
          ))
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
