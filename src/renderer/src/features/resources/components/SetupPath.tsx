import { setupSteps } from "../resourceData";

export function SetupPath() {
  return (
    <section className="feature-card setup-panel" aria-labelledby="setup-heading">
      <div className="section-heading">
        <h2 id="setup-heading">Setup path</h2>
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
  );
}
