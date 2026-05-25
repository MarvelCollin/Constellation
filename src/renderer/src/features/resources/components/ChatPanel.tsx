import { useState } from "react";
import type { FormEvent } from "react";
import type { ChatSnapshot } from "../../../../../shared/hardware";

type ChatPanelProps = {
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onRefresh: () => void;
  onSend: (body: string) => void;
  snapshot: ChatSnapshot | null;
  title: string;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ChatPanel({ busy, disabled, error, onRefresh, onSend, snapshot, title }: ChatPanelProps) {
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const canSend = !disabled && !busy && message.trim().length > 0;
  const panelId = `${title.replace(/\s+/g, "-").toLowerCase()}-chat`;
  const statusText = disabled ? "Chat offline" : "Chat online";
  const messageCount = snapshot?.messages.length ?? 0;
  const messageLabel = messageCount === 1 ? "1 message" : `${messageCount} messages`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    onSend(message.trim());
    setMessage("");
  }

  return (
    <section className={open ? "chat-panel chat-float chat-float-open" : "chat-panel chat-float"} aria-label={title}>
      {open ? (
        <div className="chat-popover" id={panelId}>
          <div className="chat-header">
            <div>
              <span className={disabled ? "scan-state" : "scan-state scan-state-ready"}>{statusText}</span>
              <h2>{title}</h2>
              <p>Token-protected messages for connected nodes.</p>
            </div>
            <button className="button-secondary" disabled={disabled || busy} onClick={onRefresh} type="button">
              {busy ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {error ? <div className="scan-error">{error}</div> : null}

          <div className="chat-layout">
            <aside className="peer-list" aria-label="Connected nodes">
              <span>Connected nodes</span>
              {snapshot?.peers.length ? (
                snapshot.peers.map((peer) => (
                  <div key={peer.id}>
                    <strong>{peer.name}</strong>
                    <small>{formatTime(peer.lastSeen)}</small>
                  </div>
                ))
              ) : (
                <p>{disabled ? "Start or join a server to see nodes." : "No connected nodes yet."}</p>
              )}
            </aside>
            <div className="message-column">
              <div className="message-list" aria-live="polite">
                {snapshot?.messages.length ? (
                  snapshot.messages.map((chatMessage) => (
                    <article key={chatMessage.id}>
                      <div>
                        <strong>{chatMessage.sender}</strong>
                        <time>{formatTime(chatMessage.createdAt)}</time>
                      </div>
                      <p>{chatMessage.body}</p>
                    </article>
                  ))
                ) : (
                  <p>{disabled ? "Chat is available after the server connection is ready." : "No messages yet."}</p>
                )}
              </div>
              <form className="chat-form" onSubmit={handleSubmit}>
                <input
                  disabled={disabled || busy}
                  maxLength={1000}
                  onChange={(event) => setMessage(event.currentTarget.value)}
                  placeholder={disabled ? "Connect first" : "Write a message"}
                  value={message}
                />
                <button className="button-download" disabled={!canSend} type="submit">
                  Send
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={disabled ? "chat-float-trigger" : "chat-float-trigger chat-float-trigger-ready"}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{statusText}</span>
        <strong>{messageCount ? messageLabel : title}</strong>
      </button>
    </section>
  );
}
