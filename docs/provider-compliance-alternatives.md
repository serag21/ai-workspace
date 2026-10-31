# Provider-compliant Windows authentication & browser-window alternatives

**Task:** AW-005 (QW-005, G1) — bounded engineering comparison, one working
Windows proof, **no speculative rewrite**.
**Status:** decision support only. The engineering choice and any exposure of
new behavior remain owner decisions (charter "Next 3").
**Companion proof:** `experiments/desktop-spike/provider-isolation.test.mjs`
(CI step "Provider isolation and non-control contract").

This document compares provider-compliant architectures for the embedded
provider panes under the fixed constraints of this workspace. It deliberately
excludes anything that would (a) control the user's desktop or personal
browser, (b) read or import the real Chrome/Edge cookie store, (c) bypass
OAuth or embedded-browser restrictions, or (d) use undocumented provider APIs —
all are owner boundary rules (AGENTS.md) and provider ToS/embedded-browser
policy, not open options.

## Fixed constraints (all alternatives must satisfy these)

1. **Isolation:** provider content runs in `sandbox: true`, `nodeIntegration: false`,
   `contextIsolation: true`, `webSecurity: true`, no `webviewTag`, per-provider
   persistent partitions under `persist:ai-workspace-spike-*` (REL-013).
2. **Non-control:** the app never drives the user's browser or desktop. The single
   external-open path is `spike:open-native-browser` (owner-click, owner-window IPC,
   canonical-URL pipeline, never credentials/callbacks/fragments — CON-001, REL-013).
3. **No credential access:** never copy/extract cookies, tokens, or OAuth codes;
   diagnostics carry numeric error codes and states only (windows-provider-acceptance.md).
4. **Honest limitation display:** blocked OAuth popups show `popup-blocked`, not a
   fake success (CON-017). A static render or mock pass is not a G1 pass.

## What the current architecture can and cannot do for sign-in

The spike's provider panes are genuine provider webpages in isolated Electron
sessions (WebContentsView). The sign-in consequence, which every alternative
must face:

- **Inline sign-in forms** (the provider renders email/password or SSO *inside*
  the pane) *can* complete inside the pane, because the pane is a real browser
  surface with a real persistent session per provider.
- **OAuth popup or redirect-to-external-SSO flows** are *hard-denied by design*
  (`setWindowOpenHandler` denies all popups) and cannot complete inside the
  pane. The denied destination is discarded (no state kept), so the pane cannot
  be "retried into" the login URL.
