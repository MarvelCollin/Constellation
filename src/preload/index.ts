import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
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
  LendOptions,
  LendStateResponse,
  ModelLibraryResponse,
  PoolMembersResponse,
  RuntimeConfigResponse,
} from "../shared/ai";

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
  getRuntimeConfig: (): Promise<RuntimeConfigResponse> => ipcRenderer.invoke("runtime:get"),
  pickRuntime: (): Promise<RuntimeConfigResponse> => ipcRenderer.invoke("runtime:pick"),
  clearRuntime: (): Promise<RuntimeConfigResponse> => ipcRenderer.invoke("runtime:clear"),
  installRuntime: (): Promise<RuntimeConfigResponse> => ipcRenderer.invoke("runtime:install"),
  listModels: (): Promise<ModelLibraryResponse> => ipcRenderer.invoke("models:list"),
  pickModelFile: (): Promise<ModelLibraryResponse> => ipcRenderer.invoke("models:pick"),
  removeModelEntry: (path: string): Promise<ModelLibraryResponse> => ipcRenderer.invoke("models:remove", path),
  selectModel: (path: string): Promise<ModelLibraryResponse> => ipcRenderer.invoke("models:select", path),
  getAIState: (): Promise<AIStateResponse> => ipcRenderer.invoke("ai:state"),
  loadAIModel: (options: AILoadOptions): Promise<AILoadResponse> => ipcRenderer.invoke("ai:load", options),
  unloadAIModel: (): Promise<AIUnloadResponse> => ipcRenderer.invoke("ai:unload"),
  getAIChatEndpoint: (): Promise<AIChatEndpointResponse> => ipcRenderer.invoke("ai:chat-endpoint"),
  startDownload: (request: DownloadStartRequest): Promise<DownloadStartResponse> =>
    ipcRenderer.invoke("downloads:start", request),
  cancelDownload: (id: string): Promise<DownloadCancelResponse> => ipcRenderer.invoke("downloads:cancel", id),
  openExternal: (url: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    ipcRenderer.invoke("shell:open-external", url),
  onDownloadProgress: (listener: (progress: DownloadProgress) => void) => {
    const handler = (_event: IpcRendererEvent, progress: DownloadProgress) => listener(progress);
    ipcRenderer.on("download:progress", handler);
    return () => ipcRenderer.removeListener("download:progress", handler);
  },
  getLendState: (): Promise<LendStateResponse> => ipcRenderer.invoke("pool:lend-state"),
  startLending: (options: LendOptions): Promise<LendStateResponse> => ipcRenderer.invoke("pool:lend-start", options),
  stopLending: (): Promise<LendStateResponse> => ipcRenderer.invoke("pool:lend-stop"),
  listPoolMembers: (): Promise<PoolMembersResponse> => ipcRenderer.invoke("pool:members"),
});
