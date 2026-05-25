export {};

import type { HardwareScanResponse } from "../../shared/hardware";

declare global {
  interface Window {
    constellation?: {
      platform: string;
      scanHardware: () => Promise<HardwareScanResponse>;
    };
  }
}
