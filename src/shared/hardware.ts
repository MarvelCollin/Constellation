export type GpuInfo = {
  name: string;
  memory_mb: number;
  driver: string;
};

export type HardwareSnapshot = {
  platform: string;
  python_version: string;
  cpu_count: number | null;
  memory_bytes: number | null;
  storage_bytes: number | null;
  storage_free_bytes: number | null;
  gpus: GpuInfo[];
};

export type HardwareScanResponse =
  | {
      ok: true;
      data: HardwareSnapshot;
    }
  | {
      ok: false;
      error: string;
    };
