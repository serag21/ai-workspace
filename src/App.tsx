import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, CheckCircle2, CircleAlert, ExternalLink, FolderPlus, Inbox, LayoutGrid, Lightbulb, MessageSquarePlus, Pin, Pencil, Search, Trash2, X } from "lucide-react";
import { discoverOpenSessions, ensureSessionTab, focusSession, requestSessionSnapshot, waitForTabComplete } from "./chrome";
import { getProvider, getProviderLabel, getSessionId, isNewChatRoute } from "./providers";
import type { AISession, Project, SessionMessage, SessionStatus } from "./types";
import { getSessionMessages, migrateSessionMessages, saveSessionMessages, searchSessionIds } from "./sessionDb";

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

interface ProjectSuggestion {
  key: string;
  name: string;
  sessionIds: string[];
  sampleTitles: string[];
}

const PROJECT_PATTERNS: Array<{ key: string; name: string; match: RegExp }> = [
  { key: "trainclear", name: "TrainClear", match: /trainclear/i },
  { key: "openmontage", name: "OpenMontage", match: /openmontage/i },
  { key: "roblox", name: "Roblox", match: /roblox/i },
  { key: "comfyui", name: "ComfyUI", match: /comfy\s*ui/i },
  { key: "youtube", name: "YouTube", match: /youtube/i },
  { key: "autonomous-scraper", name: "Autonomous Scraper", match: /autonomous[ -]+scraper/i },
  { key: "visual-investigator", name: "Visual Investigator", match: /visual[ -]+investigator/i },
  { key: "ai-workspace", name: "AI Workspace", match: /ai[ -]+chat[ -]+workspace|ai[ -]+workspace/i },
];

const PROJECT_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "your", "about", "into", "after", "before",
  "help", "helping", "chat", "conversation", "google", "gemini", "claude", "chatgpt", "openai",
  "project", "design", "request", "ideas", "idea", "full", "app", "new", "fixing", "using",
  "analysis", "analysis", "questions", "question", "exploring", "explore", "update", "updates",
  "guide", "explanation", "explained", "strategy", "planning", "implementation", "implementation",
]);

function buildProjectSuggestions(sessions: AISession[], dismissed: Record<string, boolean>): ProjectSuggestion[] {
  const inbox = sessions.filter((session) => session.projectId === "inbox");
  if (inbox.length < 4) return [];

  const suggestions: ProjectSuggestion[] = [];

  for (const pattern of PROJECT_PATTERNS) {
    const matching = inbox.filter((session) => pattern.match.test(session.title));
    if (matching.length >= 3 && !dismissed[pattern.key]) {
      suggestions.push({
        key: pattern.key,
        name: pattern.name,
        sessionIds: matching.map((session) => session.id),
        sampleTitles: matching.slice(0, 3).map((session) => session.title),
      });
    }
  }

  const tokenGroups = new Map<string, AISession[]>();
  for (const session of inbox) {
    const tokens = session.title
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 5 && !PROJECT_STOP_WORDS.has(token));

    for (const token of new Set(tokens)) {
      const group = tokenGroups.get(token) ?? [];
      group.push(session);
      tokenGroups.set(token, group);
    }
  }

  const maxGroupSize = Math.max(4, Math.floor(inbox.length * 0.6));
  const fallback = [...tokenGroups.entries()]
    .filter(([token, group]) => group.length >= 4 && group.length <= maxGroupSize && !dismissed["keyword:" + token])
    .sort((a, b) => (b[1].length * b[0].length) - (a[1].length * a[0].length));

  for (const [token, group] of fallback) {
    const name = token.charAt(0).toLocaleUpperCase() + token.slice(1);
    if (suggestions.some((suggestion) => suggestion.name.toLocaleLowerCase() === name.toLocaleLowerCase())) continue;

    suggestions.push({
      key: "keyword:" + token,
      name,
      sessionIds: group.map((session) => session.id),
      sampleTitles: group.slice(0, 3).map((session) => session.title),
    });

    if (suggestions.length >= 6) break;
  }

  return suggestions
    .sort((a, b) => b.sessionIds.length - a.sessionIds.length)
    .slice(0, 6);
}

function normalizeStoredSession(session: AISession): AISession {
  const lifecycle = session.lifecycle ?? (session.tabId === null ? "closed" : session.discarded ? "discarded" : "open");
  return {
    ...session,
    tabId: session.tabId ?? null,
    windowId: session.windowId ?? null,
    lifecycle,
    discarded: lifecycle === "discarded",
    projectId: session.projectId ?? "inbox",
    latestUser: (session.latestUser ?? "").replace(/\s+/g, " ").slice(0, 500),
    latestAssistant: (session.latestAssistant ?? "").replace(/\s+/g, " ").slice(0, 800),
  };
}

