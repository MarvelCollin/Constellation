export type AIState = {
  running: boolean;
  ready: boolean;
  modelPath: string | null;
  runtimePath: string | null;
  nGpuLayers: number;
  contextSize: number;
  rpcPeers: string[];
  host: string;
  port: number;
  log: string[];
};

export type AIStateResponse =
  | { ok: true; data: AIState }
  | { ok: false; error: string };

export type AILoadOptions = {
  modelPath: string;
  nGpuLayers: number;
  contextSize: number;
  rpcPeers?: string[];
};

export type AILoadResponse = AIStateResponse;

export type AIUnloadResponse = AIStateResponse;

export type RuntimeConfig = {
  path: string | null;
  exists: boolean;
};

export type RuntimeConfigResponse =
  | { ok: true; data: RuntimeConfig }
  | { ok: false; error: string };

export type SavedModelEntry = {
  path: string;
  displayName: string;
  fileSizeBytes: number | null;
};

export type ModelLibrary = {
  modelsDir: string;
  entries: SavedModelEntry[];
  lastModelPath: string | null;
};

export type ModelLibraryResponse =
  | { ok: true; data: ModelLibrary }
  | { ok: false; error: string };

export type DownloadProgress = {
  id: string;
  kind: "runtime" | "model";
  url: string;
  destination: string;
  status: "active" | "completed" | "error";
  receivedBytes: number;
  totalBytes: number | null;
  message: string | null;
};

export type DownloadStartRequest = {
  id: string;
  kind: "runtime" | "model";
  url: string;
  destinationName: string;
};

export type DownloadStartResponse =
  | { ok: true; data: DownloadProgress }
  | { ok: false; error: string };

export type DownloadCancelResponse =
  | { ok: true }
  | { ok: false; error: string };

export type AIChatEndpoint = {
  url: string;
  token: string;
};

export type AIChatEndpointResponse =
  | { ok: true; data: AIChatEndpoint }
  | { ok: false; error: string };

export type PoolOffer = {
  id: string;
  peerId: string;
  peerName: string;
  rpcUrl: string;
  vramMb: number;
  ramMb: number;
  createdAt: string;
  lastSeen: string;
  online: boolean;
};

export type PoolMembersResponse =
  | { ok: true; data: PoolOffer[] }
  | { ok: false; error: string };

export type LendOptions = {
  port: number;
  vramMb: number;
  ramMb: number;
  selectedGpus: number[];
};

export type LendState = {
  running: boolean;
  port: number;
  rpcUrl: string | null;
  vramMb: number;
  ramMb: number;
  selectedGpus: number[];
  offerId: string | null;
  message: string | null;
  log: string[];
};

export type LendStateResponse =
  | { ok: true; data: LendState }
  | { ok: false; error: string };
