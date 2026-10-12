import type { AISession, Project, SessionMessage } from "./types";
import { normalizeWorkspaceFolderUri } from "./handoff";

export const WORKSPACE_BACKUP_FORMAT = "ai-workspace-backup";
export const WORKSPACE_BACKUP_VERSION = 1;

export interface WorkspaceBackupStorage {
  projects: Project[];
  sessions: AISession[];
  sessionRegistry?: Record<string, AISession>;
  sessionAssignments?: Record<string, string>;
  pinnedSessions?: Record<string, boolean>;
  sessionMetadata?: Record<string, string>;
  dismissedSuggestions?: Record<string, boolean>;
  sessionLabels?: Record<string, string>;
  projectBriefs?: Record<string, string>;
  projectWorkspaceUris?: Record<string, string>;
  storageSchemaVersion?: number;
}
export interface WorkspaceBackup {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  version: typeof WORKSPACE_BACKUP_VERSION;
  exportedAt: string;
  storage: WorkspaceBackupStorage;
  transcripts: Record<string, SessionMessage[]>;
}
type UnknownRecord = Record<string, unknown>;
const providers = new Set(["chatgpt", "claude", "gemini"]);
const statuses = new Set(["working", "needs-you", "done", "idle"]);
const lifecycles = new Set(["open", "discarded", "closed"]);
function isRecord(value: unknown): value is UnknownRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function boundedString(value: unknown, max: number, fallback = ""): string { return typeof value === "string" ? value.slice(0, max) : fallback; }
function cleanStringMap(value: unknown, maxValueLength = 500): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key.length > 0 && key.length <= 500 && typeof item === "string").map(([key, item]) => [key, (item as string).slice(0, maxValueLength)]));
}
function cleanBooleanMap(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 0 && key.length <= 500 && typeof item === "boolean") result[key] = item;
  }
  return result;
}
function cleanWorkspaceUriMap(value: unknown): Record<string, string> {
  const raw = cleanStringMap(value, 1500);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeWorkspaceFolderUri(value);
    if (!normalized) throw new Error("Backup contains an invalid local VS Code workspace URI.");
    result[key] = normalized;
  }
  return result;
}
function safeProviderUrl(provider: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (provider === "chatgpt") return host === "chatgpt.com" || host === "chat.openai.com";
    if (provider === "claude") return host === "claude.ai";
    if (provider === "gemini") return host === "gemini.google.com";
    return false;
  } catch { return false; }
}
function cleanProject(value: unknown): Project {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 200 || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 || typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color)) {
    throw new Error("Backup contains an invalid project record.");
  }
  return { id: value.id, name: value.name.trim(), color: value.color };
}
function cleanSession(value: unknown): AISession {
  if (!isRecord(value) || typeof value.provider !== "string" || !providers.has(value.provider)) throw new Error("Backup contains an invalid session provider.");
  const provider = value.provider as AISession["provider"];
  if (typeof value.id !== "string" || !value.id.startsWith(provider + ":") || value.id.length > 600 || !safeProviderUrl(provider, value.url) || typeof value.title !== "string" || value.title.length > 500 || (value.tabId !== null && value.tabId !== undefined && (!Number.isInteger(value.tabId) || (value.tabId as number) < 0)) || (value.windowId !== null && value.windowId !== undefined && (!Number.isInteger(value.windowId) || (value.windowId as number) < 0)) || (value.status !== undefined && (typeof value.status !== "string" || !statuses.has(value.status))) || (value.lifecycle !== undefined && (typeof value.lifecycle !== "string" || !lifecycles.has(value.lifecycle)))) {
    throw new Error("Backup contains an invalid session record or a URL outside the supported AI providers.");
  }
  const lifecycle = (lifecycles.has(String(value.lifecycle)) ? value.lifecycle : "closed") as AISession["lifecycle"];
  const status = (statuses.has(String(value.status)) ? value.status : "idle") as AISession["status"];
  return {
    id: value.id, provider, title: value.title.trim() || "Untitled conversation",
    customTitle: boundedString(value.customTitle, 80).trim() || undefined, url: value.url,
    tabId: typeof value.tabId === "number" ? value.tabId : null, windowId: typeof value.windowId === "number" ? value.windowId : null,
    status, lifecycle, discarded: lifecycle === "discarded",
    lastSeen: typeof value.lastSeen === "number" && Number.isFinite(value.lastSeen) ? value.lastSeen : 0,
    lastActivityAt: typeof value.lastActivityAt === "number" && Number.isFinite(value.lastActivityAt) ? value.lastActivityAt : undefined,
    projectId: typeof value.projectId === "string" ? value.projectId.slice(0, 200) : "inbox", pinned: Boolean(value.pinned),
    latestUser: boundedString(value.latestUser, 500), latestAssistant: boundedString(value.latestAssistant, 800),
    snapshotAt: typeof value.snapshotAt === "number" && Number.isFinite(value.snapshotAt) ? value.snapshotAt : undefined,
  };
}
function cleanTranscript(value: unknown): SessionMessage[] {
  if (!Array.isArray(value)) throw new Error("Backup contains an invalid transcript.");
  let remaining = 400000;
  const messages: SessionMessage[] = [];
  for (const item of value.slice(-100)) {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant") || typeof item.text !== "string") throw new Error("Backup contains an invalid transcript message.");
    const text = item.text.slice(0, Math.min(15000, remaining));
    if (!text) continue;
    messages.push({ id: boundedString(item.id, 200, String(messages.length)), role: item.role, text, observedAt: typeof item.observedAt === "number" && Number.isFinite(item.observedAt) ? item.observedAt : 0 });
    remaining -= text.length;
    if (remaining <= 0) break;
  }
  return messages;
}
/** Validate and bound a backup before merging it into extension storage. */
export function parseWorkspaceBackup(value: unknown): WorkspaceBackup {
  if (!isRecord(value) || value.format !== WORKSPACE_BACKUP_FORMAT || value.version !== WORKSPACE_BACKUP_VERSION || !isRecord(value.storage) || !Array.isArray(value.storage.projects) || !Array.isArray(value.storage.sessions) || !isRecord(value.transcripts)) {
    throw new Error("This is not a supported AI Workspace backup (expected format version 1).");
  }
  const rawStorage = value.storage;
  const rawProjects = rawStorage.projects as unknown[];
  const rawSessions = rawStorage.sessions as unknown[];
  const projects: Project[] = rawProjects.map(cleanProject);
  if (!projects.some((project: Project) => project.id === "inbox")) projects.unshift({ id: "inbox", name: "Inbox", color: "#8b5cf6" });
  if (new Set(projects.map((project: Project) => project.id)).size !== projects.length) throw new Error("Backup contains duplicate project IDs.");
  const sessions: AISession[] = rawSessions.map(cleanSession);
  const registry: Record<string, AISession> = {};
  if (rawStorage.sessionRegistry !== undefined) {
    if (!isRecord(rawStorage.sessionRegistry)) throw new Error("Backup contains an invalid session registry.");
    for (const [id, session] of Object.entries(rawStorage.sessionRegistry)) registry[id] = cleanSession(session);
  }
  const transcriptEntries = Object.entries(value.transcripts);
  if (transcriptEntries.length > 5000) throw new Error("Backup has too many transcript records.");
  const transcripts: Record<string, SessionMessage[]> = {};
  for (const [id, messages] of transcriptEntries) { if (!id || id.length > 600) throw new Error("Backup contains an invalid transcript ID."); transcripts[id] = cleanTranscript(messages); }
  return {
    format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, exportedAt: boundedString(value.exportedAt, 80),
    storage: {
      projects, sessions, sessionRegistry: registry,
      sessionAssignments: cleanStringMap(rawStorage.sessionAssignments, 200), pinnedSessions: cleanBooleanMap(rawStorage.pinnedSessions),
      sessionMetadata: cleanStringMap(rawStorage.sessionMetadata, 500), dismissedSuggestions: cleanBooleanMap(rawStorage.dismissedSuggestions),
      sessionLabels: cleanStringMap(rawStorage.sessionLabels, 80), projectBriefs: cleanStringMap(rawStorage.projectBriefs, 4000),
      projectWorkspaceUris: cleanWorkspaceUriMap(rawStorage.projectWorkspaceUris), storageSchemaVersion: 2,
    },
    transcripts,
  };
}