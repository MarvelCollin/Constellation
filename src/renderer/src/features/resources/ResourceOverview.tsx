import { useState } from "react";
import type { HardwareSnapshot } from "../../../../shared/hardware";
import { HardwareScanner } from "./components/HardwareScanner";
import { ResourceMatrix } from "./components/ResourceMatrix";

type ScanStatus = "idle" | "scanning" | "ready" | "error";

export function ResourceOverview() {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleScan() {
    if (!window.constellation?.scanHardware) {
      setStatus("error");
      setError("Hardware scan bridge is unavailable.");
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

  return (
    <section className="resource-page">
      <HardwareScanner error={error} onScan={handleScan} snapshot={snapshot} status={status} />
      <ResourceMatrix snapshot={snapshot} status={status} />
    </section>
  );
}
