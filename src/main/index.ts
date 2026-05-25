import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import type { IpcMainInvokeEvent } from "electron";
import { connect as connectSocket } from "node:net";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
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

let mainServerProcess: ChildProcessWithoutNullStreams | null = null;
let zrokTunnelProcess: ChildProcessWithoutNullStreams | null = null;
let connectedServer: { url: string; token: string; peerName: string } | null = null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGpuInfo(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.memory_mb === "number" &&
    typeof value.driver === "string"
  );
}

function isHardwareSnapshot(value: unknown): value is HardwareSnapshot {
  return (
    isRecord(value) &&
    typeof value.platform === "string" &&
    typeof value.python_version === "string" &&
    (typeof value.cpu_count === "number" || value.cpu_count === null) &&
    (typeof value.memory_bytes === "number" || value.memory_bytes === null) &&
    (typeof value.storage_bytes === "number" || value.storage_bytes === null) &&
    (typeof value.storage_free_bytes === "number" || value.storage_free_bytes === null) &&
    Array.isArray(value.gpus) &&
    value.gpus.every(isGpuInfo)
  );
}

function isChatPeer(value: unknown): value is ChatPeer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.lastSeen === "string"
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

async function registerPeer(url: string, token: string, name: string): Promise<void> {
  await serverJsonRequest(url, token, "/api/peers", {
    body: JSON.stringify({ name }),
    method: "POST",
  });
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

function enableZrok(_event: IpcMainInvokeEvent, value: unknown): Promise<ZrokEnableResponse> {
  if (!isRecord(value) || typeof value.token !== "string" || value.token.trim().length < 8) {
    return Promise.resolve({ ok: false, error: "Enter a valid zrok account token." });
  }

  const token = value.token.trim();

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
        resolve({ ok: false, error: output.trim() || `zrok enable exited with code ${code}` });
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
      const match = output.match(/https:\/\/[^\s"']+/i);

      if (!match) {
        return;
      }

      zrokTunnelProcess = child;
      mainServerState = {
        ...mainServerState,
        tunnelRunning: true,
        tunnelUrl: match[0],
        tunnelPid: child.pid ?? null,
        tunnelNote: "zrok public share is active. Share this URL plus the join secret.",
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
        .then(() => finish({ ok: true, data: currentMainServerState() }))
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

    connectedServer = { url: request.url, token: request.token, peerName: nodeName() };
    await registerPeer(request.url, request.token, connectedServer.peerName);

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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
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
  cleanupMainServerProcesses();
});
