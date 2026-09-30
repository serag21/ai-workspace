import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, FolderPlus, Inbox, LayoutGrid, Pin, Search } from "lucide-react";
import { discoverOpenSessions, focusSession } from "./chrome";
import { getProviderLabel } from "./providers";
import type { AISession, Project, SessionStatus } from "./types";

const seedProjects: Project[] = [{ id: "inbox", name: "Inbox", color: "#8b5cf6" }];

const statusMeta: Record<SessionStatus, { label: string; icon: typeof Activity }> = {
  working: { label: "Working", icon: Activity },
  "needs-you": { label: "Needs you", icon: CircleAlert },
  done: { label: "Done", icon: CheckCircle2 },
  idle: { label: "Idle", icon: Activity },
};

const lifecycleRank = { open: 0, discarded: 1, closed: 2 } as const;
const statusRank: Record<SessionStatus, number> = { "needs-you": 0, working: 1, done: 2, idle: 3 };
type ViewFilter = "all" | "open" | "discarded" | "closed";

function normalizeStoredSession(session: AISession): AISession {
  const lifecycle = session.lifecycle ?? (session.tabId === null ? "closed" : session.discarded ? "discarded" : "open");
  return { ...session, tabId: session.tabId ?? null, windowId: session.windowId ?? null, lifecycle, discarded: lifecycle === "discarded" };
}

function sessionSignature(sessions: AISession[]) {
  return JSON.stringify(sessions.map((session) => [
    session.id, session.title, session.url, session.tabId, session.windowId, session.status,
    session.lifecycle, session.projectId, session.pinned, session.lastSeen,
  ]));
}

