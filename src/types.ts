export type Provider="chatgpt"|"claude"|"gemini";
export type SessionStatus="working"|"needs-you"|"done"|"idle";
export type SessionLifecycle="open"|"discarded"|"closed";

export interface AISession{
  id:string;
  provider:Provider;
  title:string;
  url:string;
  tabId:number|null;
  windowId:number|null;
  status:SessionStatus;
  lifecycle:SessionLifecycle;
  discarded:boolean;
  lastSeen:number;
  projectId:string|null;
  pinned:boolean;
  lastActivityAt?:number;
}

export interface Project{id:string;name:string;color:string;}