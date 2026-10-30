# AI Workspace — real Windows provider/agent acceptance protocol

**Status: NOT RUN (as of 2026-10-29).** This is a manual evidence protocol for the isolated desktop spike, **not** an assertion that embedded login, provider controls or live local agents work. No credentials, chat contents, cookies, OAuth codes or private repository files should be captured in test evidence.

This document deliberately separates three evidence tiers and never conflates them:

1. **Synthetic** — `node --test` with fixtures and mocks, run locally and in CI. Proves code behavior against a defined contract. Does not prove Windows, provider or GPU behavior.
2. **GitHub-hosted CI** — the two branch workflows: synthetic tests (Linux runner) and a Windows build + `--offline-smoke` (packaged app starts without provider traffic). This is **not** a sign-in test and **not** interactive acceptance.
3. **Live acceptance** — a human, on the owner's Windows 11 host, using a disposable provider conversation and a disposable local agent session. **Only this tier can clear a P0 gate.**

## What CI can and cannot prove (automatable vs human boundary)

| Area | CI can establish (synthetic) | A human on the real Windows host must |
| --- | --- | --- |
| Provider sign-in, OAuth popups, session persistence (G1) | Nothing authenticated — by design | Run G1 steps 1–7 per provider |
| Native thread/attachment/picker behavior | Nothing provider-side | Verify against the official provider UI |
| Provider interference (REL-001, issues #2/#3) | Nothing — the spike makes **zero** provider traffic | Verify official browser behavior before/during/after the preview |
| Local inventory correctness (AGENT-001) | Fixture-based discovery; worker-pool ordering/concurrency | Verify against real Claude Code/Codex histories on this machine |
| Transcript tail honesty (CON-004/CON-005) | Tail-window read, caps, truncation flags, binary safety | Read a real session's preview and confirm indicators |
| CLI provenance before resume (AGENT-002) | PATH stat-scan semantics; fail-closed on PATH fixtures | Confirm the expected official CLI actually launches and identifies the intended session |
| Resume never auto-sends (CON-008) | No send/upload code path; `autoSend` cannot be constructed | Watch the opened terminal: no prompt is auto-sent |
| Handoff payload (HAND-001…007) | Build/validation/secret-scan contracts | Consented real cross-provider run — only **after** the builder is exposed in the UI (it is not, today) |
| Packaging | Unsigned x64 build + offline smoke on a CI runner | Run the artifact on the owner's host |

## Entry conditions

- Use only an **unsigned, private preview artifact from a successful Windows workflow on the exact branch commit under test**. Confirm the GitHub Actions run's head SHA and verify the archive is from the intended repository. Do not treat CI's `--offline-smoke` as a signed-in browser test.
- Use an expendable, non-sensitive provider conversation and a disposable local coding repository/session for the first test. Keep official browser/desktop provider apps available as independent controls.
- Do not copy Chrome cookies, extract tokens, modify user-agent strings to evade authentication controls, use undocumented provider APIs, or perform mass history requests.
- Stop if official provider conversations become unavailable, unexpected repeated requests occur, or the app accesses an unrelated project. Capture only timestamps, high-level symptoms and redacted error classes.

## G1 — real native webpage compatibility (ChatGPT, Claude, Gemini)

For **each provider**, record the app version, Windows version, provider, exact tested UI feature and result as **Pass / Fail / Blocked / Not tested**:

1. Start the app with the official browser's existing chat open. Verify the official chat remains usable; open a *different* expendable conversation in the preview.
2. Attempt **normal provider sign-in** within the embedded page, without bypasses. Record whether it succeeds or whether popup/OAuth/embedded-browser policy blocks it. If blocked, stop that provider's embedded-login test and use the **Open in browser** fallback. The preview now displays a per-pane diagnostic: **Loading**, **Page rendered**, **Load failed** (numeric network error code only), or **Popup blocked**. Record the observed status and numeric code if present; never record callback URLs, login parameters, cookies or credentials. **Page rendered does not mean authenticated.** Popup requests are still denied in this prototype; the diagnostic is evidence of a limitation, not a popup-login fix.
3. If signed in: verify native history, reopen a specific existing thread, navigate to another thread and back, send one harmless prompt, observe a reply, and check the model/effort picker **if that provider/account offers it**.
4. Test native attachment selection with a harmless tiny text/image file, without uploading private files; record whether it completes. Check native scrolling, artifacts/previews if available, and keyboard input.
5. Open a second pane with a *different thread from the same provider*. Verify both remain independently navigable and that actions in one pane do not silently replace the other. Repeat with two different providers.
6. Quit/restart and confirm login state and thread identity where supported. Check that official browser/desktop sessions continue functioning during and after the preview.
7. Test the browser fallback while on an existing thread: it should open **the same recognized thread** without carrying query/fragment data. On a login/callback/unrecognized path, it must open only the provider homepage. If the URL format is not recognized, report the path **shape only** (replace identifiers with `<id>`).

**G1 pass** requires usable normal login and native conversation controls for the target providers, persistent sessions, two independent panes, and no first-party interference. A successful static page render, offline Windows smoke, or a mock test is **not** a G1 pass. A provider refusing embedded login is a product architecture decision point, not a reason to bypass its safeguards.

## G2/G3 — genuine local Claude Code/Codex acceptance

1. In the Windows host, select one known *closed/inactive* Claude Code session and one known *closed/inactive* Codex session from a disposable project. Compare displayed provider, UUID, project path, branch and last update with official local tools. Treat active status as **unknown** until verified from an official process/event source.
2. Refresh the inventory and verify no duplicates or unrelated project identities appear. Verify that no prompts are sent by inventory refresh.
3. For one **known inactive** disposable session only, explicitly confirm **Resume in Windows terminal**. Verify the CLI opens in the expected working directory and identifies the intended session; verify no prompt is auto-sent. Close the terminal. Do not resume an already-running session.
4. Confirm no agent process is silently owned or terminated by the desktop preview. Check that exiting the preview does not stop a pre-existing independent agent.
5. Mark live in-app streaming, approval handling and attach-to-active-session **Not implemented** unless separately demonstrated; opening an external terminal does not satisfy G3.

## G2 reliability — large local inventory, safe resume, bounded transcript preview, handoff builder

The read-only discovery implementation now limits concurrent transcript metadata reads to **12**. Synthetic tests verify that its worker pool respects a concurrency ceiling and preserves result order; they do **not** prove acceptable Windows disk latency or handle usage.

On a Windows host with a representative existing Claude Code/Codex history, measure the time to first inventory, a second refresh, UI responsiveness while refreshing, and whether the official clients remain usable. Record only elapsed time, session counts and coarse CPU/memory/handle observations—not transcript text, paths or account identifiers. Repeat with a large disposable fixture if feasible; do not manufacture or overwrite actual agent histories. Treat excessive latency, UI hangs, open-file errors or unexpected process launches as failures requiring remediation.

**Pre-action CLI provenance (shipped; supersedes the earlier project-directory shadow check).** Before a resume action runs, the main process resolves `claude`/`codex` the way Windows `cmd.exe` searches `PATH` (directory order, then PATHEXT extensions) using a **filesystem stat scan only** (`cli-provenance.cjs`). It never executes the resolved program, sends no prompt, and makes no network calls. If the CLI is absent, **Resume in Windows terminal is disabled** and the reason is stated explicitly in the UI: *"Resume refused right now: the … CLI was not found on this machine's PATH. Install the official CLI first."* This is a **synthetically tested, fail-closed mitigation — not a complete provenance audit.** Residual gaps to close in live acceptance: (a) a shadow/alias executable *earlier* on PATH still resolves first, and the scan does not verify executable content, signature, or publisher; (b) `ComSpec`/shell resolution of the spawned child is not audited. Verify on Windows that the expected official CLI actually launches and identifies the intended session before trusting the feature.

**Resume spawn semantics.** The resume action waits for the operating system's child-process spawn acknowledgement before reporting a launch. Synthetic tests cover asynchronous ENOENT errors, early exit and missing acknowledgement; these do **not** establish that the CLI authenticated, selected the intended session or remained running. A successful spawn is only a process-start observation, not proof of session resume.

**Not a safe attach (AGENT-003).** The resume button is not safe attachment to an active process. The app cannot currently prove session ownership or activity status. Only test on a known inactive disposable session after confirming the project and reading the warning; never use an actively running session to validate resume. A CLI can potentially continue its own pending work even though the app sends no prompt.

**Bounded transcript preview (shipped commit `0e21d90`).** The preview's **View last messages (read-only)** button loads a bounded window at the **end** of that session's local transcript file (default at most 256 KiB, at most 30 messages, per-message text capped at 4000 chars), parsed into user/assistant turns only; thinking/system blocks do not surface. Truncated, window-limited, elided and partial-record conditions must be visible as indicators (CON-017 honest states). The transcript path is always resolved from the main-side local inventory — never from the renderer — and the channel rejects non-owner windows. Live acceptance must confirm: (1) only the selected session's text is shown; (2) truncation indicators appear honestly on a long real session; (3) no agent process is launched, no file is modified, and no network traffic is sent; (4) the official Claude Code/Codex clients remain unaffected. This is a **preview** (CON-004), not full-chat parity, and it is not an agent-status source (AGENT-005: active state is never inferred from file modification time).

**Handoff payload builder (shipped construction-only; NOT user-facing).** `handoff-payload.cjs` (schema `ai-workspace.handoff/1`) builds and validates a bounded, provenance-aware handoff payload: explicit source and project binding (HAND-001/HAND-004), per-field evidence flags `observed|inferred|missing` with consistency rules so claims can never be fabricated (HAND-005), explicitly named omissions instead of silent drops (HAND-002), an included/excluded artifact manifest (HAND-006), destination restricted to manual modes with `autoSend` unconstructable (HAND-003), and a high-precision secret scan that reports matched locations but never the secret text (HAND-007). As of this document's revision it is wired to tests and CI **only** — there is no IPC channel, no UI affordance, and no send/upload path. **No HAND gate may be claimed as live-evidenced.** When and if the owner consents to exposing it in the UI, a full HAND-001…HAND-007 live acceptance pass against disposable conversations must complete before any cross-provider use.

## REL-001 / issue #3 — first-party interference control

Run normal provider conversations in the official browser while the preview starts, switches providers, displays two panes, refreshes local metadata and quits. Check before/during/after behavior without spamming retries. If the failure reported on October 19 recurs, change **one** competing app/extension at a time, record which change first restores the browser, and avoid claiming a cause without isolation. Never export raw network headers or session data.

## Minimal run checklist (revised 2026-10-29, branch head `ce3e547`)

From the repository root on the owner's Windows host (PowerShell 5.1: separate statements with `;`, not `&&`):

```powershell
node --test experiments/desktop-spike/*.test.mjs experiments/local-agent-probe/*.test.mjs
node experiments/desktop-spike/regression-report.mjs
cd experiments\desktop-spike; npm run check
```

Expected at this commit: **89/89 tests passing**, `npm run check` clean, and the regression report printing **"Mapped 28 synthetic-test gates. All 16 P0s still need live-host verification."** (Both numbers move when tests are added; the live P0 shortfall must never shrink without a live run.)

Then push the branch (or wait for the run on that exact head SHA) and require **both** workflows green:

- `Local agent and desktop spike checks` (Linux runner: discovery, SDK adapter mocked, sync policy, resume, provenance, tail view, handoff builder — all synthetic);
- `Desktop Preview Windows` (Windows runner: builds the unsigned x64 package and runs it once with `--offline-smoke`, no provider traffic).

Download only the `AI-Workspace-Preview-Windows-x64` artifact of that successful run. **`--offline-smoke` is not a sign-in acceptance.**

Only then run G1, then G2/G3 on the owner's host with disposable accounts, conversations and local sessions, recording each feature as **Pass / Fail / Blocked / Not tested** in the record below.

## Gate-clearing map (registry → current evidence)

Legend: **Synthetic** = fixture/mock tests pass locally and in CI (code behavior only, never live evidence); **Live** = a human acceptance step in this protocol; **Not user-facing** = the module exists but is unreachable from the UI.

### REL — reliability / interference
| Gate (priority) | Live acceptance that clears it | Status 2026-10-29 |
| --- | --- | --- |
| REL-001 (P0) | Official provider chats remain fully usable while the preview runs (issue #2) | **No live evidence** — protocol NOT RUN |
| REL-002 (P0) | No implicit provider sync on start/provider switch | Synthetic support; live: G1 steps 1/2 |
| REL-003 (P0) | Rate-limit honored (no aggressive retry/heat) | Synthetic support; live requires a throttled provider run |
| REL-004 (P0) | Stop takes effect immediately | Live (final product: sync surface; not exercisable in current spike) |
| REL-005 (P0) | Explicit per-provider request budgets | Live (final product: sync surface; not exercisable in current spike) |
| REL-006 (P1) | Clear re-auth failure states per provider | Live: G1 step 2 outcomes |
| REL-007 (P1) | Browsing UI is side-effect-free | Synthetic support; live: G1 steps 5/6 |
| REL-008 (P1) | Account isolation (no cross-account crosstalk) | Synthetic (partitioned sessions); live: G1 step 6 |
| REL-009 (P1) | Launch/resource budgets, no freeze | Live: G2 latency/refresh measurements |
| REL-010 (P0) | Crash recovery of workspace/sessions | Live (final product; current spike has no persistence claim) |
| REL-011 (P1) | Connect failure states, no infinite loop | Live: provider sign-in outcomes |
| REL-012 (P1) | Provider feature parity where claimed | Live: G1 steps 3/4 |
| REL-013 (P0) | Embedded-content isolation; no credential capture | Synthetic (sandbox/no nodeIntegration); live: G1 with account credentials present |
| REL-014 (P0) | Quit stops all work; no survivors | Live: process/handle check before and after quit (G2 step 4) |
| REL-015 (P1) | Distinct auth/rate-limit/network/offline states | Synthetic; live: G1 observed statuses |

### CON — conversation fidelity
| Gate (priority) | Live acceptance that clears it | Status 2026-10-29 |
| --- | --- | --- |
| CON-001 (P0) | Reopen the *same* thread, never a new chat | Synthetic (canonical URL validation); live: G1 step 7 |
| CON-002 (P0) | No bogus titles from body text | Live: G1 observed titles |
| CON-003 (P1) | Honest last-activity ordering | Live: G1 step 6 |
| CON-004 (P1) | Preview shows latest complete turns with honest truncation | **Synthetic** (bounded tail view, capped); live: tail-view acceptance items |
| CON-005 (P1) | Latest turns accessible, long messages readable | **Synthetic** (caps + elision flags); live: tail-view acceptance items |
| CON-006 (P1) | Native provider controls available | Live: G1 steps 3/4 |
| CON-007 (P1) | No false cross-client draft sync claims | Live (final product; not claimed by spike) |
| CON-008 (P0) | Exactly-once attempt; no auto-resend/duplicate prompts | Synthetic (resume sends nothing; `autoSend` unconstructable); live: G2 step 3 |
| CON-009 (P1) | No silent overwrite of a fuller conversation | Live (final product; not claimed by spike) |
| CON-010 (P1) | No unsaved-context loss on close | Live (final product; not claimed by spike) |
| CON-011 (P1) | Precise search highlighting | Live (final product; not claimed by spike) |
| CON-012 (P1) | History import progress/cancellation | Live (final product; not claimed by spike) |
| CON-013 (P1) | Saved folders survive upgrades | Live (final product; not claimed by spike) |
| CON-014 (P1) | Scannable history layout | Live (final product; not claimed by spike) |
| CON-015 (P2) | Layout modes discoverable | Live: G1 step 5 (two panes) |
| CON-016 (P1) | Correct account/thread identity per pane | Live: G1 steps 5/6 |
| CON-017 (P1) | Honest terminal states (Working/Wait/Failed) | Synthetic (status strings + tail indicators); live: G1 step 6 |

### HAND — cross-provider handoffs
| Gate (priority) | Live acceptance that clears it | Status 2026-10-29 |
| --- | --- | --- |
| HAND-001 (P0) | Source+project binding explicit, unrelated content never mixed | **Synthetic** (builder contract); builder **not user-facing** — no live evidence |
| HAND-002 (P1) | Complete/marked summary; omissions named | **Synthetic** (summary-survives + omissions); **not user-facing** |
| HAND-003 (P1) | Manual destination only; no auto-send | **Synthetic** (`autoSend` unconstructable); **not user-facing** |
| HAND-004 (P1) | Same-named projects disambiguated by repo identity | **Synthetic** (`bindingComplete`); **not user-facing** |
| HAND-005 (P1) | Branch/test/decisions carry over with flags | **Synthetic** (evidence-flag rules); **not user-facing** |
| HAND-006 (P1) | Artifact manifest honest (included vs excluded) | **Synthetic** (manifest tests); **not user-facing** |
| HAND-007 (P0) | Secrets flagged before handoff, never leaked | **Synthetic** (high-precision scan); **not user-facing** |

### AGENT — local coding agents
| Gate (priority) | Live acceptance that clears it | Status 2026-10-29 |
| --- | --- | --- |
| AGENT-001 (P0) | Real local (not cloud) sessions discovered correctly | Synthetic (fixtures + worker pool); live: G2 steps 1–2 on real histories |
| AGENT-002 (P1) | Resume a known inactive local session | **Synthetic** (fail-closed provenance + spawn semantics); live: G2 step 3 (needs owner-consented inactive session) |
| AGENT-003 (P0) | Never attach/duplicate an active session | Synthetic (no ownership claimed, nothing auto-sent); live: G2 steps 3–4 |
| AGENT-004 (P1) | Shared layout incl. agent preview (CON-004) | Synthetic (tail module + owner-only IPC); live: tail-view acceptance items |
| AGENT-005 (P1) | No mtime-inferred status claims | Synthetic (read-only, honest indicators); live: G2 step 1 |

### TRUST — trust/privacy
| Gate (priority) | Live acceptance that clears it | Status 2026-10-29 |
| --- | --- | --- |
| TRUST-001 (P0) | Exact local/remote dataflow published | Documented in this repo (read-only local reads; zero provider traffic in spike); owner review required |
| TRUST-002 (P1) | No coercive upgrade/paywall nags | Live: owner review of the UI (none present in spike) |
| TRUST-003 (P1) | Honest feature status/support path | Maintained in charter + this doc; owner review |
| TRUST-004 (P1) | Portable backups/recovery | Live (final product; not claimed by spike) |
| TRUST-005 (P1) | No secrets in prompts/logs/export | Synthetic (secret scan reports locations only, no text); live: review any captured artifacts |
| TRUST-006 (P2) | Complexity stays one-click | Live: owner usability review |

## Minimal redacted result record

| Field | Example |
| --- | --- |
| Build commit and Actions run | `<sha>`, `<run-id>` |
| OS / provider / action | Windows 11 / Claude / existing chat open |
| Result | Pass / Fail / Blocked / Not tested |
| Observation | OAuth popup blocked; no workaround attempted |
| Official browser before/during/after | OK / OK / OK |
| Evidence | Local timestamp, screenshot with chat contents/account details hidden |
| Next decision | Fix app / provider limitation: browser composition pivot / retest |

**Release rule:** Issue #2 and all P0 real-host gates remain open until evidence is collected. Issue #3 remains an investigation, not an Echoes root-cause finding. G1 failure on major providers triggers an OS-level browser-window composition feasibility study or product pause—not credential extraction, stealth scraping or synthetic-pass relabeling.
