import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, Inbox, LayoutGrid, Pin, Search, Settings2 } from "lucide-react";
import { discoverOpenSessions, focusSession } from "./chrome";
import { getProviderLabel } from "./providers";
import type { AISession, Project, SessionStatus } from "./types";

const seedProjects: Project[] = [
  { id: "inbox", name: "Inbox", color: "#8b5cf6" },
];

const statusMeta: Record<SessionStatus, { label: string; icon: typeof Activity }> = {
  working: { label: "Working", icon: Activity },
  "needs-you": { label: "Needs you", icon: CircleAlert },
  done: { label: "Done", icon: CheckCircle2 },
  idle: { label: "Idle", icon: Activity },
};

export function App() {
  const [sessions, setSessions] = useState<AISession[]>([]);
  const [projects] = useState<Project[]>(seedProjects);
  const [query, setQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState("inbox");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const discovered = await discoverOpenSessions();
      const saved = await chrome.storage.local.get(["sessionAssignments", "pinnedSessions"]);
      const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
      const pinned = (saved.pinnedSessions ?? {}) as Record<string, boolean>;

      setSessions(
        discovered.map((session) => ({
          ...session,
          projectId: assignments[session.id] ?? "inbox",
          pinned: Boolean(pinned[session.id]),
        }))
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(listener);
    return () => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(listener);
    };
  }, []);

  const visible = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    return sessions
      .filter((session) => session.projectId === selectedProject)
      .filter((session) => !normalized || session.title.toLowerCase().includes(normalized) || getProviderLabel(session.provider).toLowerCase().includes(normalized))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastSeen - a.lastSeen);
  }, [query, selectedProject, sessions]);

  const counts = {
    working: sessions.filter((s) => s.status === "working").length,
    needs: sessions.filter((s) => s.status === "needs-you").length,
    done: sessions.filter((s) => s.status === "done").length,
  };

  async function togglePin(session: AISession) {
    const pinnedSessions = Object.fromEntries(sessions.map((s) => [s.id, s.pinned]));
    pinnedSessions[session.id] = !session.pinned;
    await chrome.storage.local.set({ pinnedSessions });
    await refresh();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">AI WORKSPACE</div>
          <h1>Your AI work</h1>
        </div>
        <button className="icon-button" title="Settings"><Settings2 size={18} /></button>
      </header>

      <section className="attention">
        <div className="attention-header">
          <div>
            <span className="section-kicker">Attention</span>
            <p>See what needs you without opening every tab.</p>
          </div>
          <span className="live-dot" />
        </div>
        <div className="attention-grid">
          <Stat icon={<CircleAlert size={16} />} label="Needs you" value={counts.needs} />
          <Stat icon={<Activity size={16} />} label="Working" value={counts.working} />
          <Stat icon={<CheckCircle2 size={16} />} label="Done" value={counts.done} />
        </div>
      </section>

      <div className="search">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" />
      </div>

      <div className="layout">
        <aside className="sidebar">
          <div className="side-heading">Projects</div>
          {projects.map((project) => (
            <button key={project.id} className={`project-row ${selectedProject === project.id ? "selected" : ""}`} onClick={() => setSelectedProject(project.id)}>
              {project.id === "inbox" ? <Inbox size={16} /> : <LayoutGrid size={16} />}
              <span>{project.name}</span>
              <span className="count">{sessions.filter((s) => s.projectId === project.id).length}</span>
            </button>
          ))}
        </aside>

        <main className="sessions">
          <div className="sessions-header">
            <div>
              <h2>{projects.find((p) => p.id === selectedProject)?.name}</h2>
              <span>{sessions.length} open AI conversations discovered</span>
            </div>
            <button className="refresh" onClick={() => void refresh()}>{loading ? "Scanning…" : "Rescan"}</button>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><Inbox size={22} /></div>
              <h3>{loading ? "Scanning your browser…" : "Nothing here yet"}</h3>
              <p>Open a ChatGPT, Claude, or Gemini conversation and it will appear here automatically.</p>
            </div>
          ) : (
            <div className="session-list">
              {visible.map((session) => (
                <article key={session.id} className="session-card" onClick={() => void focusSession(session)}>
                  <div className={`provider-dot ${session.provider}`} />
                  <div className="session-main">
                    <div className="session-title">{session.title}</div>
                    <div className="session-meta">{getProviderLabel(session.provider)} · {statusMeta[session.status].label}</div>
                  </div>
                  <div className="session-actions" onClick={(event) => event.stopPropagation()}>
                    <select className="move-select" aria-label="Move to project" value={session.projectId ?? "inbox"} onChange={(event) => void moveSession(session, event.target.value)}>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                    <button className={`pin ${session.pinned ? "active" : ""}`} onClick={() => void togglePin(session)} title="Pin">
                      <Pin size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="stat"><div className="stat-icon">{icon}</div><div><strong>{value}</strong><span>{label}</span></div></div>;
}