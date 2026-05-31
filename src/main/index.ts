import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IpcMainInvokeEvent } from "electron";
import { connect as connectSocket } from "node:net";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  ChatFetchRequest,
  ChatMessage,
  ChatPeer,
  ChatResponse,
  ChatSendRequest,
  ChatSnapshot,
  ConnectMainServerResponse,
  FirewallPermissionResponse,
  HardwareScanResponse,
  HardwareSnapshot,
  HostDiagnosticCheck,
  HostDiagnosticsResponse,
  MainServerResponse,
  MainServerState,
  PortCleanupResponse,
  StartMainServerOptions,
  ZrokEnableResponse,
} from "../shared/hardware";
import type {
  AIChatEndpointResponse,
  AILoadOptions,
  AILoadResponse,
  AIState,
  AIStateResponse,
  AIUnloadResponse,
  DownloadCancelResponse,
  DownloadProgress,
  DownloadStartRequest,
  DownloadStartResponse,
  LendOptions,
  LendState,
  LendStateResponse,
  ModelLibrary,
  ModelLibraryResponse,
  PoolMembersResponse,
  PoolOffer,
  RuntimeConfig,
  RuntimeConfigResponse,
  SavedModelEntry,
} from "../shared/ai";

let mainServerProcess: ChildProcessWithoutNullStreams | null = null;
let zrokTunnelProcess: ChildProcessWithoutNullStreams | null = null;
let connectedServer: { url: string; token: string; peerName: string; peerId: string } | null = null;
let hostPeerId: string | null = null;
let hostHeartbeatTimer: NodeJS.Timeout | null = null;
let connectedHeartbeatTimer: NodeJS.Timeout | null = null;

const HEARTBEAT_INTERVAL_MS = 5000;
let mainServerState: MainServerState = {
  running: false,
  exposure: "internet",
  host: "0.0.0.0",
  port: 8765,
  url: null,
  lanUrl: null,
  publicUrl: null,
  exposureNote: null,
  token: null,
  pid: null,
  tunnelRunning: false,
  tunnelUrl: null,
  tunnelPid: null,
  tunnelNote: null,
};

const runtimePath = join(tmpdir(), "constellation-runtime", String(process.pid));
mkdirSync(join(runtimePath, "session"), { recursive: true });
app.commandLine.appendSwitch("disk-cache-dir", join(runtimePath, "cache"));
app.setPath("sessionData", join(runtimePath, "session"));

type ConstellationConfig = {
  runtimePath: string | null;
  modelPaths: string[];
  lastModelPath: string | null;
};

type ActiveDownload = {
  id: string;
  kind: "runtime" | "model";
  url: string;
  destination: string;
  status: "active" | "completed" | "error";
  receivedBytes: number;
  totalBytes: number | null;
  message: string | null;
  controller: AbortController;
};

const downloads = new Map<string, ActiveDownload>();
let mainWindow: BrowserWindow | null = null;

const RPC_DEFAULT_PORT = 50052;
const RPC_LOG_LIMIT = 100;

type LendRuntimeState = {
  process: ChildProcessWithoutNullStreams | null;
  port: number;
  rpcUrl: string | null;
  vramMb: number;
  ramMb: number;
  offerId: string | null;
  message: string | null;
  log: string[];
};

const lendState: LendRuntimeState = {
  process: null,
  port: RPC_DEFAULT_PORT,
  rpcUrl: null,
  vramMb: 0,
  ramMb: 0,
  offerId: null,
  message: null,
  log: [],
};

function userDataDir() {
  return app.getPath("userData");
}

function configPath() {
  return join(userDataDir(), "constellation.json");
}