- **Cookies are partition-isolated by design** from the owner's real browser
  profile. Therefore "sign in in your own browser, then use the embedded pane"
  is **not** a supported flow: the pane would see no sign-in at all. (This is a
  safety property — it is why issue #2's first-party interference risk stays low.)

Whether each target provider actually offers a fully inline sign-in is a
**live unknown** — that is exactly what G1 step 2 exists to establish, per
provider, recorded Pass/Fail/Blocked/Not tested. No architecture comparison
can substitute for that observation; the comparison below decides what to do
*given each possible outcome*.

## Architecture alternatives

| # | Alternative | Sign-in path | Compliance with fixed constraints | Engineering cost | Risks |
|---|---|---|---|---|---|
| A | **Keep current embedded isolated panes** (status quo) | Inline form if the provider offers one; else owner completes sign-in in the app's own pane or falls back to B | Meets 1–4 as built | ~zero | Per-provider login may be **Blocked** (popup/SSO); then the pane is read-only/preview value only |
| B | **Owner-launched system browser as the provider work surface** (composition, not control): the app's pane is an optional preview; the real provider conversation happens in the owner's own browser session; the app keeps its unique value in local-agent inventory/resume/tail/handoff and only offers canonical "open thread" links | Owner signs in in their own browser exactly as today — the app is not in the login path at all | Meets 1–4 by construction (the app does less) | ~zero (remove/shrink the login *promise*) | Embedded pane's login promise is dropped; product value pivots to the local-agent workbench — **this is the pivot option** the task authorizes recommending |
| C | **OS-level shared-profile composition** (WebView2/Edge AddMode or a second browser sharing the personal profile's user-data-folder) | Would inherit the owner's real sign-in | **Fails** fixed constraints 2 and 3 (touches the personal profile; running two browsers over one profile risks corruption; provider policies prohibit scripted-embedding of their accounts). **Excluded, not a candidate** | high | Credential exposure, profile corruption, ToS violation |
| D | **Official API/SDK identities** (owner pastes their own API key or completes a published OAuth device flow in their own browser; the app talks provider APIs, not the web chat UI) | Outside the web pane entirely; owner-consented, key stored only locally | Meets the *spirit* of 1–4 (no browser impersonation), but opens a **paid-API escalation**: owner consent required before any call, budgets per RUN_STATE, and it is a different conversation surface (API ≠ web-chat history) | medium-high (new product surface) | Scope drift toward a second product; must stay an opt-in, never the default |

### Read of each option

**A — keep the embedded panes, accept per-provider login outcomes.**
Compliant today; zero new risk. The only honest limitation is that any target
provider whose sign-in requires a browser popup/SSO redirect will be *Blocked*
inside the pane and must use the documented fallback ("Open in browser" →
owner's own browser). That is an **acceptable documented limitation** (CON-017
honest states; runbook step 2 already assumes it) — not yet a failure.

**B — shrink the app's promise, pivot the product emphasis.**
If G1 step 2 comes back Blocked for the significant share of target providers,
A's core value proposition ("genuine provider conversations *inside* the
desktop app") is unsupported, and the comparison's honest recommendation is to
stop investing in embedded login and re-aim: local-agent workbench (inventory,
bounded resume, tail preview, provenance-aware handoff) where the app's evidence
is strongest, with the provider pane demoted to an optional read-only preview
and provider work done in the owner's own browser (which needs no app
involvement and no new compliance surface). This is a **product decision**
(charter/owner), not an engineering one — the comparison can only surface it.

**C — excluded.** Violates the owner's fixed constraints and provider
embedded-browser policy on its face; no further analysis is warranted and no
prototype should be built (building one would itself be the "speculative
rewrite" the task forbids).

**D — separate product decision, tracked separately.** Official API/SDK
integration is the *only* alternative that could give the app a first-party,
fully compliant, always-available conversation surface, and it is the path
AW-008 (official SDK stream/approval contract) is already mapping. It is
**not** a fix for the web-pane login problem, it is a different surface. Keep
it owner-gated (paid-API escalation rule) and out of scope of this
sign-in/pane decision.

## Stop/pivot recommendation (the decision the task required)

The recommendation is **conditional on the one piece of evidence none of these
documents can provide — the owner's G1 step 2 run** (windows-provider-acceptance.md):

- **Continue with A (no rewrite)** while *every* target provider's sign-in either
  succeeds inline in the pane **or** is a documented, acceptable per-provider
  limitation the owner explicitly accepts (owner may choose to accept one
  provider being "preview-only" if the others sign in fine).
- **Pivot to B (stop embedded-login investment)** once the G1 run shows **two or
  more** of the target providers Blocked on sign-in inside the pane (popup/SSO
  required) with **no** inline form usable — the charter's promise is all three
  providers' genuine experiences, so two unusable panes means that promise is
  no longer supported, and B is the only compliant, non-speculative path
  forward. Record the G1 row in DECISIONS.md as the pivot trigger.
- **Do not build C.** **Do not conflate D with either** — D is a separate,
  owner-gated, paid-API workstream (AW-008+).

This is deliberately *not* a "stop now" or "rewrite now" call: neither is
honest without the live sign-in observation, and both would violate QW-005's
"no speculative rewrite" and the owner's "no unvalidated pivot" boundaries.

## What the bounded CPU-only proof establishes (and does not)

`provider-isolation.test.mjs` (fake Electron, CPU-only, zero provider traffic):

- **CON-016 / REL-008:** two panes of the *same* provider resolve the *same*
  persistent partition key (login-persistence contract, pane-identity
  contract), while *different* providers never share a session key. Maps the
  previously unmapped **CON-016** gate to a synthetic test (coverage now
  names 32 of 50 gates; all 16 P0 gates still require a live host).
- **REL-013:** untrusted/hostile provider strings cannot allocate a view, a
  session, or a partition, and cannot perturb pane state — the partition-key
  space is allowlist-bound, not just URL-bound.
- **CON-016 / REL-013 (non-control):** a blocked login popup produces **zero**
  side effects outside the app — no auto-opened browser, no pane navigation,
  no retained/retransmit-able OAuth URL — and the *only* external open in the
  app remains the owner-clicked, canonical, owner-window-gated fallback.

**It does not prove**, and never will by itself: that *any* provider's real
sign-in form renders and completes inside the pane (G1 step 2, live), that
two panes hold two distinct real threads simultaneously under real provider
network conditions (G1 step 5, live), or that the owner's official browser
stays untouched across a full G1 session (REL-001, live). Those remain live
acceptance; this proof only pins the security/isolation contract the
architecture *claims*, so that whichever of A/B the owner chooses, the claim
is testable and falsifiable rather than assumed.

## Owner decisions this document requires

1. **Which providers** are the G1 step 2 sign-in targets (the stop/pivot
   trigger counts "Blocked" against that set).
2. **Accept A's per-provider limitation framing** or pre-commit to B as the
   fallback the moment any target provider is Blocked.
3. **Keep D scoped out** of this decision (separate paid-API workstream,
   AW-008+), as recommended above.
