import type {Provider} from "./types";

export interface ProviderAdapter{
  provider:Provider;
  matches:(url:string)=>boolean;
  getLabel:()=>string;
}

const adapters:ProviderAdapter[]=[
  {provider:"chatgpt",matches:u=>/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(u),getLabel:()=> "ChatGPT"},
  {provider:"claude",matches:u=>/^https:\/\/claude\.ai\//.test(u),getLabel:()=> "Claude"},
  {provider:"gemini",matches:u=>/^https:\/\/gemini\.google\.com\//.test(u),getLabel:()=> "Gemini"}
];

export function getProvider(url:string):Provider|null{
  return adapters.find(a=>a.matches(url))?.provider??null;
}

export function getProviderLabel(p:Provider){
  return adapters.find(a=>a.provider===p)?.getLabel()??p;
}

export function isNewChatRoute(provider: Provider, url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    if (provider === "chatgpt") return path === "/";
    if (provider === "claude") return path === "/" || path === "/new";
    if (provider === "gemini") return path === "/" || path === "/app";
    return false;
  } catch {
    return false;
  }
}

export function getSessionId(provider: Provider, url: string, tabId?: number): string {
  try {
    const parsed = new URL(url);
    if (tabId !== undefined && isNewChatRoute(provider, url)) return `${provider}:draft:${tabId}`;
    return `${provider}:${parsed.host}${parsed.pathname.replace(/\/$/, "") || "/"}`;
  } catch {
    return `${provider}:${url}`;
  }
}