function modelsDir() {
  const dir = join(userDataDir(), "models");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runtimeDir() {
  const dir = join(userDataDir(), "runtime");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultConfig(): ConstellationConfig {
  return { runtimePath: null, modelPaths: [], lastModelPath: null };
}

function readConfig(): ConstellationConfig {
  if (!existsSync(configPath())) {
    return defaultConfig();
  }

  const raw = readFileSync(configPath(), "utf8");
  const parsed = JSON.parse(raw) as Partial<ConstellationConfig>;

  return {
    runtimePath: typeof parsed.runtimePath === "string" ? parsed.runtimePath : null,
    modelPaths: Array.isArray(parsed.modelPaths) ? parsed.modelPaths.filter((value): value is string => typeof value === "string") : [],
    lastModelPath: typeof parsed.lastModelPath === "string" ? parsed.lastModelPath : null,
  };
}

function writeConfig(config: ConstellationConfig): void {
  mkdirSync(userDataDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}

function appConfig(): ConstellationConfig {
  return readConfig();
}

function persistRuntimePath(path: string | null) {
  const config = readConfig();
  config.runtimePath = path;
  writeConfig(config);
}

function addModelPath(path: string) {
  const config = readConfig();

  if (!config.modelPaths.includes(path)) {
    config.modelPaths = [...config.modelPaths, path];
  }

  config.lastModelPath = path;
  writeConfig(config);
}

function removeModelPath(path: string) {
  const config = readConfig();
  config.modelPaths = config.modelPaths.filter((entry) => entry !== path);

  if (config.lastModelPath === path) {
    config.lastModelPath = null;
  }

  writeConfig(config);
}

function setLastModelPath(path: string) {
  const config = readConfig();
  config.lastModelPath = path;

  if (!config.modelPaths.includes(path)) {
    config.modelPaths = [...config.modelPaths, path];
  }

  writeConfig(config);
}

function describeModel(path: string): SavedModelEntry {
  let fileSizeBytes: number | null = null;

  if (existsSync(path)) {
    fileSizeBytes = statSync(path).size;
  }

  return {
    path,
    displayName: basename(path).replace(/\.gguf$/i, ""),
    fileSizeBytes,
  };
}

function scanDiscoveredModels(): string[] {
  const dir = modelsDir();
  const entries = readdirSync(dir);
  return entries
    .filter((entry) => entry.toLowerCase().endsWith(".gguf"))
    .map((entry) => join(dir, entry));
}

function buildModelLibrary(): ModelLibrary {
  const config = readConfig();
  const discovered = scanDiscoveredModels();
  const combined = new Set<string>([...config.modelPaths, ...discovered]);
  const entries = Array.from(combined)
    .map(describeModel)
    .filter((entry) => entry.fileSizeBytes !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  return {
    modelsDir: modelsDir(),
    entries,
    lastModelPath: config.lastModelPath,
  };
}

function buildRuntimeConfig(): RuntimeConfig {
  const config = readConfig();
  const path = config.runtimePath;
  return {
    path,
    exists: typeof path === "string" && existsSync(path),
  };
}

function emitDownload(download: ActiveDownload) {
  const payload: DownloadProgress = {
    id: download.id,
    kind: download.kind,
    url: download.url,
    destination: download.destination,
    status: download.status,
    receivedBytes: download.receivedBytes,
    totalBytes: download.totalBytes,
    message: download.message,
  };

  mainWindow?.webContents.send("download:progress", payload);
}

function downloadSnapshot(download: ActiveDownload): DownloadProgress {
  return {
    id: download.id,
    kind: download.kind,
    url: download.url,
    destination: download.destination,
    status: download.status,
    receivedBytes: download.receivedBytes,
    totalBytes: download.totalBytes,
    message: download.message,
  };
}

async function performDownload(download: ActiveDownload, destinationDir: string) {
  try {
    const response = await fetch(download.url, {
      method: "GET",
      redirect: "follow",
      signal: download.controller.signal,
    });

    if (!response.ok || response.body === null) {
      download.status = "error";
      download.message = `Download failed with status ${response.status}`;
      emitDownload(download);
      return;
    }

    const totalHeader = response.headers.get("Content-Length");
    download.totalBytes = totalHeader ? Number.parseInt(totalHeader, 10) : null;

    mkdirSync(destinationDir, { recursive: true });
    const finalPath = join(destinationDir, basename(download.destination));
    download.destination = finalPath;

    const fileStream = createWriteStream(finalPath);
    let lastEmit = 0;
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        if (value && value.length > 0) {
          const buffer = Buffer.from(value);

          if (!fileStream.write(buffer)) {
            await new Promise<void>((resolve) => fileStream.once("drain", resolve));
          }

          download.receivedBytes += buffer.length;
          const now = Date.now();

          if (now - lastEmit >= 200) {
            lastEmit = now;
            emitDownload(download);
          }
        }
      }
    } finally {
      reader.releaseLock();
      await new Promise<void>((resolve, reject) => {
        fileStream.end((error?: NodeJS.ErrnoException | null) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    download.status = "completed";
    download.message = "Download complete";
    emitDownload(download);

    if (download.kind === "runtime") {
      persistRuntimePath(finalPath);
    } else {
      addModelPath(finalPath);
    }
  } catch (error) {
    if (existsSync(download.destination)) {
      try {
        unlinkSync(download.destination);
      } catch {
        return;
      }
    }

    download.status = "error";
    download.message = error instanceof Error ? error.message : "Download failed";
    emitDownload(download);
  } finally {
    setTimeout(() => downloads.delete(download.id), 5000);
  }
}

async function localServerRequest(path: string, init?: RequestInit): Promise<unknown> {
  if (!mainServerState.token || !mainServerProcess) {
    throw new Error("Main server is not running");
  }

  const url = `http://127.0.0.1:${mainServerState.port}${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${mainServerState.token}`);

  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response.json();
}

function isAIState(value: unknown): value is AIState {
  return (
    isRecord(value) &&
    typeof value.running === "boolean" &&
    typeof value.ready === "boolean" &&
    (typeof value.modelPath === "string" || value.modelPath === null) &&
    (typeof value.runtimePath === "string" || value.runtimePath === null) &&
    typeof value.nGpuLayers === "number" &&
    typeof value.contextSize === "number" &&
    Array.isArray(value.rpcPeers) &&
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    Array.isArray(value.log)
  );
}

function parseLoadOptions(value: unknown): AILoadOptions | null {
  if (
    !isRecord(value) ||
    typeof value.modelPath !== "string" ||
    typeof value.nGpuLayers !== "number" ||
    typeof value.contextSize !== "number"
  ) {
    return null;
  }

  if (value.modelPath.length < 1) {
    return null;
  }

  if (value.nGpuLayers < 0 || value.nGpuLayers > 999) {
    return null;
  }

  if (value.contextSize < 256 || value.contextSize > 131072) {
    return null;
  }

  const rawRpcPeers = value.rpcPeers;
  const rpcPeers: string[] = [];

  if (Array.isArray(rawRpcPeers)) {
    for (const peer of rawRpcPeers) {
      if (typeof peer === "string" && peer.length > 0) {
        rpcPeers.push(peer);
      }
    }
  }

  return {
    modelPath: value.modelPath,
    nGpuLayers: Math.floor(value.nGpuLayers),
    contextSize: Math.floor(value.contextSize),
    rpcPeers,
  };
}

function rpcServerExecutable(runtimePath: string): string {
  const directory = dirname(runtimePath);
  const name = process.platform === "win32" ? "rpc-server.exe" : "rpc-server";
  return join(directory, name);
}

function currentLendState(): LendState {
  return {
    running: lendState.process !== null,
    port: lendState.port,
    rpcUrl: lendState.rpcUrl,
    vramMb: lendState.vramMb,
    ramMb: lendState.ramMb,
    offerId: lendState.offerId,
    message: lendState.message,
    log: lendState.log.slice(-30),
  };
}

function resetLendRuntime() {
  lendState.process = null;
  lendState.rpcUrl = null;
  lendState.vramMb = 0;
  lendState.ramMb = 0;
  lendState.offerId = null;
  lendState.log = [];
}

function appendLendLog(line: string) {
  lendState.log.push(line);

  if (lendState.log.length > RPC_LOG_LIMIT) {
    lendState.log = lendState.log.slice(-RPC_LOG_LIMIT);
  }
}

function killLendProcess() {
  const child = lendState.process;

  if (child !== null) {
    try {
      child.kill();
    } catch {
      return;
    }
  }
}

function parseLendOptions(value: unknown): LendOptions | null {
  if (
    !isRecord(value) ||
    typeof value.port !== "number" ||
    typeof value.vramMb !== "number" ||
    typeof value.ramMb !== "number"
  ) {
    return null;
  }

  if (value.port < 1024 || value.port > 65535) {
    return null;
  }

  if (value.vramMb < 0 || value.vramMb > 1_048_576) {
    return null;
  }

  if (value.ramMb < 0 || value.ramMb > 1_048_576) {
    return null;
  }

  return {
    port: Math.floor(value.port),
    vramMb: Math.floor(value.vramMb),
    ramMb: Math.floor(value.ramMb),
  };
}

function isPoolOffer(value: unknown): value is PoolOffer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.peerId === "string" &&
    typeof value.peerName === "string" &&
    typeof value.rpcUrl === "string" &&
    typeof value.vramMb === "number" &&
    typeof value.ramMb === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.lastSeen === "string" &&
    typeof value.online === "boolean"
  );
}

async function callConnectedServer(path: string, init?: RequestInit): Promise<unknown> {
  if (!connectedServer) {
    throw new Error("Not connected to a host server.");
  }

  return serverJsonRequest(connectedServer.url, connectedServer.token, path, init);
}

function parseDownloadStartRequest(value: unknown): DownloadStartRequest | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.kind !== "runtime" && value.kind !== "model") ||
    typeof value.url !== "string" ||
    typeof value.destinationName !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    kind: value.kind,
    url: value.url,
    destinationName: value.destinationName,
  };
}