const RELATED_STOP_WORDS = new Set([
  "about", "after", "again", "before", "being", "could", "design", "doing", "from", "have", "into",
  "just", "project", "should", "that", "their", "there", "these", "this", "using", "what", "when",
  "where", "which", "with", "your", "conversation", "chat", "help", "question", "questions", "analysis",
  "implementation", "update", "updates", "idea", "ideas", "full", "new", "working", "work",
]);

function meaningfulTokens(value: string) {
  return new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 5 && !RELATED_STOP_WORDS.has(token)),
  );
}

function relatedScore(source: AISession, candidate: AISession) {
  const sourceTitle = meaningfulTokens(source.title);
  const candidateTitle = meaningfulTokens(candidate.title);
  const sourceContext = meaningfulTokens([source.latestUser, source.latestAssistant].filter(Boolean).join(" "));
  const candidateContext = meaningfulTokens([candidate.latestUser, candidate.latestAssistant].filter(Boolean).join(" "));

  const sharedTitle = [...sourceTitle].filter((token) => candidateTitle.has(token));
  const sharedContext = [...sourceContext].filter((token) => candidateContext.has(token));
  const sharedAcross = [...sourceTitle].filter((token) => candidateContext.has(token));

  let score = sharedTitle.length * 4 + sharedContext.length * 1.25 + sharedAcross.length * 1.5;
  if (source.projectId && source.projectId !== "inbox" && source.projectId === candidate.projectId) score += 2;
  if (source.provider !== candidate.provider) score += 0.5;
  if (candidate.lifecycle === "open") score += 0.25;

  return {
    score,
    sharedCount: new Set([...sharedTitle, ...sharedContext, ...sharedAcross]).size,
    reason: source.projectId && source.projectId !== "inbox" && source.projectId === candidate.projectId
      ? "Same project"
      : candidate.provider !== source.provider
        ? "Similar work on another AI"
        : "Similar topic",
  };
}

