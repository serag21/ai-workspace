import {getProvider,getSessionId} from "./providers";
import type {AISession,Provider} from "./types";

export async function discoverOpenSessions():Promise<AISession[]> {
  const tabs=await chrome.tabs.query({});
  const now=Date.now();
  const sessions=new Map<string,AISession>();

  for(const tab of tabs){
    if(!tab.id||!tab.url) continue;

    const provider=getProvider(tab.url);
    if(!provider) continue;

    const id=getSessionId(provider,tab.url);
    const session:AISession={
      id,
      provider,
      title:tab.title?.trim()||"Untitled conversation",
      url:tab.url,
      tabId:tab.id,
      windowId:tab.windowId,
      status:tab.discarded ? "idle" : tab.status==="loading" ? "working" : "idle",
      lifecycle:tab.discarded ? "discarded" : "open",
      discarded:Boolean(tab.discarded),
      lastSeen:now,
      projectId:null,
      pinned:false,
    };

    const existing=sessions.get(id);
    if(
      !existing ||
      (existing.discarded && !session.discarded) ||
      (tab.active && !existing.tabId)
    ){
      sessions.set(id,session);
    }
  }

  return [...sessions.values()];
}

export async function focusSession(s:AISession){
  if(s.tabId===null){
    const tab=await chrome.tabs.create({url:s.url,active:true});
    return tab.id??null;
  }

  await chrome.tabs.update(s.tabId,{active:true});
  if(s.windowId!==null){
    await chrome.windows.update(s.windowId,{focused:true});
  }
  return s.tabId;
}