export function App() {
  const [sessions, setSessions] = useState<AISession[]>([]);
  const [projects, setProjects] = useState<Project[]>(seedProjects);
  const [query, setQuery] = useState("");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [selectedProject, setSelectedProject] = useState("inbox");
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<number | null>(null);
  const refreshGeneration = useRef(0);

  async function refresh() {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const discovered = await discoverOpenSessions();
      const saved = await chrome.storage.local.get(["sessions", "sessionAssignments", "pinnedSessions", "projects", "sessionMetadata"]);
      if (generation !== refreshGeneration.current) return;

      const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
      const pinned = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
      const savedProjects = (saved.projects ?? seedProjects) as Project[];
      const metadata = (saved.sessionMetadata ?? {}) as Record<string, string>;
      const storedSessions = ((saved.sessions ?? []) as AISession[]).map(normalizeStoredSession);
      const storedById = new Map(storedSessions.map((session) => [session.id, session]));
      const matchedStoredIds = new Set<string>();
      setProjects(savedProjects.length ? savedProjects : seedProjects);

      const liveSessions = discovered.map((session) => {
        const legacyId = `${session.provider}:${session.tabId}`;
        const previous = storedById.get(session.id) ?? storedById.get(legacyId);
        if (previous) matchedStoredIds.add(previous.id);
        const cachedTitle = previous?.title ?? metadata[session.id] ?? metadata[legacyId];
        const isGenericTitle = /^(claude\.ai|chatgpt(\.com)?|gemini(\.google\.com)?|untitled conversation)$/i.test(session.title);
        const title = session.discarded && isGenericTitle && cachedTitle ? cachedTitle : session.title;
        const projectId = assignments[session.id] ?? assignments[legacyId] ?? previous?.projectId ?? "inbox";
        const isPinned = pinned[session.id] ?? pinned[legacyId] ?? previous?.pinned ?? false;
        if (!session.discarded && !isGenericTitle) metadata[session.id] = session.title;
        return { ...session, title, projectId, pinned: isPinned, lastSeen: previous?.lastSeen ?? session.lastSeen };
      });

      const closedSessions = storedSessions
        .filter((session) => !matchedStoredIds.has(session.id))
        .map((session) => ({ ...session, tabId: null, windowId: null, lifecycle: "closed" as const, discarded: false }));

      const merged = [...liveSessions, ...closedSessions];
      await chrome.storage.local.set({ sessions: merged, sessionMetadata: metadata });
      setSessions((current) => sessionSignature(current) === sessionSignature(merged) ? current : merged);
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void refresh(); }, 250);
  }

  useEffect(() => {
    void refresh();
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url !== undefined || changeInfo.status !== undefined || changeInfo.title !== undefined || changeInfo.discarded !== undefined) scheduleRefresh();
    };
    const onCreated = () => scheduleRefresh();
    const onRemoved = () => scheduleRefresh();
    const onActivated = () => scheduleRefresh();
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onActivated.addListener(onActivated);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onActivated.removeListener(onActivated);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return sessions
      .filter((session) => session.projectId === selectedProject)
      .filter((session) => viewFilter === "all" || session.lifecycle === viewFilter)
      .filter((session) => !normalized || session.title.toLocaleLowerCase().includes(normalized) || getProviderLabel(session.provider).toLocaleLowerCase().includes(normalized))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || statusRank[a.status] - statusRank[b.status] || lifecycleRank[a.lifecycle] - lifecycleRank[b.lifecycle] || a.title.localeCompare(b.title));
  }, [query, selectedProject, sessions, viewFilter]);

  const projectSessions = sessions.filter((session) => session.projectId === selectedProject);
  const counts = {
    working: projectSessions.filter((session) => session.status === "working" && session.lifecycle !== "closed").length,
    needs: projectSessions.filter((session) => session.status === "needs-you" && session.lifecycle !== "closed").length,
    done: projectSessions.filter((session) => session.status === "done" && session.lifecycle !== "closed").length,
  };
  const filterCounts = {
    all: projectSessions.length,
    open: projectSessions.filter((session) => session.lifecycle === "open").length,
    discarded: projectSessions.filter((session) => session.lifecycle === "discarded").length,
    closed: projectSessions.filter((session) => session.lifecycle === "closed").length,
  };

  async function createProject() {
    const name = window.prompt("Project name");
    if (!name?.trim()) return;
    const project: Project = { id: crypto.randomUUID(), name: name.trim(), color: "#8b5cf6" };
    const nextProjects = [...projects, project];
    setProjects(nextProjects);
    setSelectedProject(project.id);
    await chrome.storage.local.set({ projects: nextProjects });
  }

  async function moveSession(session: AISession, projectId: string) {
    const saved = await chrome.storage.local.get("sessionAssignments");
    const sessionAssignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
    sessionAssignments[session.id] = projectId;
    await chrome.storage.local.set({ sessionAssignments });
    scheduleRefresh();
  }

  async function togglePin(session: AISession) {
    const saved = await chrome.storage.local.get("pinnedSessions");
    const pinnedSessions = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
    pinnedSessions[session.id] = !session.pinned;
    await chrome.storage.local.set({ pinnedSessions });
    scheduleRefresh();
  }

  async function openSession(session: AISession) {
    await focusSession(session);
    scheduleRefresh();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div><div className="eyebrow">AI WORKSPACE</div><h1>Your AI work</h1></div>
        <button className="icon-button" title="Create project" onClick={() => void createProject()}><FolderPlus size={18} /></button>
      </header>

      <section className="attention">
        <div className="attention-header"><div><span className="section-kicker">Attention</span><p>See what needs you without opening every tab.</p></div><span className="live-dot" /></div>
        <div className="attention-grid">
          <Stat icon={<CircleAlert size={16} />} label="Needs you" value={counts.needs} />
          <Stat icon={<Activity size={16} />} label="Working" value={counts.working} />
          <Stat icon={<CheckCircle2 size={16} />} label="Done" value={counts.done} />
        </div>
      </section>

      <div className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /></div>

      <div className="layout">
        <aside className="sidebar">
          <div className="side-heading">Projects</div>
          {projects.map((project) => <button key={project.id} className={`project-row ${selectedProject === project.id ? "selected" : ""}`} onClick={() => setSelectedProject(project.id)}>{project.id === "inbox" ? <Inbox size={16} /> : <LayoutGrid size={16} />}<span>{project.name}</span><span className="count">{sessions.filter((session) => session.projectId === project.id).length}</span></button>)}
        </aside>

        <main className="sessions">
          <div className="sessions-header">
            <div><h2>{projects.find((project) => project.id === selectedProject)?.name}</h2><span>{projectSessions.length} conversations</span></div>
            <button className="refresh" onClick={() => void refresh()}>{loading ? "Scanning…" : "Rescan"}</button>
          </div>

          <div className="view-filters">
            {([["all", "All"], ["open", "Open"], ["discarded", "Not loaded"], ["closed", "Closed"]] as const).map(([value, label]) => <button key={value} className={viewFilter === value ? "active" : ""} onClick={() => setViewFilter(value)}>{label}<span>{filterCounts[value]}</span></button>)}
          </div>

          {visible.length === 0 ? (
            <div className="empty"><div className="empty-icon"><Search size={22} /></div><h3>{query ? "No matching conversations" : viewFilter !== "all" ? `No ${viewFilter === "discarded" ? "unloaded" : viewFilter} sessions` : loading ? "Scanning your browser…" : "Nothing here yet"}</h3><p>{query ? "Try a different title or provider." : "Open a ChatGPT, Claude, or Gemini conversation and it will appear here automatically."}</p></div>
          ) : (
            <div className="session-list">
              {visible.map((session) => {
                const metaLabel = session.lifecycle === "closed" ? "Closed" : session.lifecycle === "discarded" ? "Not loaded" : statusMeta[session.status].label;
                return <article key={session.id} className={`session-card ${session.lifecycle === "closed" ? "closed-session" : ""}`} onClick={() => void openSession(session)} title={session.lifecycle === "closed" ? "Click to reopen this conversation" : session.lifecycle === "discarded" ? "This tab is unloaded from memory. Clicking it will load the tab." : session.title}>
                  <div className={`provider-dot ${session.provider}`} />
                  <div className="session-main"><div className="session-title">{session.title}</div><div className={`session-meta ${session.lifecycle}`}>{getProviderLabel(session.provider)} · {metaLabel}</div></div>
                  <div className="session-actions" onClick={(event) => event.stopPropagation()}>
                    <select className="move-select" aria-label="Move to project" value={session.projectId ?? "inbox"} onChange={(event) => void moveSession(session, event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                    <button className={`pin ${session.pinned ? "active" : ""}`} onClick={() => void togglePin(session)} title="Pin"><Pin size={15} /></button>
                  </div>
                </article>;
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