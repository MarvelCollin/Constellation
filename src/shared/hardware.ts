export type GpuInfo = {
  name: string;
  memory_mb: number;
  driver: string;
};

export type HardwareSnapshot = {
  platform: string;
  python_version: string;
  cpu_count: number | null;
  memory_bytes: number | null;
  storage_bytes: number | null;
  storage_free_bytes: number | null;
  gpus: GpuInfo[];
};

export type HardwareScanResponse =
  | {
      ok: true;
      data: HardwareSnapshot;
    }
  | {
      ok: false;
      error: string;
    };

export type MainServerState = {
  running: boolean;
  exposure: "lan" | "internet";
  host: string;
  port: number;
  url: string | null;
  lanUrl: string | null;
  publicUrl: string | null;
  exposureNote: string | null;
  token: string | null;
  pid: number | null;
  tunnelRunning: boolean;
  tunnelUrl: string | null;
  tunnelPid: number | null;
  tunnelNote: string | null;
};

export type StartMainServerOptions = {
  exposure: "lan" | "internet";
};

export type MainServerResponse =
  | {
      ok: true;
      data: MainServerState;
    }
  | {
      ok: false;
      error: string;
    };

export type FirewallPermissionResponse =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export type PortCleanupResponse =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export type ZrokEnableResponse =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

export type HostDiagnosticCheck = {
  label: string;
  status: "ok" | "warning" | "error" | "info";
  value: string;
};

export type HostDiagnostics = {
  summary: string;
  checks: HostDiagnosticCheck[];
};

export type HostDiagnosticsResponse =
  | {
      ok: true;
      data: HostDiagnostics;
    }
  | {
      ok: false;
      error: string;
    };

export type ConnectMainServerRequest = {
  url: string;
  token: string;
};

export type ConnectedServerState = {
  url: string;
  hardware: HardwareSnapshot;
};

export type ConnectMainServerResponse =
  | {
      ok: true;
      data: ConnectedServerState;
    }
  | {
      ok: false;
      error: string;
    };

export type ChatPeer = {
  id: string;
  name: string;
  lastSeen: string;
};

export type ChatMessage = {
  id: string;
  sender: string;
  body: string;
  createdAt: string;
};

export type ChatSnapshot = {
  peers: ChatPeer[];
  messages: ChatMessage[];
};

export type ChatTarget = "host" | "connected";

export type ChatSendRequest = {
  target: ChatTarget;
  body: string;
};

export type ChatFetchRequest = {
  target: ChatTarget;
};

export type ChatResponse =
  | {
      ok: true;
      data: ChatSnapshot;
    }
  | {
      ok: false;
      error: string;
    };
