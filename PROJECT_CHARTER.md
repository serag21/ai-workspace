# AI Workspace — Permanent Product Charter

**Owner-approved direction: 2026-10-29.** This is the enduring product vision, not the day-to-day task log. The desktop experiment is developed on `spike/local-agents-desktop`; the earlier Chrome extension remains preserved on `main`. Project execution details live separately in [BACKLOG.md](BACKLOG.md), [DECISIONS.md](DECISIONS.md), and [RUN_STATE.json](RUN_STATE.json).

## Why this product should exist

The original problem was dozens or hundreds of ChatGPT, Claude, Gemini, and coding-agent conversations scattered across browser tabs, desktop applications and terminals. Switching among them, locating the right conversation, seeing which is working versus awaiting input, and copying project context between models turned the user into a full-time AI project manager.

**Vision:** A dependable, visually excellent, provider-neutral **Windows AI workbench** where existing consumer AI conversations and local coding-agent sessions belong to the same project and remain accessible in their genuine interfaces. A user can research with ChatGPT, compare with Claude/Gemini, keep two or more conversations visible, observe and safely continue local Claude Code/Codex work, and transfer verified project context without recreating history by hand.

This is an ambitious product vision, not a claim that the current preview implements it.

## Customers and distinctive promise

- Primary early adopters: power users, developers, creators and indie founders who have many ongoing consumer AI chats **and** local AI coding/production sessions.
- Their job: **find it, see its real state, act on it, hand it over, and get back to life**—without losing provider functionality or project context.
- Value must exceed installing Echoes plus an existing coding-agent dashboard. Multi-provider chat, ordinary split panes, nested folders and basic text handoffs already exist elsewhere. Our strongest **unproven** distinction is project-linked continuity across genuine consumer provider sessions and local coding agents, tied to observed repo, test and artifact state.
- The interface should feel good enough to use every day: legible, calm, intuitive, easily discoverable split-right/split-down, user-selectable list/card/project views, searchable archives, honest session activity and clear next-action indicators. No clutter for the sake of features.

## Full original product scope to preserve

1. **Genuine provider interfaces:** existing ChatGPT, Claude, Gemini and potentially other supported signed-in consumer conversations, with normal history, model/effort selection, input draft, files/images, artifacts and native provider interactions where the provider allows. **Never replace the real interface with an unreliable DIY message sender.** Unsupported capabilities must be clearly labeled rather than silently broken.
2. **Unified discovery and organization:** a fast index of sessions across providers and account profiles; correct canonical conversation identity and reopen behavior; recency based on real messages rather than observation time; search, saved groupings, project folders, labels, filters, pinning and inbox/needs-attention views. Archive/import/export and backup must be safe and transparent.
3. **Multi-pane work:** two or more independently navigable conversations, including same-provider chats; side-by-side and stacked panes; ideally easy resizing and preserved layouts. Example: ChatGPT planning beside Claude Code implementing in a repo.
4. **Local agents as first-class sessions:** discover local Claude Code and Codex, ultimately OpenCode and other relevant agents; accurate repository identity, read-only transcript history, true working/idle/needs-approval/done state **only when grounded**, safe session continuation and—in a later validated stage—live streaming and explicit approval controls. Cloud and local sessions must not be conflated.
5. **Cross-model, cross-agent project handoff:** optional full transcript or intelligently bounded context, editable preview, source provenance, established decisions, constraints, unresolved questions, current repo path/branch/commit, verified tests, and linked images/artifacts. Disclose omissions, avoid accidental project mixing, flag secrets, obtain explicit destination/file consent and never auto-send without approval.
6. **Session continuity:** recover layouts and local drafts where technically supported; don't promise synchronization of unsent drafts from independent official apps without supported access. After interruption or device reboot, resume the correct sessions and meaningful project task rather than a blank chat.
7. **Reliable and understandable operations:** cancel/pause/inspect any opt-in history sync, honor quotas and per-account isolation, never aggressively retry until first-party websites fail, no invisible background GPU competition, and no popup consoles. Availability, privacy and session identity matter more than feature count.
8. **Business opportunity:** validate willingness to install, switch and eventually pay. Consider value proposition, sustainable maintenance, app signing, privacy disclosure, support, update reliability, licensing and security before commercial distribution.

Historic Chrome-extension accomplishments (provider+URL identity, tab lifecycle, transcript snapshots, working/done detection, workspace composer) are **research/prototype assets**, not a requirement to keep the extension as the product. Preserve the history; do not assume its DOM extraction was reliable enough for production.

## Non-negotiables

