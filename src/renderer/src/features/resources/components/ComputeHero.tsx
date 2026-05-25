export function ComputeHero() {
  return (
    <section className="hero-band" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <h1 id="hero-heading">Share local compute without losing control.</h1>
        <p>
          Constellation prepares this desktop to contribute RAM, GPU, storage, and network capacity
          to AI training and hosting workloads with owner-defined limits.
        </p>
        <div className="hero-actions">
          <button className="button-download" type="button">
            Start hardware scan
          </button>
          <button className="button-tertiary" type="button">
            View allocation policy
          </button>
        </div>
      </div>
      <div className="ide-mockup-card" aria-label="Constellation node setup preview">
        <div className="ide-sidebar">
          <span>node.config</span>
          <span>gpu.queue</span>
          <span>ram.policy</span>
          <span>host.routes</span>
        </div>
        <div className="ide-editor">
          <div className="code-line">
            <span>01</span>
            <code>node.name = "local-workstation"</code>
          </div>
          <div className="code-line">
            <span>02</span>
            <code>gpu.share = pending_scan</code>
          </div>
          <div className="code-line">
            <span>03</span>
            <code>ram.reserve = owner_defined</code>
          </div>
          <div className="code-line">
            <span>04</span>
            <code>hosting.mode = approval_required</code>
          </div>
        </div>
        <div className="ide-panel">
          <strong>Probe queue</strong>
          <p>Python worker ready. Electron bridge pending.</p>
          <span>0 workloads running</span>
        </div>
      </div>
    </section>
  );
}
