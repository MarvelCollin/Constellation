export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type StreamOptions = {
  url: string;
  token: string;
  messages: ChatMessage[];
  temperature: number;
  signal: AbortSignal;
  onEvent: (event: StreamEvent) => void;
};

export async function streamChat(options: StreamOptions): Promise<void> {
  let response: Response;

  try {
    response = await fetch(options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({
        messages: options.messages,
        temperature: options.temperature,
        stream: true,
        cache_prompt: true,
      }),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      options.onEvent({ kind: "done" });
      return;
    }

    options.onEvent({
      kind: "error",
      message: error instanceof Error ? error.message : "Network error",
    });
    return;
  }

  if (!response.ok || response.body === null) {
    options.onEvent({
      kind: "error",
      message: `Inference failed with status ${response.status}`,
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });

      let separator = buffer.indexOf("\n\n");

      while (separator !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) {
            continue;
          }

          const payload = line.slice(5).trim();

          if (payload === "[DONE]") {
            options.onEvent({ kind: "done" });
            return;
          }

          if (payload.length === 0) {
            continue;
          }

          const parsed = parseDelta(payload);

          if (parsed.length > 0) {
            options.onEvent({ kind: "delta", text: parsed });
          }
        }

        separator = buffer.indexOf("\n\n");
      }
    }

    options.onEvent({ kind: "done" });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      options.onEvent({ kind: "done" });
      return;
    }

    options.onEvent({
      kind: "error",
      message: error instanceof Error ? error.message : "Stream interrupted",
    });
  } finally {
    reader.releaseLock();
  }
}

function parseDelta(payload: string): string {
  try {
    const data = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string }; text?: string }>;
      content?: string;
    };

    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];

      if (choice.delta && typeof choice.delta.content === "string") {
        return choice.delta.content;
      }

      if (typeof choice.text === "string") {
        return choice.text;
      }
    }

    if (typeof data.content === "string") {
      return data.content;
    }
  } catch {
    return "";
  }

  return "";
}
