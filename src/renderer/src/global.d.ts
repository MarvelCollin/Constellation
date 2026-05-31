export {};

import type {
  ChatFetchRequest,
  ChatResponse,
  ChatSendRequest,
  ConnectMainServerRequest,
  ConnectMainServerResponse,
  FirewallPermissionResponse,
  HardwareScanResponse,
  HostDiagnosticsResponse,
  MainServerResponse,
  PortCleanupResponse,
  StartMainServerOptions,
  ZrokEnableResponse,
} from "../../shared/hardware";
import type {
  AIChatEndpointResponse,
  AILoadOptions,
  AILoadResponse,
  AIStateResponse,
  AIUnloadResponse,
  DownloadCancelResponse,
  DownloadProgress,
  DownloadStartRequest,
  DownloadStartResponse,
  ModelLibraryResponse,
  RuntimeConfigResponse,
} from "../../shared/ai";

declare global {
  interface Window {
    constellation?: {
      platform: string;
      connectToMainServer: (request: ConnectMainServerRequest) => Promise<ConnectMainServerResponse>;
      allowFirewall: () => Promise<FirewallPermissionResponse>;
      clearServerPort: () => Promise<PortCleanupResponse>;
      diagnoseHost: () => Promise<HostDiagnosticsResponse>;
      enableZrok: () => Promise<ZrokEnableResponse>;
      fetchChat: (request: ChatFetchRequest) => Promise<ChatResponse>;
      getMainServerState: () => Promise<MainServerResponse>;
      scanHardware: () => Promise<HardwareScanResponse>;
      sendChat: (request: ChatSendRequest) => Promise<ChatResponse>;
      startMainServer: (options: StartMainServerOptions) => Promise<MainServerResponse>;
      startZrokTunnel: () => Promise<MainServerResponse>;
      stopMainServer: () => Promise<MainServerResponse>;
      stopZrokTunnel: () => Promise<MainServerResponse>;
      getRuntimeConfig: () => Promise<RuntimeConfigResponse>;
      pickRuntime: () => Promise<RuntimeConfigResponse>;
      clearRuntime: () => Promise<RuntimeConfigResponse>;
      listModels: () => Promise<ModelLibraryResponse>;
      pickModelFile: () => Promise<ModelLibraryResponse>;
      removeModelEntry: (path: string) => Promise<ModelLibraryResponse>;
      selectModel: (path: string) => Promise<ModelLibraryResponse>;
      getAIState: () => Promise<AIStateResponse>;
      loadAIModel: (options: AILoadOptions) => Promise<AILoadResponse>;
      unloadAIModel: () => Promise<AIUnloadResponse>;
      getAIChatEndpoint: () => Promise<AIChatEndpointResponse>;
      startDownload: (request: DownloadStartRequest) => Promise<DownloadStartResponse>;
      cancelDownload: (id: string) => Promise<DownloadCancelResponse>;
      openExternal: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      onDownloadProgress: (listener: (progress: DownloadProgress) => void) => () => void;
    };
  }
}
