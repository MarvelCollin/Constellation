import type { HardwareSnapshot } from "../../../../../shared/hardware";
import { formatBytes } from "../formatHardware";
import { resourceChannels } from "../resourceData";

type ResourceMatrixProps = {
  snapshot: HardwareSnapshot | null;
  status: "idle" | "scanning" | "ready" | "error";
};

function capacityFor(name: string, snapshot: HardwareSnapshot | null) {
  if (!snapshot) {
    return "Waiting";
  }

  if (name === "CPU") {
    return snapshot.cpu_count ? `${snapshot.cpu_count} cores` : "Unavailable";
  }

  if (name === "RAM") {
    return formatBytes(snapshot.memory_bytes);
  }

  if (name === "GPU") {
    return snapshot.gpus.length ? `${snapshot.gpus.length} detected` : "Unavailable";
  }

  return formatBytes(snapshot.storage_bytes);
}

function stateFor(name: string, snapshot: HardwareSnapshot | null, status: ResourceMatrixProps["status"]) {
  if (status === "scanning") {
    return "Scanning";
  }

  if (status === "error") {
    return "Blocked";
  }

  if (!snapshot) {
    return "Waiting";
  }

  if (name === "GPU" && snapshot.gpus.length === 0) {
    return "Missing";
  }

  return "Ready";
}

export function ResourceMatrix({ snapshot, status }: ResourceMatrixProps) {
  return (
    <section className="feature-card resource-panel" aria-labelledby="channels-heading">
      <div className="section-heading">
        <h2 id="channels-heading">Resource channels</h2>
        <span>{status === "ready" ? "Scanned" : `${resourceChannels.length} checks`}</span>
      </div>
      <div className="resource-table">
        {resourceChannels.map((resource) => (
          <div className="resource-row" key={resource.name}>
            <div>
              <strong>{resource.name}</strong>
              <p>{resource.description}</p>
            </div>
            <span>{capacityFor(resource.name, snapshot)}</span>
            <span>{stateFor(resource.name, snapshot, status)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
