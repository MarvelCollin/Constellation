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
  ZrokEnableRequest,
  ZrokEnableResponse,
} from "../../shared/hardware";

declare global {
  interface Window {
    constellation?: {
      platform: string;
      connectToMainServer: (request: ConnectMainServerRequest) => Promise<ConnectMainServerResponse>;
      allowFirewall: () => Promise<FirewallPermissionResponse>;
      clearServerPort: () => Promise<PortCleanupResponse>;
      diagnoseHost: () => Promise<HostDiagnosticsResponse>;
      enableZrok: (request: ZrokEnableRequest) => Promise<ZrokEnableResponse>;
      fetchChat: (request: ChatFetchRequest) => Promise<ChatResponse>;
      getMainServerState: () => Promise<MainServerResponse>;
      scanHardware: () => Promise<HardwareScanResponse>;
      sendChat: (request: ChatSendRequest) => Promise<ChatResponse>;
      startMainServer: (options: StartMainServerOptions) => Promise<MainServerResponse>;
      startZrokTunnel: () => Promise<MainServerResponse>;
      stopMainServer: () => Promise<MainServerResponse>;
      stopZrokTunnel: () => Promise<MainServerResponse>;
    };
  }
}
