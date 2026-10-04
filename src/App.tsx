import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, CheckCircle2, CircleAlert, ExternalLink, FolderPlus, Inbox, LayoutGrid, Pin, Search, X } from "lucide-react";
import { discoverOpenSessions, ensureSessionTab, focusSession, requestSessionSnapshot } from "./chrome";
import { getProviderLabel } from "./providers";
import type { AISession, Project, SessionMessage, SessionStatus } from "./types";
import { getSessionMessages } from "./sessionDb";

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
type StatusFilter = SessionStatus | null;

function normalizeStoredSession(session: AISession): AISession {
  const lifecycle = session.lifecycle ?? (session.tabId === null ? "closed" : session.discarded ? "discarded" : "open");
  return { ...session, tabId: session.tabId ?? null, windowId: session.windowId ?? null, lifecycle, discarded: lifecycle === "discarded", projectId: session.projectId ?? "inbox" };
}

function sessionSignature(sessions: AISession[]) {
  return JSON.stringify(sessions.map((session) => [
    session.id, session.title, session.url, session.tabId, session.windowId, session.status,
    session.lifecycle, session.projectId, session.pinned, session.lastSeen, session.lastActivityAt,
    session.latestUser, session.latestAssistant, session.snapshotAt,
  ]));
}

export function App() {
  const [sessions, setSessions] = useState<AISession[]>([]);
  const [projects, setProjects] = useState<Project[]>(seedProjects);
  const [query, setQuery] = useState("");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [selectedProject, setSelectedProject] = useState("inbox");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedMessages, setSelectedMessages] = useState<SessionMessage[]>([]);
  const refreshTimer = useRef<number | null>(null);
  const refreshGeneration = useRef(0);

  async function refresh() {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const discovered = await discoverOpenSessions();
      const saved = await chrome.storage.local.get(["sessions", "sessionRegistry", "sessionAssignments", "pinnedSessions", "projects", "sessionMetadata", "sessionStates"]);
      if (generation !== refreshGeneration.current) return;

      const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
      const pinned = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
      const savedProjects = (saved.projects ?? seedProjects) as Project[];
      const metadata = (saved.sessionMetadata ?? {}) as Record<string, string>;
      const sessionStates = (saved.sessionStates ?? {}) as Record<string, { status?: SessionStatus; title?: string; latestUser?: string; latestAssistant?: string; observedAt?: number }>;
      const storedSessions = ((saved.sessions ?? []) as AISession[]).map(normalizeStoredSession);
      const registrySessions = Object.values((saved.sessionRegistry ?? {}) as Record<string, AISession>).map((session) => normalizeStoredSession({
        ...session,
        projectId: session.projectId ?? assignments[session.id] ?? "inbox",
        pinned: session.pinned ?? Boolean(pinned[session.id]),
      }));
      const storedById = new Map<string, AISession>();
      for (const session of [...storedSessions, ...registrySessions]) storedById.set(session.id, session);

      const matchedStoredIds = new Set<string>();
      setProjects(savedProjects.length ? savedProjects : seedProjects);

      const liveSessions = discovered.map((session) => {
        const legacyId = session.provider + ":" + session.tabId;
        const previous = storedById.get(session.id) ?? storedById.get(legacyId);
        if (previous) matchedStoredIds.add(previous.id);

        const providerState = (saved.sessionRegistry ?? {})[session.id] as AISession | undefined;
        const cachedTitle = providerState?.title ?? previous?.title ?? metadata[session.id] ?? metadata[legacyId];
        const isGenericTitle = /^(claude\\.ai|chatgpt(\\.com)?|gemini(\\.google\\.com)?|untitled conversation)$/i.test(session.title);
        const title = session.discarded && isGenericTitle && cachedTitle ? cachedTitle : session.title;
        const projectId = assignments[session.id] ?? assignments[legacyId] ?? previous?.projectId ?? "inbox";
        const isPinned = pinned[session.id] ?? pinned[legacyId] ?? previous?.pinned ?? false;
        const liveState = sessionStates[session.id] ?? sessionStates[legacyId];

        if (!session.discarded && !isGenericTitle) metadata[session.id] = session.title;

        return {
          ...session,
          title: liveState?.title && !isGenericTitle ? liveState.title : title,
          status: liveState?.status ?? previous?.status ?? session.status,
          latestUser: liveState?.latestUser ?? previous?.latestUser,
          latestAssistant: liveState?.latestAssistant ?? previous?.latestAssistant,
          snapshotAt: liveState?.observedAt ?? previous?.snapshotAt,
          projectId,
          pinned: isPinned,
          lastSeen: previous?.lastSeen ?? session.lastSeen,
        };
      });

      const closedSessions = Array.from(storedById.values())
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
    const onState = (message: { type?: string; sessionId?: string; status?: SessionStatus; title?: string; latestUser?: string; latestAssistant?: string; observedAt?: number; messages?: SessionMessage[] }) => {
      if (message.type !== "ai-workspace:session-state" || !message.sessionId || !message.status) return;
      setSessions((current) => current.map((session) => session.id === message.sessionId ? {
        ...session,
        status: message.status!,
        title: message.title?.trim() || session.title,
        latestUser: message.latestUser || session.latestUser,
        latestAssistant: message.latestAssistant || session.latestAssistant,
        snapshotAt: message.observedAt || session.snapshotAt,
      } : session));
    };

    chrome.runtime.onMessage.addListener(onState);
    return () => chrome.runtime.onMessage.removeListener(onState);
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url !== undefined || changeInfo.status !== undefined || changeInfo.title !== undefined || changeInfo.discarded !== undefined) scheduleRefresh();
    };
    const onCreated = () => scheduleRefresh();
    const onRemoved = () => scheduleRefresh();
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedConversation() {
      setSelectedMessages([]);
      if (!selectedSessionId) return;

      const session = sessions.find((item) => item.id === selectedSessionId);
      if (!session) return;

      let fresh: SessionMessage[] = [];

      if (session.lifecycle === "open" && session.tabId !== null) {
        const snapshot = await requestSessionSnapshot(session.tabId);
        fresh = snapshot?.messages ?? [];
      }

      const cached = await getSessionMessages(session.id);
      const next = cached.length >= fresh.length ? cached : fresh;

      if (!cancelled) setSelectedMessages(next);
    }

    void loadSelectedConversation();
    return () => { cancelled = true; };
  }, [selectedSessionId, selectedSession?.tabId, selectedSession?.lifecycle]);

  const projectSessions = sessions.filter((session) => session.projectId === selectedProject);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return projectSessions
      .filter((session) => viewFilter === "all" || session.lifecycle === viewFilter)
      .filter((session) => !statusFilter || session.status === statusFilter)
      .filter((session) => !normalized || session.title.toLocaleLowerCase().includes(normalized) || getProviderLabel(session.provider).toLocaleLowerCase().includes(normalized))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || statusRank[a.status] - statusRank[b.status] || lifecycleRank[a.lifecycle] - lifecycleRank[b.lifecycle] || a.title.localeCompare(b.title));
  }, [projectSessions, query, statusFilter, viewFilter]);

  const counts = {
    working: projectSessions.filter((session) => session.status === "working" && session.lifecycle === "open").length,
    needs: projectSessions.filter((session) => session.status === "needs-you").length,
    done: projectSessions.filter((session) => session.status === "done").length,
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
    setSelectedSessionId(null);
    await chrome.storage.local.set({ projects: nextProjects });
  }

  async function moveSession(session: AISession, projectId: string) {
    const saved = await chrome.storage.local.get("sessionAssignments");
    const sessionAssignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
    sessionAssignments[session.id] = projectId;
    await chrome.storage.local.set({ sessionAssignments });
    setSessions((current) => current.map((item) => item.id === session.id ? { ...item, projectId } : item));
  }

  async function togglePin(session: AISession) {
    const saved = await chrome.storage.local.get("pinnedSessions");
    const pinnedSessions = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
    pinnedSessions[session.id] = !session.pinned;
    await chrome.storage.local.set({ pinnedSessions });
    setSessions((current) => current.map((item) => item.id === session.id ? { ...item, pinned: !item.pinned } : item));
  }

  async function openInChrome(session: AISession) {
    await focusSession(session);
    scheduleRefresh();
  }

  async function closeSession(session: AISession) {
    if (session.tabId === null) return;
    await chrome.tabs.remove(session.tabId);
    scheduleRefresh();
  }

  async function sendPrompt(session: AISession) {
    const text = composer.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const tabId = session.tabId ?? await ensureSessionTab(session);
      if (tabId === null) throw new Error("Could not reopen the conversation.");

      let lastError = "";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: "ai-workspace:send-prompt", text });
          if (response?.ok) {
            setComposer("");
            setSessions((current) => current.map((item) => item.id === session.id ? { ...item, status: "working", lifecycle: "open", tabId } : item));
            return;
          }
          lastError = response?.error || "The provider did not accept the prompt.";
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          await new Promise((resolve) => window.setTimeout(resolve, 800));
        }
      }
      window.alert(lastError || "Could not send the prompt.");
    } finally {
      setSending(false);
    }
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
          <Stat icon={<CircleAlert size={16} />} label="Needs you" value={counts.needs} active={statusFilter === "needs-you"} onClick={() => { setStatusFilter(statusFilter === "needs-you" ? null : "needs-you"); setSelectedSessionId(null); }} />
          <Stat icon={<Activity size={16} />} label="Working" value={counts.working} active={statusFilter === "working"} onClick={() => { setStatusFilter(statusFilter === "working" ? null : "working"); setSelectedSessionId(null); }} />
          <Stat icon={<CheckCircle2 size={16} />} label="Done" value={counts.done} active={statusFilter === "done"} onClick={() => { setStatusFilter(statusFilter === "done" ? null : "done"); setSelectedSessionId(null); }} />
        </div>
      </section>

      <div className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /></div>

      <div className="layout">
        <aside className="sidebar">
          <div className="side-heading">Projects</div>
          {projects.map((project) => (
            <button key={project.id} className={"project-row " + (selectedProject === project.id ? "selected" : "")} onClick={() => { setSelectedProject(project.id); setSelectedSessionId(null); }}>
              {project.id === "inbox" ? <Inbox size={16} /> : <LayoutGrid size={16} />}<span>{project.name}</span><span className="count">{sessions.filter((session) => session.projectId === project.id).length}</span>
            </button>
          ))}
        </aside>

        <main className="main-area">
          <div className={"workspace-grid " + (selectedSession ? "has-selection" : "")}>
            <section className="session-column">
              <div className="sessions-header">
                <div><h2>{projects.find((project) => project.id === selectedProject)?.name}</h2><span>{projectSessions.length} conversations</span></div>
                <button className="refresh" onClick={() => void refresh()}>{loading ? "Scanning…" : "Rescan"}</button>
              </div>

              <div className="view-filters">
                {([["all", "All"], ["open", "Open"], ["discarded", "Not loaded"], ["closed", "Closed"]] as const).map(([value, label]) => (
                  <button key={value} className={viewFilter === value ? "active" : ""} onClick={() => setViewFilter(value)}>{label}<span>{filterCounts[value]}</span></button>
                ))}
              </div>

              {visible.length === 0 ? (
                <div className="empty">
                  <div className="empty-icon"><Search size={22} /></div>
                  <h3>{query ? "No matching conversations" : statusFilter ? "No " + statusMeta[statusFilter].label.toLowerCase() + " sessions" : viewFilter !== "all" ? "No " + (viewFilter === "discarded" ? "unloaded" : viewFilter) + " sessions" : loading ? "Scanning your browser…" : "Nothing here yet"}</h3>
                  <p>{query ? "Try a different title or provider." : "Open a ChatGPT, Claude, or Gemini conversation and it will appear here automatically."}</p>
                </div>
              ) : (
                <div className="session-list">
                  {visible.map((session) => {
                    const metaLabel = session.lifecycle === "closed" ? "Closed" : session.lifecycle === "discarded" ? "Not loaded" : statusMeta[session.status].label;
                    return (
                      <article
                        key={session.id + ":" + (session.tabId ?? "closed")}
                        className={"session-card " + (session.id === selectedSessionId ? "selected-session " : "") + (session.lifecycle === "closed" ? "closed-session" : "")}
                        onClick={() => setSelectedSessionId(session.id)}
                        title="Select this conversation"
                      >
                        <div className={"provider-dot " + session.provider} />
                        <div className="session-main">
                          <div className="session-title">{session.title}</div>
                          <div className={"session-meta " + session.lifecycle}>{getProviderLabel(session.provider)} · {metaLabel}</div>
                        </div>
                        <div className="session-actions" onClick={(event) => event.stopPropagation()}>
                          <select className="move-select" aria-label="Move to project" value={session.projectId ?? "inbox"} onChange={(event) => void moveSession(session, event.target.value)}>
                            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                          </select>
                          <button className={"pin " + (session.pinned ? "active" : "")} onClick={() => void togglePin(session)} title="Pin"><Pin size={15} /></button>
                          {session.lifecycle !== "closed" && session.tabId !== null && <button className="session-close" onClick={() => void closeSession(session)} title="Close browser tab"><X size={14} /></button>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="session-detail">
              {!selectedSession ? (
                <div className="detail-empty"><div className="detail-empty-icon"><LayoutGrid size={24} /></div><h3>Select an AI session</h3><p>Its conversation, status, and continue box will live here. Opening the browser tab is optional.</p></div>
              ) : (
                <>
                  <header className="detail-header">
                    <button className="back-button" onClick={() => setSelectedSessionId(null)} title="Back to sessions"><ArrowLeft size={16} /></button>
                    <div className="detail-heading">
                      <span className={"provider-badge " + selectedSession.provider}>{getProviderLabel(selectedSession.provider)}</span>
                      <h3>{selectedSession.title}</h3>
                      <div className="detail-subline">{statusMeta[selectedSession.status].label} · {selectedSession.lifecycle}{selectedMessages.length ? " · conversation cached locally" : ""}</div>
                    </div>
                    <div className="detail-actions">
                      <button className="refresh" onClick={() => void openInChrome(selectedSession)}><ExternalLink size={13} /> Open in Chrome</button>
                      {selectedSession.lifecycle !== "closed" && selectedSession.tabId !== null && <button className="session-close" onClick={() => void closeSession(selectedSession)} title="Close browser tab"><X size={14} /></button>}
                    </div>
                  </header>

                  <div className="message-list">
                    {selectedMessages.length > 0 ? (
                      selectedMessages.map((message) => (
                        <article key={message.id} className={"message " + message.role}>
                          <div className="message-label">{message.role === "user" ? "You" : getProviderLabel(selectedSession.provider)}</div>
                          <div className="message-body">{message.text}</div>
                        </article>
                      ))
                    ) : (
                      <div className="transcript-empty">
                        <h4>No conversation snapshot yet</h4>
                        <p>Workspace will capture the rendered conversation from the provider tab automatically. Open the provider once when a session has never been captured.</p>
                        <button className="refresh" onClick={() => void openInChrome(selectedSession)}>Open in Chrome</button>
                      </div>
                    )}
                  </div>

                  <div className="composer">
                    <textarea value={composer} onChange={(event) => setComposer(event.target.value)} placeholder={"Continue this " + getProviderLabel(selectedSession.provider) + " conversation…"} onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        void sendPrompt(selectedSession);
                      }
                    }} />
                    <div className="composer-footer"><span>Ctrl/Cmd + Enter to send · provider tab stays optional</span><button className="send-button" disabled={!composer.trim() || sending} onClick={() => void sendPrompt(selectedSession)}>{sending ? "Sending…" : "Send"}</button></div>
                  </div>
                </>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  active = false,
  onClick,
}: {
  icon: import("react").ReactNode;
  label: string;
  value: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={"stat stat-button " + (active ? "active" : "")} onClick={onClick} type="button">
      <div className="stat-icon">{icon}</div>
      <div><strong>{value}</strong><span>{label}</span></div>
    </button>
  );
}
