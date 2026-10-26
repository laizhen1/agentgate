import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  FlaskConical,
  GitBranch,
  ShieldCheck,
} from "lucide-react";

export function WorkspaceShell({
  active,
  children,
}: {
  active: "live" | "reference";
  children: React.ReactNode;
}) {
  return (
    <div className="console-shell">
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <aside className="console-sidebar" aria-label="Workspace navigation">
        <Link
          className="console-logo"
          href="/platform"
          aria-label="AgentGate live workspace"
        >
          <span className="console-logo-mark">
            <ShieldCheck size={22} />
          </span>
          <span>
            AgentGate<small>AGENT EVALUATION</small>
          </span>
        </Link>
        <div className="sidebar-section-label">Workspace</div>
        <nav className="console-navigation" aria-label="Main navigation">
          <Link
            href="/platform"
            aria-current={active === "live" ? "page" : undefined}
          >
            <Activity size={18} />
            <span>Live workspace</span>
          </Link>
          <Link
            href="/"
            aria-current={active === "reference" ? "page" : undefined}
          >
            <FlaskConical size={18} />
            <span>Reference lab</span>
          </Link>
        </nav>
        <div className="sidebar-resources">
          <div className="sidebar-section-label">Resources</div>
          <nav className="console-navigation" aria-label="Project resources">
            <a
              href="https://github.com/laizhen1/agentgate/blob/main/experiments/agent-pilot-v1/REPORT.md"
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen size={17} />
              <span>Pilot report</span>
              <ArrowUpRight size={14} />
            </a>
            <a
              href="https://github.com/laizhen1/agentgate"
              target="_blank"
              rel="noreferrer"
            >
              <GitBranch size={17} />
              <span>Source & docs</span>
              <ArrowUpRight size={14} />
            </a>
          </nav>
        </div>
        <div className="sidebar-footer">
          <span className="sidebar-environment">
            <span />
            Sandbox environment
          </span>
          <p>
            Inspect decisions.
            <br />
            Verify outcomes.
          </p>
          <small>AgentGate / V1.5</small>
        </div>
      </aside>
      <main
        id="workspace-content"
        className={
          "workspace " +
          (active === "live" ? "platform" : "reference-workspace")
        }
      >
        {children}
      </main>
    </div>
  );
}
