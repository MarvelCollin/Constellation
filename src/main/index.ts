import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { HardwareScanResponse, HardwareSnapshot } from "../shared/hardware";

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

function scanHardware(): Promise<HardwareScanResponse> {
  const pythonCommand = process.platform === "win32" ? "python" : "python3";
  const workerPath = app.isPackaged ? join(process.resourcesPath, "python") : join(process.cwd(), "python");

  return new Promise((resolve) => {
    const child = spawn(pythonCommand, ["-m", "constellation_worker"], {
      cwd: workerPath,
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
      resolve({ ok: false, error: error.message });
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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: "Constellation",
    backgroundColor: "#101114",
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
  ipcMain.handle("hardware:scan", scanHardware);
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
