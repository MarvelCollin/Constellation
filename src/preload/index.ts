import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("constellation", {
  platform: process.platform,
});
