/**
 * Opt-in, bounded provider history-sync REQUEST GATE (future integration).
 *
 * This module never accesses the network and NEVER schedules autonomous work.
 * Caller must explicitly connect and explicitly initiate each sync request.
 * No retry timers exist. An HTTP 429 locks the account until Retry-After.
 * This is independent of the real provider webpage views (which remain native).
 */
export class SyncGate {
  #accounts = new Map();
  #providerStarts = new Map();
  #activeProviders = new Set();
  #cooldowns = new Map();
  #stopped = false;
  #now;
  #budget;
  #windowMs;
  #cooldownMs;

  constructor({ now = () => Date.now(), maxRequestsPerWindow = 3, windowMs = 60_000,
    defaultCooldownMs = 60_000 } = {}) {
    if (typeof now !== "function" || !Number.isSafeInteger(maxRequestsPerWindow) ||
      maxRequestsPerWindow < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new TypeError("Invalid sync policy settings.");
    }
    this.#now = now;
    this.#budget = maxRequestsPerWindow;
    this.#windowMs = windowMs;
    this.#cooldownMs = defaultCooldownMs;
  }

  static #key(provider, accountId) {
    if (!/^[a-z][a-z0-9-]{1,35}$/.test(provider) ||
      typeof accountId !== "string" || !accountId.trim() || accountId.length > 300)
      throw new TypeError("Invalid provider/account identifier.");
    return JSON.stringify([provider, accountId]);
  }

  connect(provider, accountId, { explicitConsent = false } = {}) {
    const key = SyncGate.#key(provider, accountId);
    if (this.#stopped) return { ok: false, reason: "stopped" };
    if (!explicitConsent) return { ok: false, reason: "consent-required" };
    const prior = this.#accounts.get(key);
    if (prior?.mode === "running") return { ok: false, reason: "in-progress" };
    this.#accounts.set(key, { provider, accountId, mode: "idle", paused: false,
      cooldownUntil: Math.max(prior?.cooldownUntil || 0, this.#cooldowns.get(key) || 0), consecutiveErrors: 0, controller: null, generation: (prior?.generation ?? 0) + 1 });
    return { ok: true, mode: "idle" };
  }

  getState(provider, accountId) {
    const account = this.#accounts.get(SyncGate.#key(provider, accountId));
    if (!account) return { mode: "disconnected" };
    return { mode: account.mode, cooldownUntil: account.cooldownUntil,
      consecutiveErrors: account.consecutiveErrors };
  }

  pause(provider, accountId) {
    const account = this.#accounts.get(SyncGate.#key(provider, accountId));
    if (!account) return false;
    account.generation++;
    account.mode = "paused";
    account.paused = true;
    account.controller?.abort("user-pause");
    return true;
  }

  disconnect(provider, accountId) {
    const key = SyncGate.#key(provider, accountId);
    const account = this.#accounts.get(key);
    if (!account) return false;
    account.generation++;
    account.controller?.abort("disconnect");
    this.#accounts.delete(key);
    return true;
  }

  stopAll() {
    this.#stopped = true;
    for (const account of this.#accounts.values()) {
      account.generation++;
      account.mode = "paused";
      account.paused = true;
      account.controller?.abort("app-quit");
    }
  }

  static #retryAfterMs(value, now, fallbackMs) {
    if (typeof value !== "string" && typeof value !== "number") return fallbackMs;
    const trimmed = String(value).trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const seconds = Number(trimmed);
      return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : fallbackMs;
    }
    const until = Date.parse(trimmed);
    return Number.isFinite(until) ? Math.max(0, until - now) : fallbackMs;
  }

  /**
   * Pass in a local fake transport for tests. Production must supply a genuinely
   * supported, permissioned provider request transport, NOT browser cookie scraping.
   *
   * Only an explicit call to run() may issue a single network request.
   * The caller owns all prompts/files and must never send non-idempotent actions here.
   */
  async run(provider, accountId, { operation, transport } = {}) {
    const key = SyncGate.#key(provider, accountId);
    if (!["history-list", "history-read"].includes(operation) || typeof transport !== "function")
      throw new TypeError("Only explicit, read-only history requests are permitted.");
    if (this.#stopped) return { ok: false, reason: "stopped" };
    const account = this.#accounts.get(key);
    if (!account) return { ok: false, reason: "not-connected" };
    if (account.mode === "auth-required") return { ok: false, reason: "auth-required" };
    if (account.paused || account.mode === "paused") return { ok: false, reason: "paused" };
    const time = this.#now();
    if (time < account.cooldownUntil) return { ok: false, reason: "cooldown", retryAt: account.cooldownUntil };
    if (account.mode === "running" || this.#activeProviders.has(provider))
      return { ok: false, reason: "busy" };

    const starts = (this.#providerStarts.get(provider) ?? [])
      .filter((startedAt) => time - startedAt < this.#windowMs);
    if (starts.length >= this.#budget) {
      this.#providerStarts.set(provider, starts);
      return { ok: false, reason: "budget-exhausted", retryAt: starts[0] + this.#windowMs };
    }
    starts.push(time);
    this.#providerStarts.set(provider, starts);
    this.#activeProviders.add(provider);
    const generation = ++account.generation;
    const controller = new AbortController();
    account.controller = controller;
    account.mode = "running";

    try {
      const response = await transport({ provider, accountId, operation, signal: controller.signal });
      // No success or retry should be scheduled after pause/disconnect/quit.
      if (controller.signal.aborted || generation !== account.generation ||
        this.#accounts.get(key) !== account) return { ok: false, reason: "cancelled" };

      const status = Number(response?.status);
      if (status === 429) {
        const headers = response?.headers;
        const retryAfter = typeof headers?.get === "function"
          ? headers.get("retry-after")
          : headers?.["retry-after"] ?? headers?.["Retry-After"];
        account.cooldownUntil = this.#now() + SyncGate.#retryAfterMs(retryAfter, this.#now(), this.#cooldownMs);
        account.mode = "cooldown";
        this.#cooldowns.set(key, account.cooldownUntil);
        account.consecutiveErrors++;
        return { ok: false, reason: "rate-limited", retryAt: account.cooldownUntil };
      }
      if (status >= 200 && status < 300) {
        account.mode = "idle";
        account.consecutiveErrors = 0;
        account.cooldownUntil = 0;
        this.#cooldowns.delete(key);
        return { ok: true, status };
      }
      if (status === 401 || status === 403) {
        account.mode = "auth-required";
        return { ok: false, reason: "auth-required", status };
      }
      account.consecutiveErrors++;
      account.mode = "error";
      if (account.consecutiveErrors >= 3) {
        account.cooldownUntil = this.#now() + this.#cooldownMs;
        account.mode = "cooldown";
        this.#cooldowns.set(key, account.cooldownUntil);
      }
      return { ok: false, reason: "provider-error", status };
    } catch (error) {
      if (controller.signal.aborted || generation !== account.generation ||
        this.#accounts.get(key) !== account) return { ok: false, reason: "cancelled" };
      account.consecutiveErrors++;
      account.mode = "error";
      if (account.consecutiveErrors >= 3) {
        account.cooldownUntil = this.#now() + this.#cooldownMs;
        account.mode = "cooldown";
        this.#cooldowns.set(key, account.cooldownUntil);
      }
      return { ok: false, reason: "network-error" };
    } finally {
      if (account.controller === controller) account.controller = null;
      this.#activeProviders.delete(provider);
    }
  }
}
