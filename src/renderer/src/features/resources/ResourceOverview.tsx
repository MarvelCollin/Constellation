import { AgentTimeline } from "./components/AgentTimeline";
import { ComputeHero } from "./components/ComputeHero";
import { ResourceMatrix } from "./components/ResourceMatrix";
import { SetupPath } from "./components/SetupPath";

export function ResourceOverview() {
  return (
    <section className="resource-page">
      <ComputeHero />
      <div className="resource-grid">
        <ResourceMatrix />
        <SetupPath />
      </div>
      <AgentTimeline />
    </section>
  );
}