function loadEnvFile() {
  const envPath = join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");

    if (!trimmed || trimmed.startsWith("#") || separator < 1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGpuInfo(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.memory_mb === "number" &&
    typeof value.memory_free_mb === "number" &&
    typeof value.driver === "string" &&
    typeof value.vendor === "string"
  );
}

function isHardwareSnapshot(value: unknown): value is HardwareSnapshot {
  return (
    isRecord(value) &&
    typeof value.platform === "string" &&
    typeof value.python_version === "string" &&
    (typeof value.cpu_count === "number" || value.cpu_count === null) &&
    (typeof value.memory_bytes === "number" || value.memory_bytes === null) &&
    (typeof value.memory_free_bytes === "number" || value.memory_free_bytes === null) &&
    (typeof value.storage_bytes === "number" || value.storage_bytes === null) &&
    (typeof value.storage_free_bytes === "number" || value.storage_free_bytes === null) &&
    typeof value.gpu_vendor === "string" &&
    Array.isArray(value.gpus) &&
    value.gpus.every(isGpuInfo)
  );
}

function isChatPeer(value: unknown): value is ChatPeer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.lastSeen === "string" &&
    typeof value.online === "boolean"
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.sender === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string"
  );
}

function isChatSnapshot(value: unknown): value is ChatSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.peers) &&
    value.peers.every(isChatPeer) &&
    Array.isArray(value.messages) &&
    value.messages.every(isChatMessage)
  );
}

function parseStartOptions(value: unknown): StartMainServerOptions | null {
  if (!isRecord(value) || (value.exposure !== "lan" && value.exposure !== "internet")) {
    return null;
  }

  return { exposure: value.exposure };
}

function parseConnectRequest(value: unknown): { url: string; token: string } | null {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.token !== "string") {
    return null;
  }

  const token = value.token.trim();
  const url = normalizeServerUrl(value.url);

  if (!url || token.length < 8 || token.length > 128) {
    return null;
  }

  return { url, token };
}

function parseChatFetchRequest(value: unknown): ChatFetchRequest | null {
  if (!isRecord(value) || (value.target !== "host" && value.target !== "connected")) {
    return null;
  }

  return { target: value.target };
}

function parseChatSendRequest(value: unknown): ChatSendRequest | null {
  if (
    !isRecord(value) ||
    (value.target !== "host" && value.target !== "connected") ||
    typeof value.body !== "string"
  ) {
    return null;
  }

  const body = value.body.trim();

  if (body.length < 1 || body.length > 1000) {
    return null;
  }

  return { target: value.target, body };
}

function pythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}

function zrokCommand() {
  const executable = process.platform === "win32" ? "zrok2.exe" : "zrok2";
  const bundled = app.isPackaged ? join(process.resourcesPath, "zrok", executable) : join(process.cwd(), "bin", executable);
  return existsSync(bundled) ? bundled : "zrok2";
}

function workerPath() {
  return app.isPackaged ? join(process.resourcesPath, "python") : join(process.cwd(), "python");
}

function pythonFailureMessage(error: Error, action: string) {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : null;

  if (code !== "ENOENT" && !error.message.includes("ENOENT")) {
    return error.message;
  }

  return [
    `${action} could not start because Python was not found on this machine.`,
    "Install Python 3.11 or newer, then make sure python is available from PowerShell.",
    "Check with: python --version",
    "If that command fails, reinstall Python and enable Add python.exe to PATH.",
    "The current desktop build includes the worker code, but it still needs a local Python runtime.",
  ].join("\n");
}

function zrokFailureMessage(error: Error) {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : null;

  if (code !== "ENOENT" && !error.message.includes("ENOENT")) {
    return error.message;
  }

  return [
    "zrok was not found on this machine.",
    "Install zrok, or put zrok2.exe in the app bin folder.",
    "After that, enable zrok and click Start tunnel again.",
  ].join("\n");
}

function lanAddress() {
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }

  return "127.0.0.1";
}

async function publicAddress() {
  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      method: "GET",
      redirect: "manual",
    });

    if (!response.ok) {
      return null;
    }

    const payload: unknown = await response.json();

    if (!isRecord(payload) || typeof payload.ip !== "string") {
      return null;
    }

    return payload.ip;
  } catch {
    return null;
  }
}

function normalizeServerUrl(value: string) {
  const input = value.trim();

  if (!input) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}`;

  try {
    const url = new URL(withProtocol);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function nodeName() {
  return `${hostname()} (${process.platform})`;
}

function hostServerConnection() {
  if (!mainServerProcess || !mainServerState.token) {
    return null;
  }

  return {
    url: `http://127.0.0.1:${mainServerState.port}`,
    token: mainServerState.token,
    peerName: "Host",
  };
}

function chatConnection(target: "host" | "connected") {
  if (target === "host") {
    return hostServerConnection();
  }

  return connectedServer;
}

async function serverJsonRequest(url: string, token: string, path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${url}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });

  if (response.status === 401) {
    throw new Error("Token was rejected by the server.");
  }

  if (!response.ok) {
    throw new Error(`Server request failed with status ${response.status}`);
  }

  return response.json();
}

function connectFailureMessage(error: unknown, url: string) {
  if (error instanceof Error && error.message !== "fetch failed") {
    return error.message;
  }

  const code = isRecord(error) && isRecord(error.cause) && typeof error.cause.code === "string" ? error.cause.code : null;
  return [
    `Could not reach ${url}.`,
    code ? `Network error: ${code}.` : "Network request failed before the server replied.",
    "Check that the host app is open, the server is started, and the URL uses the host IP with port 8765.",
    "Firewall permission only opens this laptop. It does not open the router or ISP network.",
    "If this is outside the same Wi-Fi, forward TCP port 8765 to the host laptop LAN IP or use a tunnel.",
    "Also allow Constellation or Python through Windows Firewall on the host.",
  ].join("\n");
}

async function registerPeer(url: string, token: string, name: string): Promise<string> {
  const payload = await serverJsonRequest(url, token, "/api/peers", {
    body: JSON.stringify({ name }),
    method: "POST",
  });

  if (
    !isRecord(payload) ||
    payload.ok !== true ||
    !isRecord(payload.data) ||
    !isRecord(payload.data.peer) ||
    typeof payload.data.peer.id !== "string"
  ) {
    throw new Error("Peer registration response did not include an id");
  }

  return payload.data.peer.id;
}

