export type SessionTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: SessionTurn[];
};

export type SessionsState = {
  sessions: ChatSession[];
  activeId: string;
};

const SESSIONS_KEY = "constellation:sessions";
const LEGACY_TURNS_KEY = "constellation:inference:turns";
const MAX_SESSIONS = 20;
const TURNS_PER_SESSION = 50;
const TITLE_MAX = 48;

export function newSessionId() {
  return `session-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function newTurnId() {
  return `turn-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function emptySession(): ChatSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    title: "",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
}

export function deriveTitle(turns: SessionTurn[]): string {
  const firstUser = turns.find((turn) => turn.role === "user");

  if (!firstUser) {
    return "";
  }

  const text = firstUser.content.trim().replace(/\s+/g, " ");

  if (text.length <= TITLE_MAX) {
    return text;
  }

  return `${text.slice(0, TITLE_MAX - 1)}…`;
}

export function describeSession(session: ChatSession): string {
  if (session.title.length > 0) {
    return session.title;
  }

  if (session.turns.length === 0) {
    return "New chat";
  }

  return "Untitled";
}

function sanitizeTurn(value: unknown): SessionTurn | null {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as SessionTurn).id !== "string" ||
    typeof (value as SessionTurn).content !== "string"
  ) {
    return null;
  }

  const role = (value as SessionTurn).role;

  if (role !== "user" && role !== "assistant") {
    return null;
  }

  return {
    id: (value as SessionTurn).id,
    role,
    content: (value as SessionTurn).content,
  };
}

function sanitizeSession(value: unknown): ChatSession | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const candidate = value as ChatSession;

  if (typeof candidate.id !== "string" || typeof candidate.title !== "string") {
    return null;
  }

  if (typeof candidate.createdAt !== "number" || typeof candidate.updatedAt !== "number") {
    return null;
  }

  if (!Array.isArray(candidate.turns)) {
    return null;
  }

  const turns = candidate.turns
    .map(sanitizeTurn)
    .filter((turn): turn is SessionTurn => turn !== null)
    .slice(-TURNS_PER_SESSION);

  return {
    id: candidate.id,
    title: candidate.title,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    turns,
  };
}

function migrateLegacyTurns(): ChatSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(LEGACY_TURNS_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      window.localStorage.removeItem(LEGACY_TURNS_KEY);
      return null;
    }

    const turns = parsed
      .map(sanitizeTurn)
      .filter((turn): turn is SessionTurn => turn !== null)
      .slice(-TURNS_PER_SESSION);

    if (turns.length === 0) {
      window.localStorage.removeItem(LEGACY_TURNS_KEY);
      return null;
    }

    const session = emptySession();
    session.turns = turns;
    session.title = deriveTitle(turns);
    session.createdAt = Date.now() - 1;
    session.updatedAt = Date.now();
    window.localStorage.removeItem(LEGACY_TURNS_KEY);
    return session;
  } catch {
    window.localStorage.removeItem(LEGACY_TURNS_KEY);
    return null;
  }
}

export function loadSessionsState(): SessionsState {
  if (typeof window === "undefined") {
    const fresh = emptySession();
    return { sessions: [fresh], activeId: fresh.id };
  }

  const raw = window.localStorage.getItem(SESSIONS_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SessionsState>;

      if (Array.isArray(parsed.sessions)) {
        const sessions = parsed.sessions
          .map(sanitizeSession)
          .filter((session): session is ChatSession => session !== null)
          .slice(-MAX_SESSIONS);

        if (sessions.length > 0) {
          const activeId =
            typeof parsed.activeId === "string" && sessions.some((session) => session.id === parsed.activeId)
              ? parsed.activeId
              : sessions[sessions.length - 1].id;
          return { sessions, activeId };
        }
      }
    } catch {
      window.localStorage.removeItem(SESSIONS_KEY);
    }
  }

  const migrated = migrateLegacyTurns();

  if (migrated) {
    return { sessions: [migrated], activeId: migrated.id };
  }

  const fresh = emptySession();
  return { sessions: [fresh], activeId: fresh.id };
}

export function persistSessionsState(state: SessionsState) {
  if (typeof window === "undefined") {
    return;
  }

  const sessions = state.sessions
    .slice(-MAX_SESSIONS)
    .map((session) => ({
      ...session,
      turns: session.turns.slice(-TURNS_PER_SESSION),
    }));

  window.localStorage.setItem(
    SESSIONS_KEY,
    JSON.stringify({ sessions, activeId: state.activeId }),
  );
}

export function activeSession(state: SessionsState): ChatSession {
  const found = state.sessions.find((session) => session.id === state.activeId);

  if (found) {
    return found;
  }

  return state.sessions[state.sessions.length - 1];
}

export function updateActive(state: SessionsState, mutator: (session: ChatSession) => ChatSession): SessionsState {
  return {
    ...state,
    sessions: state.sessions.map((session) => (session.id === state.activeId ? mutator(session) : session)),
  };
}

export function appendTurn(state: SessionsState, turn: SessionTurn): SessionsState {
  return updateActive(state, (session) => {
    const nextTurns = [...session.turns, turn].slice(-TURNS_PER_SESSION);
    return {
      ...session,
      turns: nextTurns,
      title: session.title.length > 0 ? session.title : deriveTitle(nextTurns),
      updatedAt: Date.now(),
    };
  });
}

export function patchLastTurn(
  state: SessionsState,
  turnId: string,
  patch: (turn: SessionTurn) => SessionTurn,
): SessionsState {
  return updateActive(state, (session) => ({
    ...session,
    turns: session.turns.map((turn) => (turn.id === turnId ? patch(turn) : turn)),
    updatedAt: Date.now(),
  }));
}

export function createSession(state: SessionsState): SessionsState {
  const fresh = emptySession();
  const sessions = [...state.sessions, fresh].slice(-MAX_SESSIONS);
  return { sessions, activeId: fresh.id };
}

export function selectSession(state: SessionsState, id: string): SessionsState {
  if (!state.sessions.some((session) => session.id === id)) {
    return state;
  }

  return { ...state, activeId: id };
}

export function deleteSession(state: SessionsState, id: string): SessionsState {
  const remaining = state.sessions.filter((session) => session.id !== id);

  if (remaining.length === 0) {
    const fresh = emptySession();
    return { sessions: [fresh], activeId: fresh.id };
  }

  const activeId = state.activeId === id ? remaining[remaining.length - 1].id : state.activeId;
  return { sessions: remaining, activeId };
}

export function clearActiveTurns(state: SessionsState): SessionsState {
  return updateActive(state, (session) => ({
    ...session,
    title: "",
    turns: [],
    updatedAt: Date.now(),
  }));
}

export function renameSession(state: SessionsState, id: string, nextTitle: string): SessionsState {
  const trimmed = nextTitle.trim().slice(0, TITLE_MAX);

  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id ? { ...session, title: trimmed, updatedAt: Date.now() } : session,
    ),
  };
}

export function serializeSession(session: ChatSession): string {
  return JSON.stringify(
    {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turns: session.turns,
      exportedAt: Date.now(),
      schemaVersion: 1,
    },
    null,
    2,
  );
}

export function sessionExportFilename(session: ChatSession): string {
  const base = (session.title.length > 0 ? session.title : "constellation-chat")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = new Date(session.updatedAt).toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `${base || "chat"}-${stamp}.json`;
}
