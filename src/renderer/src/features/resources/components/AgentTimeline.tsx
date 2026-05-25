import { timelineActions } from "../resourceData";

export function AgentTimeline() {
  return (
    <section className="feature-card timeline-card" aria-labelledby="timeline-heading">
      <div className="section-heading">
        <h2 id="timeline-heading">Agent setup timeline</h2>
        <span>Local only</span>
      </div>
      <div className="timeline-list">
        {timelineActions.map((action) => (
          <article className="timeline-item" key={action.title}>
            <span className={`timeline-pill timeline-pill-${action.tone}`}>{action.label}</span>
            <div>
              <strong>{action.title}</strong>
              <p>{action.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
