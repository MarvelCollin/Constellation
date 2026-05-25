import { useEffect, useState } from "react";
import type {
  ChatSnapshot,
  ChatTarget,
  ConnectMainServerRequest,
  ConnectedServerState,
  HardwareSnapshot,
  HostDiagnostics,
  MainServerState,
  StartMainServerOptions,
} from "../../../../shared/hardware";
import { ChatPanel } from "./components/ChatPanel";
import { ConnectServerPanel } from "./components/ConnectServerPanel";
import { HardwareScanner } from "./components/HardwareScanner";
import { MainServerPanel } from "./components/MainServerPanel";
import { ResourceMatrix } from "./components/ResourceMatrix";

type ScanStatus = "idle" | "scanning" | "ready" | "error";
type NodeMode = "host" | "connect";

export function ResourceOverview() {
  const [mode, setMode] = useState<NodeMode>("host");
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [serverState, setServerState] = useState<MainServerState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [firewallAllowed, setFirewallAllowed] = useState(false);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [firewallMessage, setFirewallMessage] = useState("Windows permission can allow inbound TCP port 8765.");
  const [diagnostics, setDiagnostics] = useState<HostDiagnostics | null>(null);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [portCleanupBusy, setPortCleanupBusy] = useState(false);
  const [portCleanupMessage, setPortCleanupMessage] = useState("Force clear only stale Constellation server on port 8765.");
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [zrokBusy, setZrokBusy] = useState(false);
  const [zrokMessage, setZrokMessage] = useState("Enable zrok from ZROK_TOKEN in .env.");
  const [connectedServer, setConnectedServer] = useState<ConnectedServerState | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [chatByTarget, setChatByTarget] = useState<Record<ChatTarget, ChatSnapshot | null>>({
    host: null,
    connected: null,
  });
  const [chatErrorByTarget, setChatErrorByTarget] = useState<Record<ChatTarget, string | null>>({
    host: null,
    connected: null,
  });
  const [chatBusyByTarget, setChatBusyByTarget] = useState<Record<ChatTarget, boolean>>({
    host: false,
    connected: false,
  });

  useEffect(() => {
    if (!window.constellation?.getMainServerState) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    void window.constellation.getMainServerState().then((response) => {
      if (response.ok) {
        setServerState(response.data);
        void refreshFirewallState();
        return;
      }

      setServerError(response.error);
    });
  }, []);

  useEffect(() => {
    const target = mode === "host" ? (serverState?.running ? "host" : null) : connectedServer ? "connected" : null;

    if (!target) {
      return;
    }

    void refreshChat(target);

    const interval = window.setInterval(() => {
      void refreshChat(target);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [mode, serverState?.running, connectedServer?.url]);

  async function handleScan() {
    if (!window.constellation?.scanHardware) {
      setStatus("error");
      setError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setStatus("scanning");
    setError(null);

    try {
      const response = await window.constellation.scanHardware();

      if (!response.ok) {
        setStatus("error");
        setError(response.error);
        return;
      }

      setSnapshot(response.data);
      setStatus("ready");
    } catch (scanError) {
      setStatus("error");
      setError(scanError instanceof Error ? scanError.message : "Hardware scan failed.");
    }
  }

  async function handleStartServer(options: StartMainServerOptions) {
    if (!window.constellation?.startMainServer) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setServerBusy(true);
    setServerError(null);

    try {
      const response = await window.constellation.startMainServer(options);

      if (!response.ok) {
        setServerError(response.error);
        return;
      }

      setServerState(response.data);
      void handleDiagnoseHost();
    } finally {
      setServerBusy(false);
    }
  }

  async function handleStopServer() {
    if (!window.constellation?.stopMainServer) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setServerBusy(true);
    setServerError(null);

    try {
      const response = await window.constellation.stopMainServer();

      if (!response.ok) {
        setServerError(response.error);
        return;
      }

      setServerState(response.data);
      setDiagnostics(null);
    } finally {
      setServerBusy(false);
    }
  }

  async function handleDiagnoseHost() {
    if (!window.constellation?.diagnoseHost) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setDiagnosticBusy(true);
    setServerError(null);

    try {
      const response = await window.constellation.diagnoseHost();

      if (!response.ok) {
        setServerError(response.error);
        return;
      }

      setDiagnostics(response.data);
      applyFirewallState(response.data);
    } finally {
      setDiagnosticBusy(false);
    }
  }

  async function refreshFirewallState() {
    if (!window.constellation?.diagnoseHost) {
      return;
    }

    try {
      const response = await window.constellation.diagnoseHost();

      if (response.ok) {
        applyFirewallState(response.data);
      }
    } catch {
      return;
    }
  }

  function applyFirewallState(value: HostDiagnostics) {
    const firewall = value.checks.find((check) => check.label === "Windows firewall");

    if (firewall?.status === "ok") {
      setFirewallAllowed(true);
      setFirewallMessage(`Firewall rule is already active. ${firewall.value}`);
      return;
    }

    setFirewallAllowed(false);
    setFirewallMessage(firewall?.value ?? "Windows permission can allow inbound TCP port 8765.");
  }

  async function handleAllowFirewall() {
    if (!window.constellation?.allowFirewall) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setFirewallBusy(true);
    setFirewallAllowed(false);
    setServerError(null);
    setFirewallMessage("Waiting for the Windows permission prompt.");

    try {
      const response = await window.constellation.allowFirewall();

      if (!response.ok) {
        setServerError(response.error);
        return;
      }

      setFirewallAllowed(true);
      setFirewallMessage(response.message);
      await handleDiagnoseHost();
    } finally {
      setFirewallBusy(false);
    }
  }

  async function handleClearPort() {
    if (!window.constellation?.clearServerPort) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setPortCleanupBusy(true);
    setServerError(null);
    setPortCleanupMessage("Checking and clearing stale port 8765 server.");

    try {
      const response = await window.constellation.clearServerPort();

      if (!response.ok) {
        setPortCleanupMessage(response.error);
        setServerError(response.error);
        return;
      }

      setServerState(null);
      setPortCleanupMessage(response.message);
      await handleDiagnoseHost();
    } finally {
      setPortCleanupBusy(false);
    }
  }

  async function handleEnableZrok() {
    if (!window.constellation?.enableZrok) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setZrokBusy(true);
    setServerError(null);
    setZrokMessage("Enabling zrok on this machine.");

    try {
      const response = await window.constellation.enableZrok();

      if (!response.ok) {
        setZrokMessage(response.error);
        setServerError(response.error);
        return;
      }

      setZrokMessage(response.message);
    } finally {
      setZrokBusy(false);
    }
  }

  async function handleStartTunnel() {
    if (!window.constellation?.startZrokTunnel) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setTunnelBusy(true);
    setServerError(null);

    try {
      const response = await window.constellation.startZrokTunnel();

      if (!response.ok) {
        setServerError(response.error);
        return;
      }

      setServerState(response.data);
      await handleDiagnoseHost();
    } finally {
      setTunnelBusy(false);
    }
  }

  async function handleStartSharing() {
    if (!window.constellation?.enableZrok || !window.constellation?.startMainServer || !window.constellation?.startZrokTunnel) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setServerBusy(true);
    setZrokBusy(true);
    setTunnelBusy(true);
    setServerError(null);
    setZrokMessage("Preparing zrok tunnel.");

    try {
      const zrokResponse = await window.constellation.enableZrok();

      if (!zrokResponse.ok) {
        setZrokMessage(zrokResponse.error);
        setServerError(zrokResponse.error);
        return;
      }

      setZrokMessage(zrokResponse.message);

      const serverResponse = await window.constellation.startMainServer({ exposure: "internet" });

      if (!serverResponse.ok) {
        setServerError(serverResponse.error);
        return;
      }

      setServerState(serverResponse.data);

      const tunnelResponse = await window.constellation.startZrokTunnel();

      if (!tunnelResponse.ok) {
        setServerError(tunnelResponse.error);
        return;
      }

      setServerState(tunnelResponse.data);
      await handleDiagnoseHost();
    } finally {
      setServerBusy(false);
      setZrokBusy(false);
      setTunnelBusy(false);
    }
  }

  async function handleStopTunnel() {
    if (!window.constellation?.stopZrokTunnel) {
      setServerError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setTunnelBusy(true);
    setServerError(null);

    try {
      const response = await window.constellation.stopZrokTunnel();

      if (!response.ok) {
        setServerError(response.error);
        return;
      }

      setServerState(response.data);
      await handleDiagnoseHost();
    } finally {
      setTunnelBusy(false);
    }
  }

  async function handleConnectServer(request: ConnectMainServerRequest) {
    if (!window.constellation?.connectToMainServer) {
      setConnectError("Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.");
      return;
    }

    setConnectBusy(true);
    setConnectError(null);

    try {
      const response = await window.constellation.connectToMainServer(request);

      if (!response.ok) {
        setConnectError(response.error);
        return;
      }

      setConnectedServer(response.data);
    } finally {
      setConnectBusy(false);
    }
  }

  async function refreshChat(target: ChatTarget) {
    if (!window.constellation?.fetchChat) {
      setChatErrorByTarget((current) => ({
        ...current,
        [target]: "Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.",
      }));
      return;
    }

    setChatBusyByTarget((current) => ({ ...current, [target]: true }));

    try {
      const response = await window.constellation.fetchChat({ target });

      if (!response.ok) {
        setChatErrorByTarget((current) => ({ ...current, [target]: response.error }));
        return;
      }

      setChatByTarget((current) => ({ ...current, [target]: response.data }));
      setChatErrorByTarget((current) => ({ ...current, [target]: null }));
    } finally {
      setChatBusyByTarget((current) => ({ ...current, [target]: false }));
    }
  }

  async function handleSendChat(target: ChatTarget, body: string) {
    if (!window.constellation?.sendChat) {
      setChatErrorByTarget((current) => ({
        ...current,
        [target]: "Desktop bridge is unavailable. Open the Electron app window, not the Vite localhost page.",
      }));
      return;
    }

    setChatBusyByTarget((current) => ({ ...current, [target]: true }));

    try {
      const response = await window.constellation.sendChat({ target, body });

      if (!response.ok) {
        setChatErrorByTarget((current) => ({ ...current, [target]: response.error }));
        return;
      }

      setChatByTarget((current) => ({ ...current, [target]: response.data }));
      setChatErrorByTarget((current) => ({ ...current, [target]: null }));
    } finally {
      setChatBusyByTarget((current) => ({ ...current, [target]: false }));
    }
  }

  return (
    <section className="resource-page">
      <HardwareScanner error={error} onScan={handleScan} snapshot={snapshot} status={status} />
      <div className="mode-switch" role="tablist" aria-label="Node mode">
        <button
          aria-selected={mode === "host"}
          className={mode === "host" ? "mode-button active" : "mode-button"}
          onClick={() => setMode("host")}
          role="tab"
          type="button"
        >
          Start a server
        </button>
        <button
          aria-selected={mode === "connect"}
          className={mode === "connect" ? "mode-button active" : "mode-button"}
          onClick={() => setMode("connect")}
          role="tab"
          type="button"
        >
          Connect a server
        </button>
      </div>
      {mode === "host" ? (
        <>
          <MainServerPanel
            busy={serverBusy}
            diagnosticBusy={diagnosticBusy}
            diagnostics={diagnostics}
            error={serverError}
            firewallMessage={firewallMessage}
            portCleanupBusy={portCleanupBusy}
            portCleanupMessage={portCleanupMessage}
            tunnelBusy={tunnelBusy}
            zrokBusy={zrokBusy}
            zrokMessage={zrokMessage}
            onClearPort={handleClearPort}
            onDiagnose={handleDiagnoseHost}
            onStartSharing={handleStartSharing}
            onStop={handleStopServer}
            state={serverState}
          />
          <ChatPanel
            busy={chatBusyByTarget.host}
            disabled={!serverState?.running}
            error={chatErrorByTarget.host}
            onRefresh={() => refreshChat("host")}
            onSend={(body) => handleSendChat("host", body)}
            snapshot={chatByTarget.host}
            title="Server chat"
          />
        </>
      ) : (
        <>
          <ConnectServerPanel
            busy={connectBusy}
            connection={connectedServer}
            error={connectError}
            onConnect={handleConnectServer}
          />
          <ChatPanel
            busy={chatBusyByTarget.connected}
            disabled={!connectedServer}
            error={chatErrorByTarget.connected}
            onRefresh={() => refreshChat("connected")}
            onSend={(body) => handleSendChat("connected", body)}
            snapshot={chatByTarget.connected}
            title="Joined server chat"
          />
        </>
      )}
      <ResourceMatrix snapshot={snapshot} status={status} />
    </section>
  );
}
