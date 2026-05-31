export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) {
    return "Waiting";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatGpuMemory(memoryMb: number) {
  if (memoryMb >= 1024) {
    return `${(memoryMb / 1024).toFixed(1)} GB`;
  }

  return `${memoryMb} MB`;
}

export function formatVendor(vendor: string) {
  const lookup: Record<string, string> = {
    nvidia: "NVIDIA",
    amd: "AMD",
    intel: "Intel",
    apple: "Apple",
    unknown: "Unknown",
    none: "No dedicated GPU",
  };

  return lookup[vendor] ?? vendor;
}