async function sendHeartbeat(url: string, token: string, peerId: string): Promise<void> {
  await serverJsonRequest(url, token, "/api/peers/heartbeat", {
    body: JSON.stringify({ id: peerId }),
    method: "POST",
  });
}

function startHostHeartbeat() {
  stopHostHeartbeat();

  if (!hostPeerId || !mainServerState.token) {
    return;
  }

  const url = `http://127.0.0.1:${mainServerState.port}`;
  const token = mainServerState.token;
  const peerId = hostPeerId;

  hostHeartbeatTimer = setInterval(() => {
    void sendHeartbeat(url, token, peerId).catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHostHeartbeat() {
  if (hostHeartbeatTimer) {
    clearInterval(hostHeartbeatTimer);
    hostHeartbeatTimer = null;
  }
}

function startConnectedHeartbeat() {
  stopConnectedHeartbeat();

  if (!connectedServer) {
    return;
  }

  const { url, token, peerId } = connectedServer;

  connectedHeartbeatTimer = setInterval(() => {
    void sendHeartbeat(url, token, peerId).catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);
}

function stopConnectedHeartbeat() {
  if (connectedHeartbeatTimer) {
    clearInterval(connectedHeartbeatTimer);
    connectedHeartbeatTimer = null;
  }
}

function scanHardware(): Promise<HardwareScanResponse> {
  return new Promise((resolve) => {
    const child = spawn(pythonCommand(), ["-m", "constellation_worker"], {
      cwd: workerPath(),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ ok: false, error: pythonFailureMessage(error, "Hardware scan") });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `Hardware scan exited with code ${code}` });
        return;
      }

      try {
        const payload: unknown = JSON.parse(stdout);

        if (!isHardwareSnapshot(payload)) {
          resolve({ ok: false, error: "Hardware scan returned an unexpected response" });
          return;
        }

        resolve({ ok: true, data: payload });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : "Hardware scan response could not be parsed",
        });
      }
    });
  });
}

function currentMainServerState(): MainServerState {
  return {
    ...mainServerState,
    running: mainServerProcess !== null,
    pid: mainServerProcess?.pid ?? null,
    tunnelRunning: zrokTunnelProcess !== null,
    tunnelPid: zrokTunnelProcess?.pid ?? null,
  };
}

function getMainServerState(): MainServerResponse {
  return { ok: true, data: currentMainServerState() };
}

function cleanupZrokTunnelProcess() {
  if (zrokTunnelProcess) {
    zrokTunnelProcess.kill();
    zrokTunnelProcess = null;
  }

  mainServerState = {
    ...mainServerState,
    tunnelRunning: false,
    tunnelUrl: null,
    tunnelPid: null,
    tunnelNote: null,
  };
}

function cleanupMainServerProcesses() {
  cleanupZrokTunnelProcess();
  stopHostHeartbeat();
  hostPeerId = null;

  if (mainServerProcess) {
    mainServerProcess.kill();
    mainServerProcess = null;
  }

  if (process.platform !== "win32") {
    return;
  }

  const command = [
    "$connections = @(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)",
    "foreach ($connection in $connections) { $process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($connection.OwningProcess)\" -ErrorAction SilentlyContinue; if ($process.CommandLine -like '*constellation_worker.server*') { Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue } }",
  ].join("; ");

  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    windowsHide: true,
  });
}

async function clearServerPort(): Promise<PortCleanupResponse> {
  cleanupMainServerProcesses();
  resetMainServerState();

  const owner = await portOwnerSummary(8765);

  if (owner.active) {
    return {
      ok: false,
      error: [`Port 8765 is still in use after cleanup.`, owner.value].join("\n"),
    };
  }

  return { ok: true, message: "Port 8765 is clear. Start the server again." };
}

function tcpProbe(host: string, port: number, timeout = 2500): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = connectSocket({ host, port });

    const finish = (ok: boolean, detail: string) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve({ ok, detail });
    };

    socket.setTimeout(timeout);
    socket.on("connect", () => finish(true, `TCP accepted on ${host}:${port}`));
    socket.on("timeout", () => finish(false, `TCP timed out after ${timeout}ms on ${host}:${port}`));
    socket.on("error", (error: Error) => finish(false, `${error.message} on ${host}:${port}`));
  });
}

function firewallRuleSummary(): Promise<{ active: boolean; value: string }> {
  if (process.platform !== "win32") {
    return Promise.resolve({ active: false, value: "Firewall rule check is only available on Windows." });
  }

  const command = [
    "$rules = @(Get-NetFirewallRule -DisplayName 'Constellation Server 8765' -ErrorAction SilentlyContinue)",
    "$active = @($rules | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' })",
    "$ports = @($rules | Get-NetFirewallPortFilter | ForEach-Object { \"$($_.Protocol)/$($_.LocalPort)\" })",
    "Write-Output \"rules=$($rules.Count); active=$($active.Count); ports=$($ports -join ', ')\"",
    "if ($active.Count -gt 0) { exit 0 } exit 1",
  ].join("; ");

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      resolve({ active: false, value: error.message });
    });

    child.on("close", (code) => {
      resolve({
        active: code === 0,
        value: stdout.trim() || stderr.trim() || "No firewall rule output was returned.",
      });
    });
  });
}

function portOwnerSummary(port: number): Promise<{ active: boolean; value: string }> {
  if (process.platform !== "win32") {
    return Promise.resolve({ active: false, value: "Port owner check is only available on Windows." });
  }

  const command = [
    `$connections = @(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue)`,
    "if ($connections.Count -eq 0) { Write-Output 'no listener'; exit 1 }",
    "$items = @()",
    "foreach ($connection in $connections) { $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue; $items += \"$($connection.LocalAddress):$($connection.LocalPort) pid=$($connection.OwningProcess) process=$($process.ProcessName)\" }",
    "Write-Output ($items -join '; ')",
    "exit 0",
  ].join("; ");

  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      resolve({ active: false, value: error.message });
    });

    child.on("close", (code) => {
      resolve({
        active: code === 0,
        value: stdout.trim() || stderr.trim() || "No port owner output was returned.",
      });
    });
  });
}

function firewallRuleActive(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$rule = Get-NetFirewallRule -DisplayName 'Constellation Server 8765' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }; if ($rule) { exit 0 } exit 1",
      ],
      { windowsHide: true },
    );

    child.on("error", () => {
      resolve(false);
    });

    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

