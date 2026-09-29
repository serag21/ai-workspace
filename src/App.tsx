import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, FolderPlus, Inbox, LayoutGrid, Pin, Search } from "lucide-react";
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

const lifecycleRank = { open: 0, discarded: 1, closed: 2 } as const;

function normalizeStoredSession(session: AISession): AISession {
  const lifecycle = session.lifecycle ?? (session.tabId === null ? "closed" : session.discarded ? "discarded" : "open");
  return {
    ...session,
    tabId: session.tabId ?? null,
    windowId: session.windowId ?? null,
    lifecycle,
    discarded: lifecycle === "discarded",
  };
}

export function App() {
  const [sessions, setSessions] = useState<AISession[]>([]);
  const [projects, setProjects] = useState<Project[]>(seedProjects);
  const [query, setQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState("inbox");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const discovered = await discoverOpenSessions();
      const saved = await chrome.storage.local.get(["sessions", "sessionAssignments", "pinnedSessions", "projects", "sessionMetadata"]);
      const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
      const pinned = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
      const savedProjects = (saved.projects ?? seedProjects) as Project[];
      const metadata = (saved.sessionMetadata ?? {}) as Record<string, string>;
      const storedSessions = ((saved.sessions ?? []) as AISession[]).map(normalizeStoredSession);
      const storedById = new Map(storedSessions.map((session) => [session.id, session]));
      const discoveredIds = new Set(discovered.map((session) => session.id));

      setProjects(savedProjects.length ? savedProjects : seedProjects);

      const liveSessions = discovered.map((session) => {
        const legacyId = `${session.provider}:${session.tabId}`;
        const previous = storedById.get(session.id) ?? storedById.get(legacyId);
        const cachedTitle = previous?.title ?? metadata[session.id] ?? metadata[legacyId];
        const isGenericTitle = /^(claude\.ai|chatgpt(\.com)?|gemini(\.google\.com)?|untitled conversation)$/i.test(session.title);
        const title = session.discarded && isGenericTitle && cachedTitle ? cachedTitle : session.title;
        const projectId = assignments[session.id] ?? assignments[legacyId] ?? previous?.projectId ?? "inbox";
        const isPinned = pinned[session.id] ?? pinned[legacyId] ?? previous?.pinned ?? false;

        if (!session.discarded && !isGenericTitle) {
          metadata[session.id] = session.title;
        }

        return { ...session, title, projectId, pinned: isPinned };
      });

      const closedSessions = storedSessions
        .filter((session) => !discoveredIds.has(session.id))
        .map((session) => ({
          ...session,
          tabId: null,
          windowId: null,
          lifecycle: "closed" as const,
          discarded: false,
        }));

      const merged = [...liveSessions, ...closedSessions];
      await chrome.storage.local.set({ sessions: merged, sessionMetadata: metadata });
      setSessions(merged);
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
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || lifecycleRank[a.lifecycle] - lifecycleRank[b.lifecycle] || b.lastSeen - a.lastSeen);
  }, [query, selectedProject, sessions]);

  const liveSessions = sessions.filter((session) => session.lifecycle !== "closed");
  const closedCount = sessions.length - liveSessions.length;
  const counts = {
    working: liveSessions.filter((session) => session.status === "working").length,
    needs: liveSessions.filter((session) => session.status === "needs-you").length,
    done: liveSessions.filter((session) => session.status === "done").length,
  };

  async function createProject() {
    const name = window.prompt("Project name");
    if (!name?.trim()) return;

    const project: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      color: "#8b5cf6",
    };

    const nextProjects = [...projects, project];
    setProjects(nextProjects);
    setSelectedProject(project.id);
    await chrome.storage.local.set({ projects: nextProjects });
  }

  async function moveSession(session: AISession, projectId: string) {
    const sessionAssignments = Object.fromEntries(sessions.map((item) => [item.id, item.projectId ?? "inbox"]));
    sessionAssignments[session.id] = projectId;
    await chrome.storage.local.set({ sessionAssignments });
    await refresh();
  }

  async function togglePin(session: AISession) {
    const pinnedSessions = Object.fromEntries(sessions.map((item) => [item.id, item.pinned]));
    pinnedSessions[session.id] = !session.pinned;
    await chrome.storage.local.set({ pinnedSessions });
    await refresh();
  }

  async function openSession(session: AISession) {
    await focusSession(session);
    await refresh();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">AI WORKSPACE</div>
          <h1>Your AI work</h1>
        </div>
        <button className="icon-button" title="Create project" onClick={() => void createProject()}>
          <FolderPlus size={18} />
        </button>
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
              <span className="count">{sessions.filter((session) => session.projectId === project.id).length}</span>
            </button>
          ))}
        </aside>

        <main className="sessions">
          <div className="sessions-header">
            <div>
              <h2>{projects.find((project) => project.id === selectedProject)?.name}</h2>
              <span>{liveSessions.length} live · {closedCount} closed · {sessions.length} total</span>
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
              {visible.map((session) => {
                const metaLabel = session.lifecycle === "closed" ? "Closed" : session.lifecycle === "discarded" ? "Not loaded" : statusMeta[session.status].label;
                return (
                  <article
                    key={session.id}
                    className={`session-card ${session.lifecycle === "closed" ? "closed-session" : ""}`}
                    onClick={() => void openSession(session)}
                    title={session.lifecycle === "closed" ? "Click to reopen this conversation" : session.lifecycle === "discarded" ? "This tab is unloaded from memory. Clicking it will load the tab." : session.title}
                  >
                    <div className={`provider-dot ${session.provider}`} />
                    <div className="session-main">
                      <div className="session-title">{session.title}</div>
                      <div className={`session-meta ${session.lifecycle}`}>{getProviderLabel(session.provider)} · {metaLabel}</div>
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
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: import("react").ReactNode; label: string; value: number }) {
  return <div className="stat"><div className="stat-icon">{icon}</div><div><strong>{value}</strong><span>{label}</span></div></div>;
}