function buildRelatedSessions(source: AISession | null, sessions: AISession[]) {
  if (!source) return [];
  return sessions
    .filter((session) => session.id !== source.id)
    .map((session) => ({ session, ...relatedScore(source, session) }))
    .filter((item) => item.sharedCount >= 2 && item.score >= 4)
    .sort((a, b) => b.score - a.score || Number(b.session.lifecycle === "open") - Number(a.session.lifecycle === "open"))
    .slice(0, 3);
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
  const [selectedProject, setSelectedProject] = useState("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [newChatProvider, setNewChatProvider] = useState<"chatgpt" | "claude" | "gemini">("chatgpt");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [closingTabs, setClosingTabs] = useState(false);
  const [closeProgress, setCloseProgress] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<SessionMessage[]>([]);
  const [transcriptMatches, setTranscriptMatches] = useState<Set<string>>(new Set());
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Record<string, boolean>>({});
  const refreshTimer = useRef<number | null>(null);
  const refreshGeneration = useRef(0);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const reconcileDraftRouteRef = useRef<(tabId: number) => Promise<void>>(async () => {});
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  async function refresh() {
    const generation = ++refreshGeneration.current;
    setLoading(true);
    setScanError(null);
    try {
      const discovered = await discoverOpenSessions();
      const saved = await chrome.storage.local.get(["sessions", "sessionRegistry", "sessionAssignments", "pinnedSessions", "projects", "sessionMetadata", "dismissedSuggestions"]);
      if (generation !== refreshGeneration.current) return;

      const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
      const pinned = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
      const savedProjects = (saved.projects ?? seedProjects) as Project[];
      const savedDismissedSuggestions = (saved.dismissedSuggestions ?? {}) as Record<string, boolean>;
      const metadata = (saved.sessionMetadata ?? {}) as Record<string, string>;
      const storedSessions = ((saved.sessions ?? []) as AISession[]).map(normalizeStoredSession);
      const registrySessions = Object.values((saved.sessionRegistry ?? {}) as Record<string, AISession>).map((session) => normalizeStoredSession({
        ...session,
        projectId: assignments[session.id] ?? session.projectId ?? "inbox",
        pinned: Boolean(pinned[session.id] ?? pinned[session.provider + ":" + session.tabId] ?? session.pinned),
      }));
      const storedById = new Map<string, AISession>();
      for (const session of [...storedSessions, ...registrySessions]) storedById.set(session.id, session);

      const matchedStoredIds = new Set<string>();
      setProjects(savedProjects.length ? savedProjects : seedProjects);
      setDismissedSuggestions(savedDismissedSuggestions);

      const liveSessions = discovered.map((session) => {
        const legacyId = session.provider + ":" + session.tabId;
        const previous = storedById.get(session.id) ?? storedById.get(legacyId);
        if (previous) matchedStoredIds.add(previous.id);

        const providerState = (saved.sessionRegistry ?? {})[session.id] as AISession | undefined;
        const cachedTitle = providerState?.title ?? previous?.title ?? metadata[session.id] ?? metadata[legacyId];
        const isGenericTitle = /^(claude\.ai|chatgpt(\.com)?|gemini(\.google\.com)?|untitled conversation)$/i.test(session.title);
        const title = session.discarded && isGenericTitle && cachedTitle ? cachedTitle : session.title;
        const projectId = assignments[session.id] ?? assignments[legacyId] ?? previous?.projectId ?? "inbox";
        const isPinned = pinned[session.id] ?? pinned[legacyId] ?? previous?.pinned ?? false;
        if (!session.discarded && !isGenericTitle) metadata[session.id] = session.title;

        return {
          ...session,
          title,
          status: previous?.status ?? session.status,
          latestUser: previous?.latestUser,
          latestAssistant: previous?.latestAssistant,
          snapshotAt: previous?.snapshotAt,
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
    } catch (error) {
      if (generation === refreshGeneration.current) {
        setScanError(error instanceof Error ? error.message : "Could not refresh AI sessions.");
      }
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => { void refresh(); }, 250);
  }

  async function createNewChat() {
    const urls = {
      chatgpt: "https://chatgpt.com/",
      claude: "https://claude.ai/new",
      gemini: "https://gemini.google.com/app",
    } as const;
    const provider = newChatProvider;
    const projectId = selectedProject === "all" ? "inbox" : selectedProject;

    setScanError(null);
    try {
      const tab = await chrome.tabs.create({ url: urls[provider], active: false });
      if (tab.id === undefined) throw new Error("Chrome did not return a tab ID.");
      await waitForTabComplete(tab.id);

      const loadedTab = await chrome.tabs.get(tab.id);
      const loadedUrl = loadedTab.url || urls[provider];
      const detectedProvider = getProvider(loadedUrl) ?? provider;
      const id = getSessionId(detectedProvider, loadedUrl, tab.id);

      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      } catch {}
      await new Promise((resolve) => window.setTimeout(resolve, 180));

      const session: AISession = {
        id,
        provider: detectedProvider,
        title: loadedTab.title?.trim() || "New " + getProviderLabel(detectedProvider) + " chat",
        url: loadedUrl,
        tabId: tab.id,
        windowId: loadedTab.windowId,
        status: "idle",
        lifecycle: loadedTab.discarded ? "discarded" : "open",
        discarded: Boolean(loadedTab.discarded),
        lastSeen: Date.now(),
        projectId,
        pinned: false,
      };

      const next = [session, ...sessionsRef.current.filter((item) => item.id !== id && item.tabId !== tab.id)];
      const saved = await chrome.storage.local.get(["sessionAssignments", "sessionRegistry"]);
      const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
      assignments[id] = projectId;
      const registry = (saved.sessionRegistry ?? {}) as Record<string, AISession>;
      registry[id] = { ...registry[id], ...session };
      await chrome.storage.local.set({ sessions: next, sessionAssignments: assignments, sessionRegistry: registry });

      setSessions(next);
      setSelectedProject(projectId);
      setSelectedSessionId(id);
      setQuery("");
      setStatusFilter(null);
      setViewFilter("all");
      setComposer("");
      scheduleRefresh();
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Could not start a new provider conversation.");
    }
  }

  async function reconcileDraftRoute(tabId: number) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url) return;
      const provider = getProvider(tab.url);
      if (!provider || isNewChatRoute(provider, tab.url)) return;

      const draftIdPrefix = provider + ":draft:";
      const draft = sessionsRef.current.find((session) =>
        session.tabId === tabId && session.provider === provider && session.id.startsWith(draftIdPrefix),
      );
      if (!draft) return;

      const hasStartedWork = Boolean(draft.latestUser?.trim()) ||
        draft.status === "working" || draft.status === "done" || draft.status === "needs-you";
      const actualId = getSessionId(provider, tab.url, tabId);
      if (actualId === draft.id) return;

      if (!hasStartedWork) {
        // If a blank draft navigated to a different conversation, discard only
        // the empty draft alias. Do not transfer its project to a history item
        // the user may have opened from the provider's own navigation.
        const next = sessionsRef.current.filter((session) => session.id !== draft.id);
        const saved = await chrome.storage.local.get(["sessionAssignments", "pinnedSessions", "sessionRegistry"]);
        const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
        const pins = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
        const registry = (saved.sessionRegistry ?? {}) as Record<string, AISession>;
        delete assignments[draft.id];
        delete pins[draft.id];
        delete registry[draft.id];
        await chrome.storage.local.set({ sessions: next, sessionAssignments: assignments, pinnedSessions: pins, sessionRegistry: registry });
        setSessions(next);
        if (selectedSessionId === draft.id) setSelectedSessionId(actualId);
        scheduleRefresh();
        return;
      }
      const existing = sessionsRef.current.find((session) => session.id === actualId);
      await migrateSessionMessages(draft.id, actualId);
      const migrated: AISession = {
        ...existing,
        ...draft,
        id: actualId,
        url: tab.url,
        title: tab.title?.trim() || draft.title,
        tabId,
        windowId: tab.windowId,
        lifecycle: "open",
        discarded: false,
        latestUser: draft.latestUser || existing?.latestUser,
        latestAssistant: existing?.latestAssistant || draft.latestAssistant,
        projectId: draft.projectId || existing?.projectId || "inbox",
        pinned: draft.pinned || Boolean(existing?.pinned),
      };

      const next = [
        migrated,
        ...sessionsRef.current.filter((session) => session.id !== draft.id && session.id !== actualId),
      ];
      const saved = await chrome.storage.local.get(["sessionAssignments", "pinnedSessions", "sessionRegistry"]);
      const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
      const pins = (saved.pinnedSessions ?? {}) as Record<string, boolean>;
      const registry = (saved.sessionRegistry ?? {}) as Record<string, AISession>;
      const projectId = assignments[draft.id] ?? draft.projectId ?? "inbox";
      if (assignments[draft.id]) delete assignments[draft.id];
      assignments[actualId] = projectId;
      if (pins[draft.id] !== undefined) {
        pins[actualId] = pins[draft.id];
        delete pins[draft.id];
      } else if (draft.pinned) {
        pins[actualId] = true;
      }
      delete registry[draft.id];
      registry[actualId] = { ...registry[actualId], ...migrated, projectId, pinned: Boolean(pins[actualId]) };

      await chrome.storage.local.set({
        sessions: next,
        sessionAssignments: assignments,
        pinnedSessions: pins,
        sessionRegistry: registry,
      });
      setSessions(next);
      if (selectedSessionId === draft.id) setSelectedSessionId(actualId);
    } catch {
      // The provider may still be redirecting. Later URL/status events retry safely.
    }
  }

  reconcileDraftRouteRef.current = reconcileDraftRoute;

  useEffect(() => {
    const onState = (message: { type?: string; sessionId?: string; status?: SessionStatus; title?: string; latestUser?: string; latestAssistant?: string; observedAt?: number }) => {
      if (message.type !== "ai-workspace:session-state" || !message.sessionId || !message.status) return;

      setSessions((current) => {
        let changed = false;
        const next = current.map((session) => {
          if (session.id !== message.sessionId) return session;
          const title = message.title?.trim() || session.title;
          const latestUser = message.latestUser || session.latestUser;
          const latestAssistant = message.latestAssistant || session.latestAssistant;
          const snapshotAt = message.observedAt || session.snapshotAt;
          if (session.status === message.status && session.title === title && session.latestUser === latestUser &&
              session.latestAssistant === latestAssistant && session.snapshotAt === snapshotAt) return session;
          changed = true;
          return { ...session, status: message.status!, title, latestUser, latestAssistant, snapshotAt };
        });
        return changed ? next : current;
      });

      if (message.sessionId === selectedSessionId) {
        void getSessionMessages(message.sessionId)
          .then((messages) => setSelectedMessages(messages))
          .catch(() => {});
      }
    };

    chrome.runtime.onMessage.addListener(onState);
    return () => chrome.runtime.onMessage.removeListener(onState);
  }, [selectedSessionId]);

  useEffect(() => {
    // One-time migration from the pre-compact storage format. Keep previews
    // bounded and remove the duplicate state blob; full messages stay in IndexedDB.
    void (async () => {
      const saved = await chrome.storage.local.get(["storageSchemaVersion", "sessionRegistry"]);
      if (Number(saved.storageSchemaVersion ?? 0) < 2) {
        const registry = (saved.sessionRegistry ?? {}) as Record<string, AISession>;
        for (const session of Object.values(registry)) {
          session.latestUser = (session.latestUser ?? "").replace(/\s+/g, " ").slice(0, 500);
          session.latestAssistant = (session.latestAssistant ?? "").replace(/\s+/g, " ").slice(0, 800);
        }
        await chrome.storage.local.set({ sessionRegistry: registry, storageSchemaVersion: 2 });
      }
      await chrome.storage.local.remove("sessionStates");
    })().catch(() => {});
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url !== undefined) void reconcileDraftRouteRef.current(tabId);
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
    for (const session of sessions) {
      if (session.tabId !== null && session.id.startsWith(session.provider + ":draft:") &&
          (session.latestUser?.trim() || session.status === "working" || session.status === "done" || session.status === "needs-you")) {
        void reconcileDraftRouteRef.current(session.tabId);
      }
    }
  }, [sessions]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedConversation() {
      setSelectedMessages([]);
      if (!selectedSessionId || !selectedSession) return;

      let fresh: SessionMessage[] = [];
      let freshSnapshot: Awaited<ReturnType<typeof requestSessionSnapshot>> = null;

      if (selectedSession.lifecycle === "open" && selectedSession.tabId !== null) {
        freshSnapshot = await requestSessionSnapshot(selectedSession.tabId);
        fresh = freshSnapshot?.messages ?? [];
      }

      if (fresh.length > 0) {
        await saveSessionMessages(selectedSession.id, fresh);
        if (!cancelled && freshSnapshot) {
          setSessions((current) => current.map((session) => session.id === selectedSession.id ? {
            ...session,
            title: freshSnapshot!.title.trim() || session.title,
            status: freshSnapshot!.status,
            latestUser: freshSnapshot!.latestUser.slice(0, 500) || session.latestUser,
            latestAssistant: freshSnapshot!.latestAssistant.slice(0, 800) || session.latestAssistant,
            snapshotAt: freshSnapshot!.timestamp,
          } : session));
        }
      }

      const cached = await getSessionMessages(selectedSession.id);
      const next = fresh.length > 0 ? fresh : cached;

      if (!cancelled) setSelectedMessages(next);
    }

    void loadSelectedConversation().catch(() => {
      if (!cancelled) setSelectedMessages([]);
    });
    return () => { cancelled = true; };
  }, [selectedSessionId, selectedSession?.tabId, selectedSession?.lifecycle, selectedSession?.url]);

  useEffect(() => {
    const term = query.trim();
    setTranscriptMatches(new Set());
    if (term.length < 3) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchSessionIds(term)
        .then((ids) => { if (!cancelled) setTranscriptMatches(new Set(ids)); })
        .catch(() => { if (!cancelled) setTranscriptMatches(new Set()); });
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const projectSessions = selectedProject === "all"
    ? sessions
    : sessions.filter((session) => session.projectId === selectedProject);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return projectSessions
      .filter((session) => viewFilter === "all" || session.lifecycle === viewFilter)
      .filter((session) => !statusFilter || session.status === statusFilter)
      .filter((session) => !normalized ||
        session.title.toLocaleLowerCase().includes(normalized) ||
        getProviderLabel(session.provider).toLocaleLowerCase().includes(normalized) ||
        (session.latestUser ?? "").toLocaleLowerCase().includes(normalized) ||
        (session.latestAssistant ?? "").toLocaleLowerCase().includes(normalized) ||
        transcriptMatches.has(session.id))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || statusRank[a.status] - statusRank[b.status] || lifecycleRank[a.lifecycle] - lifecycleRank[b.lifecycle] || a.title.localeCompare(b.title));
  }, [projectSessions, query, statusFilter, viewFilter, transcriptMatches]);

  const counts = {
    working: sessions.filter((session) => session.status === "working" && session.lifecycle === "open").length,
    needs: sessions.filter((session) => session.status === "needs-you").length,
    done: sessions.filter((session) => session.status === "done").length,
  };
  const filterCounts = {
    all: projectSessions.length,
    open: projectSessions.filter((session) => session.lifecycle === "open").length,
    discarded: projectSessions.filter((session) => session.lifecycle === "discarded").length,
    closed: projectSessions.filter((session) => session.lifecycle === "closed").length,
  };

  const projectSuggestions = useMemo(
    () => buildProjectSuggestions(sessions, dismissedSuggestions),
    [sessions, dismissedSuggestions],
  );
  const relatedSessions = useMemo(
    () => buildRelatedSessions(selectedSession, sessions),
    [selectedSession, sessions],
  );

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

  async function renameProject(project: Project) {
    if (project.id === "inbox") return;
    const value = window.prompt("Rename project", project.name);
    const name = value?.trim();
    if (!name || name === project.name) return;
    if (projects.some((item) => item.id !== project.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      window.alert("A project with that name already exists.");
      return;
    }

    const nextProjects = projects.map((item) => item.id === project.id ? { ...item, name } : item);
    await chrome.storage.local.set({ projects: nextProjects });
    setProjects(nextProjects);
  }

  async function deleteProject(project: Project) {
    if (project.id === "inbox") return;
    const moving = sessions.filter((session) => session.projectId === project.id);
    const confirmed = window.confirm(
      'Delete "' + project.name + '"? ' + moving.length +
      " conversation(s) will move to Inbox. Their locally cached transcripts will be kept.",
    );
    if (!confirmed) return;

    const saved = await chrome.storage.local.get("sessionAssignments");
    const assignments = (saved.sessionAssignments ?? {}) as Record<string, string>;
    for (const session of moving) assignments[session.id] = "inbox";

    const nextProjects = projects.filter((item) => item.id !== project.id);
    await chrome.storage.local.set({ projects: nextProjects, sessionAssignments: assignments });
    setProjects(nextProjects);
    setSessions((current) => current.map((session) =>
      session.projectId === project.id ? { ...session, projectId: "inbox" } : session,
    ));
    if (selectedProject === project.id) setSelectedProject("inbox");
    if (moving.some((session) => session.id === selectedSessionId)) setSelectedSessionId(null);
  }

  async function createSuggestedProject(suggestion: ProjectSuggestion) {
    const existingNames = new Set(projects.map((project) => project.name.toLocaleLowerCase()));
    let name = suggestion.name;
    let suffix = 2;
    while (existingNames.has(name.toLocaleLowerCase())) {
      name = suggestion.name + " " + suffix;
      suffix += 1;
    }

    const project: Project = { id: crypto.randomUUID(), name, color: "#8b5cf6" };
    const saved = await chrome.storage.local.get("sessionAssignments");
    const sessionAssignments = (saved.sessionAssignments ?? {}) as Record<string, string>;

    for (const sessionId of suggestion.sessionIds) {
      sessionAssignments[sessionId] = project.id;
    }

    const nextProjects = [...projects, project];
    await chrome.storage.local.set({ projects: nextProjects, sessionAssignments });

    setProjects(nextProjects);
    setSessions((current) => current.map((session) =>
      suggestion.sessionIds.includes(session.id) ? { ...session, projectId: project.id } : session,
    ));
    setSelectedProject(project.id);
    setSelectedSessionId(null);
  }

  async function dismissSuggestion(suggestion: ProjectSuggestion) {
    const next = { ...dismissedSuggestions, [suggestion.key]: true };
    setDismissedSuggestions(next);
    await chrome.storage.local.set({ dismissedSuggestions: next });
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

  async function captureSessionBeforeClose(session: AISession): Promise<boolean> {
    if (session.tabId === null) return true;

    if (session.lifecycle === "open") {
      let snapshot = await requestSessionSnapshot(session.tabId);
      if (!snapshot?.messages.length) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: session.tabId }, files: ["content.js"] });
          await new Promise((resolve) => window.setTimeout(resolve, 180));
          snapshot = await requestSessionSnapshot(session.tabId);
        } catch {}
      }

      if (snapshot?.messages.length) {
        await saveSessionMessages(session.id, snapshot.messages);
        setSessions((current) => current.map((item) => item.id === session.id ? {
          ...item,
          title: snapshot!.title || item.title,
          status: snapshot!.status,
          latestUser: snapshot!.latestUser.slice(0, 500),
          latestAssistant: snapshot!.latestAssistant.slice(0, 800),
          snapshotAt: snapshot!.timestamp,
        } : item));
        if (selectedSessionId === session.id) setSelectedMessages(snapshot.messages);
        return true;
      }
    }

    // Closing a tab with no local transcript would strand the user. Leave it
    // open when both a fresh capture and a cached transcript are unavailable.
    const cached = await getSessionMessages(session.id);
    if (cached.length > 0) return true;
    // An untouched, blank new-chat tab has no conversation to lose.
    return session.id.includes(":draft:") && !session.latestUser?.trim();
  }

  async function closeSession(session: AISession) {
    if (session.tabId === null) return;
    try {
      const safeToClose = await captureSessionBeforeClose(session);
      if (!safeToClose) {
        window.alert("Workspace couldn't capture this conversation. The tab was left open so you don't lose access to it.");
        return;
      }
      await chrome.tabs.remove(session.tabId);
      scheduleRefresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not safely close this session.");
    }
  }

  async function closeVisibleTabs() {
    const targets = visible.filter((session) => session.tabId !== null && session.lifecycle !== "closed");
    if (targets.length === 0 || closingTabs) return;
    const confirmed = window.confirm(
      "Capture recent messages where possible, then close " + targets.length +
      " visible AI tabs? Their cached conversations will remain in Workspace. Tabs that cannot be captured will be left open.",
    );
    if (!confirmed) return;

    setClosingTabs(true);
    let closed = 0;
    let skipped = 0;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const session = targets[index];
        setCloseProgress("Closing " + (index + 1) + " of " + targets.length);
        try {
          const safeToClose = await captureSessionBeforeClose(session);
          if (!safeToClose) {
            skipped += 1;
            continue;
          }
          if (session.tabId !== null) await chrome.tabs.remove(session.tabId);
          closed += 1;
        } catch {
          skipped += 1;
        }
      }
    } finally {
      setClosingTabs(false);
      setCloseProgress(null);
      scheduleRefresh();
    }

    if (skipped > 0) {
      window.alert("Closed " + closed + " tab(s). Left " + skipped + " tab(s) open because they could not be safely captured or closed.");
    }
  }

  async function sendPrompt(session: AISession) {
    const text = composer.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const tabId = session.tabId ?? await ensureSessionTab(session);
      if (tabId === null) throw new Error("Could not reopen the conversation.");
      const targetTabId = tabId;

      async function send(): Promise<{ ok?: boolean; error?: string }> {
        return chrome.tabs.sendMessage(targetTabId, { type: "ai-workspace:send-prompt", text });
      }

      let response: { ok?: boolean; error?: string } | undefined;
      try {
        response = await send();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const bridgeMissing = /receiving end does not exist|could not establish connection/i.test(message);
        if (!bridgeMissing) {
          window.alert("Could not confirm that the prompt was delivered. Open the provider tab to verify before trying again.");
          return;
        }

        try {
          await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ["content.js"] });
          await new Promise((resolve) => window.setTimeout(resolve, 150));
          response = await send();
        } catch {
          window.alert("The provider bridge was unavailable. Open the provider tab and try again.");
          return;
        }
      }

      if (response?.ok) {
        setComposer("");
        let targetWindowId = session.windowId;
        try {
          targetWindowId = (await chrome.tabs.get(targetTabId)).windowId;
        } catch {}
        setSessions((current) => current.map((item) => item.id === session.id
          ? { ...item, status: "working", lifecycle: "open", tabId: targetTabId, windowId: targetWindowId, latestUser: text.slice(0, 500) }
          : item));
        return;
      }

      window.alert(response?.error || "The provider did not accept the prompt. Nothing was retried automatically.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not send the prompt.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div><div className="eyebrow">AI WORKSPACE</div><h1>Your AI work</h1></div>
        <div className="topbar-actions">
          <select className="new-chat-provider" aria-label="New chat provider" value={newChatProvider} onChange={(event) => setNewChatProvider(event.target.value as "chatgpt" | "claude" | "gemini")}>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
          <button className="new-chat-button" onClick={() => void createNewChat()}><MessageSquarePlus size={15} /><span>New chat</span></button>
          <button className="icon-button" title="Create project" aria-label="Create project" onClick={() => void createProject()}><FolderPlus size={18} /></button>
        </div>
      </header>

      <section className="attention">
        <div className="attention-header"><div><span className="section-kicker">Attention</span><p>See what needs you without opening every tab.</p></div><span className="live-dot" /></div>
        <div className="attention-grid">
          <Stat icon={<CircleAlert size={16} />} label="Needs you" value={counts.needs} active={statusFilter === "needs-you"} onClick={() => { setSelectedProject("all"); setStatusFilter(statusFilter === "needs-you" ? null : "needs-you"); setSelectedSessionId(null); }} />
          <Stat icon={<Activity size={16} />} label="Working" value={counts.working} active={statusFilter === "working"} onClick={() => { setSelectedProject("all"); setStatusFilter(statusFilter === "working" ? null : "working"); setSelectedSessionId(null); }} />
          <Stat icon={<CheckCircle2 size={16} />} label="Done" value={counts.done} active={statusFilter === "done"} onClick={() => { setSelectedProject("all"); setStatusFilter(statusFilter === "done" ? null : "done"); setSelectedSessionId(null); }} />
        </div>
      </section>

      <div className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and cached messages" /></div>

      <div className="layout">
        <aside className="sidebar">
          <div className="side-heading">Workspace</div>
          <button className={"project-row " + (selectedProject === "all" ? "selected" : "")} onClick={() => { setSelectedProject("all"); setSelectedSessionId(null); }}>
            <Activity size={16} /><span>All work</span><span className="count">{sessions.length}</span>
          </button>
          <div className="side-heading">Projects</div>
          {projects.map((project) => (
            <div key={project.id} className={"project-item " + (selectedProject === project.id ? "selected" : "")}>
              <button className={"project-row " + (selectedProject === project.id ? "selected" : "")} onClick={() => { setSelectedProject(project.id); setSelectedSessionId(null); }}>
                {project.id === "inbox" ? <Inbox size={16} /> : <LayoutGrid size={16} />}
                <span>{project.name}</span>
                <span className="count">{sessions.filter((session) => session.projectId === project.id).length}</span>
              </button>
              {project.id !== "inbox" && (
                <div className="project-actions">
                  <button title={"Rename " + project.name} aria-label={"Rename " + project.name} onClick={() => void renameProject(project)}><Pencil size={12} /></button>
                  <button title={"Delete " + project.name} aria-label={"Delete " + project.name} onClick={() => void deleteProject(project)}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          ))}
        </aside>

        <main className="main-area">
          <div className={"workspace-grid " + (selectedSession ? "has-selection" : "")}>
            <section className="session-column">
              <div className="sessions-header">
                <div><h2>{selectedProject === "all" ? "All work" : projects.find((project) => project.id === selectedProject)?.name}</h2><span>{projectSessions.length} conversations</span></div>
                <div className="session-header-actions">
                  {visible.some((session) => session.tabId !== null && session.lifecycle !== "closed") && (
                    <button className="refresh" disabled={closingTabs} onClick={() => void closeVisibleTabs()}>{closeProgress || "Close tabs"}</button>
                  )}
                  <button className="refresh" onClick={() => void refresh()}>{loading ? "Scanning…" : "Rescan"}</button>
                </div>
              </div>
              {scanError && <div className="scan-error" role="status">Could not refresh sessions: {scanError} <button onClick={() => void refresh()}>Retry</button></div>}

              {selectedProject === "inbox" && !query.trim() && !statusFilter && projectSuggestions.length > 0 && (
                <section className="suggestions-panel">
                  <div className="suggestions-header">
                    <div className="suggestions-title">
                      <Lightbulb size={15} />
                      <div>
                        <strong>Suggested projects</strong>
                        <span>Review first — nothing moves until you approve it.</span>
                      </div>
                    </div>
                  </div>

                  <div className="suggestion-list">
                    {projectSuggestions.map((suggestion) => (
                      <article key={suggestion.key} className="suggestion-card">
                        <div className="suggestion-main">
                          <div className="suggestion-name">
                            <strong>{suggestion.name}</strong>
                            <span>{suggestion.sessionIds.length} conversations</span>
                          </div>
                          <div className="suggestion-samples">
                            {suggestion.sampleTitles.map((title) => <span key={title}>{title}</span>)}
                          </div>
                        </div>
                        <div className="suggestion-actions">
                          <button className="suggestion-create" onClick={() => void createSuggestedProject(suggestion)}>
                            Create & move
                          </button>
                          <button className="suggestion-dismiss" onClick={() => void dismissSuggestion(suggestion)}>
                            Dismiss
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

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
                          {(session.status === "working" ? session.latestUser : session.latestAssistant || session.latestUser) && (
                            <div className="session-preview">
                              {(session.status === "working" ? session.latestUser : session.latestAssistant || session.latestUser || "")
                                ?.replace(/\s+/g, " ").slice(0, 150)}
                            </div>
                          )}
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

                  {relatedSessions.length > 0 && (
                    <section className="related-panel">
                      <div className="related-header">
                        <div>
                          <strong>Related work</strong>
                          <span>AI Workspace found nearby threads you may want to continue.</span>
                        </div>
                      </div>
                      <div className="related-list">
                        {relatedSessions.map(({ session, reason }) => (
                          <button key={session.id} className="related-card" onClick={() => setSelectedSessionId(session.id)}>
                            <div className={"provider-dot " + session.provider} />
                            <div className="related-main">
                              <strong>{session.title}</strong>
                              <span>{getProviderLabel(session.provider)} · {reason}</span>
                            </div>
                            <span className="related-status">{statusMeta[session.status].label}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

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