async function diagnoseHost(): Promise<HostDiagnosticsResponse> {
  const state = currentMainServerState();
  const firewall = await firewallRuleSummary();
  const owner = await portOwnerSummary(state.port);
  const localProbe = await tcpProbe("127.0.0.1", state.port);
  const checks: HostDiagnosticCheck[] = [
    {
      label: "Server process",
      status: state.running ? "ok" : "error",
      value: state.running ? `running on pid ${state.pid ?? "unknown"}` : "not running in this app",
    },
    {
      label: "Local TCP listener",
      status: localProbe.ok ? "ok" : "error",
      value: localProbe.detail,
    },
    {
      label: "Port owner",
      status: state.running && owner.value.includes(`pid=${state.pid}`) ? "ok" : owner.active ? "warning" : "error",
      value: owner.value,
    },
    {
      label: "Windows firewall",
      status: firewall.active ? "ok" : "warning",
      value: firewall.value,
    },
    {
      label: "LAN URL",
      status: state.lanUrl ? "info" : "warning",
      value: state.lanUrl ?? "not available until the server starts",
    },
    {
      label: "Public URL",
      status: state.publicUrl ? "info" : "warning",
      value: state.publicUrl ?? "public IP was not detected",
    },
    {
      label: "zrok tunnel",
      status: state.tunnelRunning && state.tunnelUrl ? "ok" : "info",
      value: state.tunnelUrl ?? "not started",
    },
  ];

  if (state.token) {
    try {
      await serverJsonRequest(`http://127.0.0.1:${state.port}`, state.token, "/health", { method: "GET" });
      checks.splice(2, 0, {
        label: "Local health endpoint",
        status: "ok",
        value: `authorized /health works on 127.0.0.1:${state.port}`,
      });
    } catch (error) {
      checks.splice(2, 0, {
        label: "Local health endpoint",
        status: "error",
        value: error instanceof Error ? error.message : "local /health failed",
      });
    }
  } else {
    checks.splice(2, 0, {
      label: "Local health endpoint",
      status: "warning",
      value: "skipped because no server token exists yet",
    });
  }

  if (state.publicUrl) {
    const publicHost = new URL(state.publicUrl).hostname;
    const publicProbe = await tcpProbe(publicHost, state.port);
    checks.push({
      label: "Public TCP probe",
      status: publicProbe.ok ? "ok" : "warning",
      value: publicProbe.ok
        ? `${publicProbe.detail}. If friends still fail, confirm they use the same URL and token.`
        : `${publicProbe.detail}. If friends also fail, the likely cause is router port forwarding, ISP CGNAT, or no tunnel.`,
    });
  }

  if (state.tunnelUrl) {
    const tunnelHost = new URL(state.tunnelUrl).hostname;
    const tunnelProbe = await tcpProbe(tunnelHost, 443);
    checks.push({
      label: "zrok TCP probe",
      status: tunnelProbe.ok ? "ok" : "warning",
      value: tunnelProbe.ok ? `${tunnelProbe.detail}. Share the zrok URL and join secret.` : tunnelProbe.detail,
    });
  }

  const publicCheck = checks.find((check) => check.label === "Public TCP probe");
  const tunnelCheck = checks.find((check) => check.label === "zrok TCP probe");
  const summary =
    !state.running || !localProbe.ok
      ? "The host server is not reachable locally. Start the server first and keep this app open."
      : tunnelCheck?.status === "ok"
        ? "The server is reachable through zrok. Share the zrok URL and join secret."
      : firewall.active && publicCheck?.status === "warning"
        ? "The app and firewall look OK locally. The public path is blocked before it reaches the app."
        : firewall.active
          ? "Local host checks pass. If remote users still fail, check router forwarding, CGNAT, or tunnel setup."
          : "The server is local, but firewall permission is not confirmed.";

  return { ok: true, data: { summary, checks } };
}

function enableZrok(_event: IpcMainInvokeEvent): Promise<ZrokEnableResponse> {
  const token = process.env.ZROK_TOKEN?.trim();

  if (!token || token.length < 8) {
    return Promise.resolve({ ok: false, error: "Set ZROK_TOKEN in .env before enabling zrok." });
  }

  return new Promise((resolve) => {
    const child = spawn(zrokCommand(), ["enable", "--headless", token], {
      windowsHide: true,
    });
    let output = "";

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("error", (error: Error) => {
      resolve({ ok: false, error: zrokFailureMessage(error) });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const message = output.trim() || `zrok enable exited with code ${code}`;

        if (message.includes("already have an enabled environment")) {
          resolve({ ok: true, message: "zrok is already enabled on this machine." });
          return;
        }

        resolve({ ok: false, error: message });
        return;
      }

      resolve({ ok: true, message: "zrok is enabled on this machine." });
    });
  });
}

function startZrokTunnel(): Promise<MainServerResponse> {
  if (!mainServerProcess || !mainServerState.token) {
    return Promise.resolve({ ok: false, error: "Start the server before starting a zrok tunnel." });
  }

  if (zrokTunnelProcess) {
    return Promise.resolve({ ok: true, data: currentMainServerState() });
  }

  return new Promise((resolve) => {
    const child = spawn(zrokCommand(), ["share", "public", "--headless", `http://127.0.0.1:${mainServerState.port}`], {
      windowsHide: true,
    });
    let settled = false;
    let output = "";

    const finish = (response: MainServerResponse) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(response);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: output.trim() || "zrok did not return a public URL within 20 seconds. Enable zrok first." });
    }, 20000);

    const readOutput = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/(?:https:\/\/)?[a-z0-9-]+\.shares\.zrok\.io/i);

      if (!match) {
        return;
      }

      const tunnelUrl = match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
      zrokTunnelProcess = child;
      mainServerState = {
        ...mainServerState,
        tunnelRunning: true,
        tunnelUrl,
        tunnelPid: child.pid ?? null,
        tunnelNote: "zrok forwards traffic to this laptop. Share this URL plus the join secret.",
      };
      finish({ ok: true, data: currentMainServerState() });
    };

    child.stdout.on("data", readOutput);
    child.stderr.on("data", readOutput);

    child.on("error", (error: Error) => {
      finish({ ok: false, error: zrokFailureMessage(error) });
    });

    child.on("exit", (code: number | null) => {
      if (zrokTunnelProcess === child) {
        cleanupZrokTunnelProcess();
      }

      if (!settled) {
        finish({ ok: false, error: output.trim() || `zrok tunnel exited with code ${code}` });
      }
    });
  });
}

function stopZrokTunnel(): MainServerResponse {
  cleanupZrokTunnelProcess();
  return { ok: true, data: currentMainServerState() };
}

