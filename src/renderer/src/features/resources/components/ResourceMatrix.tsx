import { resourceChannels } from "../resourceData";

export function ResourceMatrix() {
  return (
    <section className="feature-card resource-panel" aria-labelledby="channels-heading">
      <div className="section-heading">
        <h2 id="channels-heading">Resource channels</h2>
        <span>{resourceChannels.length} planned</span>
      </div>
      <div className="resource-table">
        {resourceChannels.map((resource) => (
          <div className="resource-row" key={resource.name}>
            <div>
              <strong>{resource.name}</strong>
              <p>{resource.description}</p>
            </div>
            <span>{resource.capacity}</span>
            <span>{resource.state}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
