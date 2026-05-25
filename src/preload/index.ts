import { contextBridge, ipcRenderer } from "electron";
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
} from "../shared/hardware";

contextBridge.exposeInMainWorld("constellation", {
  platform: process.platform,
  connectToMainServer: (request: ConnectMainServerRequest): Promise<ConnectMainServerResponse> =>
    ipcRenderer.invoke("main-server:connect", request),
  allowFirewall: (): Promise<FirewallPermissionResponse> => ipcRenderer.invoke("main-server:allow-firewall"),
  clearServerPort: (): Promise<PortCleanupResponse> => ipcRenderer.invoke("main-server:clear-port"),
  diagnoseHost: (): Promise<HostDiagnosticsResponse> => ipcRenderer.invoke("main-server:diagnose"),
  enableZrok: (): Promise<ZrokEnableResponse> => ipcRenderer.invoke("main-server:enable-zrok"),
  fetchChat: (request: ChatFetchRequest): Promise<ChatResponse> => ipcRenderer.invoke("chat:fetch", request),
  getMainServerState: (): Promise<MainServerResponse> => ipcRenderer.invoke("main-server:state"),
  scanHardware: (): Promise<HardwareScanResponse> => ipcRenderer.invoke("hardware:scan"),
  sendChat: (request: ChatSendRequest): Promise<ChatResponse> => ipcRenderer.invoke("chat:send", request),
  startMainServer: (options: StartMainServerOptions): Promise<MainServerResponse> =>
    ipcRenderer.invoke("main-server:start", options),
  startZrokTunnel: (): Promise<MainServerResponse> => ipcRenderer.invoke("main-server:start-tunnel"),
  stopMainServer: (): Promise<MainServerResponse> => ipcRenderer.invoke("main-server:stop"),
  stopZrokTunnel: (): Promise<MainServerResponse> => ipcRenderer.invoke("main-server:stop-tunnel"),
});