function allowFirewall(): Promise<FirewallPermissionResponse> {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, error: "Firewall permission prompt is only available on Windows." });
  }

  const command = [
    "$rule = Get-NetFirewallRule -DisplayName 'Constellation Server 8765' -ErrorAction SilentlyContinue",
    "if (-not $rule) { New-NetFirewallRule -DisplayName 'Constellation Server 8765' -Direction Inbound -Protocol TCP -LocalPort 8765 -Profile Any -Action Allow | Out-Null }",
  ].join("; ");
  const encoded = Buffer.from(command, "utf16le").toString("base64");

  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Start-Process powershell.exe -WindowStyle Hidden -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}'`,
      ],
      { windowsHide: true },
    );
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      resolve({ ok: false, error: error.message });
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `Firewall permission prompt exited with code ${code}` });
        return;
      }

      const active = await firewallRuleActive();
      resolve(
        active
          ? { ok: true, message: "Firewall rule is active for inbound TCP port 8765." }
          : { ok: false, error: "Firewall rule was not created. Accept the Windows admin prompt and try again." },
      );
    });
  });
}

function resetMainServerState() {
  mainServerState = {
    running: false,
    exposure: "internet",
    host: "0.0.0.0",
    port: 8765,
    url: null,
    lanUrl: null,
    publicUrl: null,
    exposureNote: null,
    token: null,
    pid: null,
    tunnelRunning: false,
    tunnelUrl: null,
    tunnelPid: null,
    tunnelNote: null,
  };
}

async function startMainServer(_event: IpcMainInvokeEvent, value: unknown): Promise<MainServerResponse> {
  if (mainServerProcess) {
    return Promise.resolve({ ok: true, data: currentMainServerState() });
  }

  const options = parseStartOptions(value);

  if (!options) {
    return Promise.resolve({
      ok: false,
      error: "Choose LAN or Internet exposure before starting the server.",
    });
  }

  const host = "0.0.0.0";
  const port = 8765;
  const token = randomBytes(24).toString("hex");
  const owner = await portOwnerSummary(port);

  if (owner.active) {
    return {
      ok: false,
      error: [
        `Port ${port} is already in use before this app started.`,
        owner.value,
        "Stop stale Constellation server processes, then start the server again.",
      ].join("\n"),
    };
  }

  const lanUrl = `http://${lanAddress()}:${port}`;
  const detectedPublicAddress = options.exposure === "internet" ? await publicAddress() : null;
  const publicUrl = detectedPublicAddress ? `http://${detectedPublicAddress}:${port}` : null;
  const url = options.exposure === "internet" ? publicUrl ?? lanUrl : lanUrl;
  const exposureNote =
    options.exposure === "internet"
      ? "Firewall access is only local. Public access still needs router port forwarding or a tunnel."
      : null;

  return new Promise((resolve) => {
    const child = spawn(
      pythonCommand(),
      ["-m", "constellation_worker.server", "--host", host, "--port", String(port), "--token", token],
      {
        cwd: workerPath(),
        windowsHide: true,
      },
    );
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (response: MainServerResponse) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(response);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: "Main server did not start within 5 seconds" });
    }, 5000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();

      if (!stdout.includes('"event": "ready"') && !stdout.includes('"event":"ready"')) {
        return;
      }

      mainServerProcess = child;
      mainServerState = {
        running: true,
        exposure: options.exposure,
        host,
        port,
        url,
        lanUrl,
        publicUrl,
        exposureNote,
        token,
        pid: child.pid ?? null,
        tunnelRunning: false,
        tunnelUrl: null,
        tunnelPid: null,
        tunnelNote: null,
      };
      void registerPeer(`http://127.0.0.1:${port}`, token, "Host")
        .then((peerId) => {
          hostPeerId = peerId;
          startHostHeartbeat();
          finish({ ok: true, data: currentMainServerState() });
        })
        .catch((error: unknown) => {
          child.kill();
          mainServerProcess = null;
          resetMainServerState();
          finish({
            ok: false,
            error: [
              "Main server started, but the local server rejected the generated token.",
              error instanceof Error ? error.message : "Peer registration failed.",
              "A stale Constellation worker is probably still holding port 8765.",
            ].join("\n"),
          });
        });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      finish({ ok: false, error: pythonFailureMessage(error, "Main server") });
    });

    child.on("exit", (code: number | null) => {
      if (mainServerProcess === child) {
        mainServerProcess = null;
        stopHostHeartbeat();
        hostPeerId = null;
        resetMainServerState();
      }

      if (!settled) {
        finish({ ok: false, error: stderr.trim() || `Main server exited with code ${code}` });
      }
    });
  });
}

