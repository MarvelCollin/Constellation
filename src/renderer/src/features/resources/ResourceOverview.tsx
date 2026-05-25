import { resourceChannels, setupSteps } from "./resourceData";

export function ResourceOverview() {
  return (
    <section className="resource-page" aria-labelledby="resource-heading">
      <div className="resource-intro">
        <div>
          <h2 id="resource-heading">Node setup foundation</h2>
          <p>
            This first desktop shell keeps hardware discovery, allocation rules, and future AI
            hosting workflows separated from the Electron runtime.
          </p>
        </div>
      </div>
      <div className="resource-grid">
        <section className="resource-panel" aria-labelledby="channels-heading">
          <div className="section-heading">
            <h3 id="channels-heading">Resource channels</h3>
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
        <section className="resource-panel" aria-labelledby="setup-heading">
          <div className="section-heading">
            <h3 id="setup-heading">Setup path</h3>
            <span>Next</span>
          </div>
          <ol className="setup-list">
            {setupSteps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}
