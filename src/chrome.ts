import {getProvider,getSessionId} from "./providers";
import type {AISession,Provider} from "./types";

export async function discoverOpenSessions():Promise<AISession[]> {
  const tabs=await chrome.tabs.query({});
  const now=Date.now();

  return tabs
    .filter(t=>Boolean(t.id&&t.url))
    .map(t=>({tab:t,provider:getProvider(t.url!)}))
    .filter((x):x is {tab:chrome.tabs.Tab;provider:Provider}=>Boolean(x.provider))
    .map(({tab,provider})=>({
      id:getSessionId(provider,tab.url!),
      provider,
      title:tab.title?.trim()||"Untitled conversation",
      url:tab.url!,
      tabId:tab.id!,
      windowId:tab.windowId,
      status:tab.discarded ? "idle" : tab.status==="loading" ? "working" : "idle",
      lifecycle:tab.discarded ? "discarded" : "open",
      discarded:Boolean(tab.discarded),
      lastSeen:now,
      projectId:null,
      pinned:false
    }));
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