async function fetchChat(_event: IpcMainInvokeEvent, value: unknown): Promise<ChatResponse> {
  const request = parseChatFetchRequest(value);

  if (!request) {
    return { ok: false, error: "Choose a valid chat target." };
  }

  const connection = chatConnection(request.target);

  if (!connection) {
    return {
      ok: false,
      error: request.target === "host" ? "Start the server before opening chat." : "Connect to a server before opening chat.",
    };
  }

  try {
    const payload = await serverJsonRequest(connection.url, connection.token, "/api/chat", {
      method: "GET",
    });

    if (!isRecord(payload) || payload.ok !== true || !isChatSnapshot(payload.data)) {
      return { ok: false, error: "Server returned an unexpected chat response." };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not fetch chat." };
  }
}

async function sendChat(_event: IpcMainInvokeEvent, value: unknown): Promise<ChatResponse> {
  const request = parseChatSendRequest(value);

  if (!request) {
    return { ok: false, error: "Message must be 1 to 1000 characters." };
  }

  const connection = chatConnection(request.target);

  if (!connection) {
    return {
      ok: false,
      error: request.target === "host" ? "Start the server before sending chat." : "Connect to a server before sending chat.",
    };
  }

  try {
    const payload = await serverJsonRequest(connection.url, connection.token, "/api/chat", {
      body: JSON.stringify({ sender: connection.peerName, body: request.body }),
      method: "POST",
    });

    if (!isRecord(payload) || payload.ok !== true || !isChatSnapshot(payload.data)) {
      return { ok: false, error: "Server returned an unexpected chat response." };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not send chat." };
  }
}

async function connectToMainServer(_event: IpcMainInvokeEvent, value: unknown): Promise<ConnectMainServerResponse> {
  const request = parseConnectRequest(value);

  if (!request) {
    return { ok: false, error: "Enter a valid server URL and token." };
  }

  try {
    await serverJsonRequest(request.url, request.token, "/health", {
      method: "GET",
    });

    const payload = await serverJsonRequest(request.url, request.token, "/api/hardware", {
      method: "GET",
    });

    if (!isRecord(payload) || payload.ok !== true || !isHardwareSnapshot(payload.data)) {
      return { ok: false, error: "Server returned an unexpected hardware response." };
    }

    const peerName = nodeName();
    const peerId = await registerPeer(request.url, request.token, peerName);
    connectedServer = { url: request.url, token: request.token, peerName, peerId };
    startConnectedHeartbeat();

    return { ok: true, data: { url: request.url, hardware: payload.data } };
  } catch (error) {
    return { ok: false, error: connectFailureMessage(error, request.url) };
  }
}

function stopMainServer(): MainServerResponse {
  cleanupMainServerProcesses();
  resetMainServerState();
  return { ok: true, data: currentMainServerState() };
}

function getRuntimeConfig(): RuntimeConfigResponse {
  return { ok: true, data: buildRuntimeConfig() };
}

async function pickRuntime(_event: IpcMainInvokeEvent): Promise<RuntimeConfigResponse> {
  const owner = mainWindow;

  if (owner === null) {
    return { ok: false, error: "Main window is not available." };
  }

  const result = await dialog.showOpenDialog(owner, {
    title: "Choose llama-server executable",
    properties: ["openFile"],
    filters: process.platform === "win32"
      ? [{ name: "Executable", extensions: ["exe"] }]
      : [{ name: "Executable", extensions: ["*"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: true, data: buildRuntimeConfig() };
  }

  const chosen = result.filePaths[0];

  if (!existsSync(chosen)) {
    return { ok: false, error: "Selected file does not exist." };
  }

  persistRuntimePath(chosen);
  return { ok: true, data: buildRuntimeConfig() };
}

function clearRuntime(): RuntimeConfigResponse {
  persistRuntimePath(null);
  return { ok: true, data: buildRuntimeConfig() };
}

function listModels(): ModelLibraryResponse {
  return { ok: true, data: buildModelLibrary() };
}

async function pickModelFile(_event: IpcMainInvokeEvent): Promise<ModelLibraryResponse> {
  const owner = mainWindow;

  if (owner === null) {
    return { ok: false, error: "Main window is not available." };
  }

  const result = await dialog.showOpenDialog(owner, {
    title: "Choose GGUF model file",
    properties: ["openFile"],
    filters: [{ name: "GGUF model", extensions: ["gguf"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: true, data: buildModelLibrary() };
  }

  const chosen = result.filePaths[0];

  if (!existsSync(chosen)) {
    return { ok: false, error: "Selected file does not exist." };
  }

  addModelPath(chosen);
  return { ok: true, data: buildModelLibrary() };
}

function removeModelEntry(_event: IpcMainInvokeEvent, value: unknown): ModelLibraryResponse {
  if (typeof value !== "string") {
    return { ok: false, error: "Model path is required." };
  }

  removeModelPath(value);
  return { ok: true, data: buildModelLibrary() };
}

function selectModel(_event: IpcMainInvokeEvent, value: unknown): ModelLibraryResponse {
  if (typeof value !== "string") {
    return { ok: false, error: "Model path is required." };
  }

  setLastModelPath(value);
  return { ok: true, data: buildModelLibrary() };
}

async function getAIState(): Promise<AIStateResponse> {
  if (!mainServerProcess || !mainServerState.token) {
    return { ok: false, error: "Start the server before using AI." };
  }

  try {
    const payload = await localServerRequest("/api/ai/state");

    if (!isRecord(payload) || payload.ok !== true || !isAIState(payload.data)) {
      return { ok: false, error: "Unexpected AI state response." };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not fetch AI state." };
  }
}

async function loadAIModel(_event: IpcMainInvokeEvent, value: unknown): Promise<AILoadResponse> {
  if (!mainServerProcess) {
    return { ok: false, error: "Start the server before loading a model." };
  }

  const options = parseLoadOptions(value);

  if (options === null) {
    return { ok: false, error: "Invalid load options." };
  }

  const runtime = buildRuntimeConfig();

  if (runtime.path === null || !runtime.exists) {
    return { ok: false, error: "Configure llama-server executable first." };
  }

  try {
    const payload = await localServerRequest("/api/ai/load", {
      method: "POST",
      body: JSON.stringify({
        runtimePath: runtime.path,
        modelPath: options.modelPath,
        nGpuLayers: options.nGpuLayers,
        contextSize: options.contextSize,
        rpcPeers: options.rpcPeers ?? [],
      }),
    });

    if (!isRecord(payload) || payload.ok !== true || !isAIState(payload.data)) {
      return { ok: false, error: "Unexpected AI load response." };
    }

    setLastModelPath(options.modelPath);
    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load model." };
  }
}

async function unloadAIModel(): Promise<AIUnloadResponse> {
  if (!mainServerProcess) {
    return { ok: false, error: "Server is not running." };
  }

  try {
    const payload = await localServerRequest("/api/ai/unload", { method: "POST" });

    if (!isRecord(payload) || payload.ok !== true || !isAIState(payload.data)) {
      return { ok: false, error: "Unexpected AI unload response." };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not unload model." };
  }
}

function getAIChatEndpoint(): AIChatEndpointResponse {
  if (!mainServerProcess || !mainServerState.token) {
    return { ok: false, error: "Start the server before using AI chat." };
  }

  return {
    ok: true,
    data: {
      url: `http://127.0.0.1:${mainServerState.port}/api/ai/chat`,
      token: mainServerState.token,
    },
  };
}

function startDownload(_event: IpcMainInvokeEvent, value: unknown): DownloadStartResponse {
  const request = parseDownloadStartRequest(value);

  if (request === null) {
    return { ok: false, error: "Invalid download request." };
  }

  if (downloads.has(request.id)) {
    return { ok: false, error: "Download id is already in use." };
  }

  const destinationDir = request.kind === "runtime" ? runtimeDir() : modelsDir();
  const destination = join(destinationDir, request.destinationName);

  const download: ActiveDownload = {
    id: request.id,
    kind: request.kind,
    url: request.url,
    destination,
    status: "active",
    receivedBytes: 0,
    totalBytes: null,
    message: null,
    controller: new AbortController(),
  };

  downloads.set(request.id, download);
  emitDownload(download);
  void performDownload(download, destinationDir);

  return { ok: true, data: downloadSnapshot(download) };
}

function cancelDownload(_event: IpcMainInvokeEvent, value: unknown): DownloadCancelResponse {
  if (typeof value !== "string") {
    return { ok: false, error: "Download id is required." };
  }

  const download = downloads.get(value);

  if (!download) {
    return { ok: false, error: "Download not found." };
  }

  download.controller.abort();
  return { ok: true };
}

function openExternal(_event: IpcMainInvokeEvent, value: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
    return { ok: false, error: "Only http(s) links are allowed." };
  }

  void shell.openExternal(value);
  return { ok: true };
}

function getLendState(): LendStateResponse {
  return { ok: true, data: currentLendState() };
}

async function startLending(_event: IpcMainInvokeEvent, value: unknown): Promise<LendStateResponse> {
  if (lendState.process !== null) {
    return { ok: true, data: currentLendState() };
  }

  if (!connectedServer) {
    return { ok: false, error: "Connect to a host first, then lend resources." };
  }

  const options = parseLendOptions(value);

  if (options === null) {
    return { ok: false, error: "Invalid lend options." };
  }

  const runtime = buildRuntimeConfig();

  if (runtime.path === null || !runtime.exists) {
    return { ok: false, error: "Configure llama-server first - rpc-server lives next to it." };
  }

  const executable = rpcServerExecutable(runtime.path);

  if (!existsSync(executable)) {
    return {
      ok: false,
      error: `rpc-server was not found next to llama-server. Expected at ${executable}.`,
    };
  }

  const memArgMb = options.vramMb > 0 ? options.vramMb : options.ramMb;
  const args: string[] = ["-H", "0.0.0.0", "-p", String(options.port)];

  if (memArgMb > 0) {
    args.push("-m", String(memArgMb));
  }

  let child: ChildProcessWithoutNullStreams;

  try {
    child = spawn(executable, args, { windowsHide: true });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not start rpc-server.",
    };
  }

  lendState.process = child;
  lendState.port = options.port;
  lendState.vramMb = options.vramMb;
  lendState.ramMb = options.ramMb;
  lendState.offerId = null;
  lendState.message = "rpc-server starting";
  lendState.log = [];
  lendState.rpcUrl = `${lanAddress()}:${options.port}`;

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim().length > 0) {
        appendLendLog(line.trim());
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim().length > 0) {
        appendLendLog(line.trim());
      }
    }
  });

  child.on("exit", (code: number | null) => {
    appendLendLog(`rpc-server exited with code ${code ?? "unknown"}`);

    if (lendState.process === child) {
      resetLendRuntime();
      lendState.message = `rpc-server stopped (exit ${code ?? "unknown"})`;
    }
  });

  child.on("error", (error: Error) => {
    appendLendLog(`rpc-server error: ${error.message}`);

    if (lendState.process === child) {
      resetLendRuntime();
      lendState.message = `rpc-server error: ${error.message}`;
    }
  });

  try {
    const offerResponse = await callConnectedServer("/api/pool/offer", {
      method: "POST",
      body: JSON.stringify({
        peerId: connectedServer.peerId,
        rpcUrl: lendState.rpcUrl,
        vramMb: options.vramMb,
        ramMb: options.ramMb,
      }),
    });

    if (!isRecord(offerResponse) || offerResponse.ok !== true || !isPoolOffer(offerResponse.data)) {
      throw new Error("Host rejected the pool offer.");
    }

    lendState.offerId = offerResponse.data.id;
    lendState.message = "Lending resources to host";
    return { ok: true, data: currentLendState() };
  } catch (error) {
    killLendProcess();
    resetLendRuntime();
    lendState.message = error instanceof Error ? error.message : "Could not register offer.";
    return { ok: false, error: lendState.message ?? "Could not register offer." };
  }
}

async function stopLending(): Promise<LendStateResponse> {
  const peerId = connectedServer?.peerId;
  killLendProcess();

  if (peerId) {
    try {
      await callConnectedServer("/api/pool/leave", {
        method: "POST",
        body: JSON.stringify({ peerId }),
      });
    } catch {
      lendState.message = "Stopped lending locally - host might still see a stale offer until heartbeat ages it out.";
    }
  }

  resetLendRuntime();

  if (lendState.message === null) {
    lendState.message = "Not lending";
  }

  return { ok: true, data: currentLendState() };
}

async function listPoolMembers(): Promise<PoolMembersResponse> {
  if (!mainServerProcess || !mainServerState.token) {
    return { ok: false, error: "Start the server before listing pool members." };
  }

  try {
    const payload = await localServerRequest("/api/pool/members");

    if (
      !isRecord(payload) ||
      payload.ok !== true ||
      !Array.isArray(payload.data) ||
      !payload.data.every(isPoolOffer)
    ) {
      return { ok: false, error: "Unexpected pool members response." };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not list pool members." };
  }
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: "Constellation",
    backgroundColor: "#f7f7f4",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void window.loadFile(join(__dirname, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle("chat:fetch", fetchChat);
  ipcMain.handle("chat:send", sendChat);
  ipcMain.handle("hardware:scan", scanHardware);
  ipcMain.handle("main-server:allow-firewall", allowFirewall);
  ipcMain.handle("main-server:clear-port", clearServerPort);
  ipcMain.handle("main-server:connect", connectToMainServer);
  ipcMain.handle("main-server:diagnose", diagnoseHost);
  ipcMain.handle("main-server:enable-zrok", enableZrok);
  ipcMain.handle("main-server:state", getMainServerState);
  ipcMain.handle("main-server:start", startMainServer);
  ipcMain.handle("main-server:start-tunnel", startZrokTunnel);
  ipcMain.handle("main-server:stop", stopMainServer);
  ipcMain.handle("main-server:stop-tunnel", stopZrokTunnel);
  ipcMain.handle("runtime:get", getRuntimeConfig);
  ipcMain.handle("runtime:pick", pickRuntime);
  ipcMain.handle("runtime:clear", clearRuntime);
  ipcMain.handle("models:list", listModels);
  ipcMain.handle("models:pick", pickModelFile);
  ipcMain.handle("models:remove", removeModelEntry);
  ipcMain.handle("models:select", selectModel);
  ipcMain.handle("ai:state", getAIState);
  ipcMain.handle("ai:load", loadAIModel);
  ipcMain.handle("ai:unload", unloadAIModel);
  ipcMain.handle("ai:chat-endpoint", getAIChatEndpoint);
  ipcMain.handle("downloads:start", startDownload);
  ipcMain.handle("downloads:cancel", cancelDownload);
  ipcMain.handle("shell:open-external", openExternal);
  ipcMain.handle("pool:lend-state", getLendState);
  ipcMain.handle("pool:lend-start", startLending);
  ipcMain.handle("pool:lend-stop", stopLending);
  ipcMain.handle("pool:members", listPoolMembers);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killLendProcess();
  resetLendRuntime();
  stopConnectedHeartbeat();
  connectedServer = null;
  cleanupMainServerProcesses();
});