- Local-first project management where feasible, but never harvest official app cookies/tokens or bypass embedded-browser/OAuth restrictions; use compliant supported integrations and disclose gaps.
- No intrusive desktop automation or control of the user's mouse, keyboard, personal browser or unrelated repos; no unchecked remote shell. No duplicate global GPU scheduler, inference runtime, background supervisor or kill switch.
- Existing OpenMontage Production is designated to publish and own the **single** verified shared GPU lease/queue contract. Until published, don't invent endpoints or activate unattended GPU jobs. Gaming Hold, Stop, Emergency and ComfyUI activity are authoritative once the contract is proven.
- OpenCode + existing Ollama local models are preferred for routine engineering after real benchmarks; Codex/Claude/frontier services are optional, separately approved escalations. No surprise subscriptions or paid tokens.
- No secrets in commits, logs, handoffs or telemetry. Provider content and local agent transcripts need source-scoped IPC, explicit consent and minimal exposure.
- Preserve work in Git and durable project state. No force push, silent reset, destructive migration, direct push to `main`, or launch/pricing/spending decisions without owner approval.
- Mock/unit tests, offline Windows packaging, local real-host file tests and authenticated provider/agent acceptance are separate evidence categories. All 50 regression gates in `docs/quality/reliability-regression-register.md` remain mandatory and retain stable identifiers.
- Prefer mature, actively maintained OSS and provider SDKs to custom supervisors, session engines and integrations. Review compatibility, security and licensing before reuse.

## What exists as of 2026-10-29

- Existing Chrome extension on `main`; newer isolated Electron Windows portable preview (not a signed installer).
- Genuine webpage containers and one/two/stacked chat layouts in code; actual provider sign-in, model pickers, attachments, message continuity and compatibility on owner's Windows host **NOT VERIFIED**.
- Read-only discovery of local Claude Code/Codex sessions, recently added bounded last-message preview and a validated external-terminal resume path; authentic local-session behavior remains unverified.
- Bounded sync policy simulation with no automatic history scanning in current preview; reliability/regression tests, GitHub Actions offline Windows build.
- Provenance-aware handoff payload constructor and secret-pattern indicators, **not wired to a user-facing handoff UI or sending operation**.
- OpenCode+Ollama performed local engineering batches and GitHub commits; 89/89 local tests **reported** and Linux synthetic/Windows offline build workflows **verified green** at commit `5973109`. This is not authenticated-user acceptance.
- No live unified browser-chat history index in the desktop preview; no live embedded coding-agent stream; no released product; no proven commercial adoption.
- No verified cross-project OpenMontage GPU lease/queue API in the accessible repo evidence; no autonomous worker activated by this project.

## Definition of success and explicit stopping gates

**Feasibility Gate (G1/G2):** owner-tested real Windows accounts show normal native consumer chat functionality and correct project-bound local agent discovery/resume *without interfering with official apps*. If embedding is disallowed, investigate compliant alternatives within a bounded timebox; do not bypass OAuth. Stop/pivot if the core integration is not reliably achievable.

**Usable private-beta release:** after verified compatibility, deliver a clean install/update/restore experience, reliable project-linked workflows, accessible UI, security/privacy review, passing applicable P0 regressions on a real Windows host and a smooth end-to-end planning-chat → agent → project result experience. Show the user **one workflow demonstrably better** than current alternatives. Unimplemented features must not be marketed as complete.

**Commercial validation:** research/observe roughly 10–15 relevant potential adopters, test real demand and willingness to switch/pay, assess provider ToS/licensing/maintenance cost, and secure owner approval for pricing, launch and positioning. A negative result is a reason to pause/pivot—not an instruction to keep building decorative features.

**Release versus business success are different.** After release criteria pass, seek the owner's launch decision instead of endless internal polishing. After launch, measure activation, weekly useful sessions, completion of cross-app workflows, reliability/crash rate, retention, paid intent/revenue and support burden. Stop unfocused development when evidence is insufficient.

## Governance of changes

- **Local agent decides:** routine implementation, tests, safe refactors, bounded technical research, validation, branch commits and backlog ordering within this charter.
- **Owner decides:** major architecture, paid services/new costs, external production writes, business direction, licensing/distribution, account access, pricing/public launch, autonomous scheduling activation and GPU-controller operational changes.
- Agents may recommend updating product hypotheses when new evidence contradicts assumptions, but may not quietly change this permanent charter or redefine success to justify activity.
- Keep technical state, dependencies and next actions in `BACKLOG.md` and `RUN_STATE.json`. Keep rationale and material changes in `DECISIONS.md`. Retain the detailed research, original extension and 50-gate register as supporting history.
