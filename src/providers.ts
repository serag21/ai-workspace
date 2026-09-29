import type { Provider } from "./types";

export interface ProviderAdapter {
  provider: Provider;
  matches(url: string): boolean;
  getLabel(): string;
}

const adapters: ProviderAdapter[] = [
  {
    provider: "chatgpt",
    matches: (url) => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url),
    getLabel: () => "ChatGPT",
  },
  {
    provider: "claude",
    matches: (url) => /^https:\/\/claude\.ai\//.test(url),
    getLabel: () => "Claude",
  },
  {
    provider: "gemini",
    matches: (url) => /^https:\/\/gemini\.google\.com\//.test(url),
    getLabel: () => "Gemini",
  },
];

export function getProvider(url: string): Provider | null {
  return adapters.find((adapter) => adapter.matches(url))?.provider ?? null;
}

export function getProviderLabel(provider: Provider): string {
  return adapters.find((adapter) => adapter.provider === provider)?.getLabel() ?? provider;
}