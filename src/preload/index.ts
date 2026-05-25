import { contextBridge, ipcRenderer } from "electron";
import type { HardwareScanResponse } from "../shared/hardware";

contextBridge.exposeInMainWorld("constellation", {
  platform: process.platform,
  scanHardware: (): Promise<HardwareScanResponse> => ipcRenderer.invoke("hardware:scan"),
});
