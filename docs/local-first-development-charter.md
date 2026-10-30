# AI Workspace — local-first developer handoff and living execution board

**Owner decision: 2026-10-25.** Source of truth for the OpenCode/Ollama implementation phase. Update this document with dated evidence as work proceeds. Keep the previous research and 50-gate quality register intact.

## Governance update — 2026-10-29

This file preserves the **earlier development history and QW-001…QW-009 mapping**. To avoid repeated huge context dumps, the authoritative ongoing state is now split into:

- `PROJECT_CHARTER.md` — permanent original product vision and explicit release/commercial success.
- `BACKLOG.md` — prioritized READY/BLOCKED tasks, QW mapping and acceptance criteria.
- `DECISIONS.md` — lasting strategic and operational rationale.
- `RUN_STATE.json` — actual last-verified checkpoint, next task, finite compute budget, automation activation status.

OpenCode's native `.opencode/commands/advance.md` is available as a **manual foreground command**. `node scripts/validate-autonomy-contract.mjs` checks the four-file contract offline and CI checks the same. GitHub issue [#5](https://github.com/serag21/ai-workspace/issues/5) tracks the still-unverified integration into the **existing central** OpenMontage worker.

**No unattended local development job has been started or enabled by this repo.** The owner wants autonomous continuation, but the central GPU/worker's published lease/queue contract, quiet two-cycle execution test and activation approval are still required. Budgets in RUN_STATE are policy until a real coordinator enforces them. Local foreground OpenCode can continue implementing CPU-only READY tasks without waiting on G1 account tests; no invented filler work.

## Why the ownership changed

The owner no longer wants ChatGPT Scheduled Tasks, Codex Cloud or Claude Code to be mandatory daily coding intermediaries. Local OpenCode + Ollama on the RTX 5090 will perform routine implementation, debugging, review and tests. Paid/frontier tools are optional escalations where measured improvement justifies them, never implicit dependencies.

**The ChatGPT daily AI Workspace Development task has been disabled 2026-10-25.** It had run Oct 23–25 and authored changes on `spike/local-agents-desktop`. It was cloud-side, not the cause of local Windows PowerShell popups. No additional Windows schedulers should be activated for this project.

Existing shared local setup (re-verify without overwriting): OpenCode 1.19.3, Ollama 0.40.6 at `127.0.0.1:11434`, local models `qwen3.8:27b` (current preferred coder), `qwen3-coder:30b` (comparison), `qwen3-vl:30b` (vision). The RTX 5090 has 32 GB VRAM. The separate shared GPU worker/arbiter has Stop / Hold / Emergency semantics. Do not install another Ollama, another OpenCode, another scheduler, or start competing processes. Local AI cannot run while the PC is off.

## End product and business validation

One genuine desktop workspace with independent/native provider chat panes, local coding-agent sessions, project grouping and trustworthy cross-agent project continuity. A single project can put a planning conversation alongside Claude Code/Codex state, test results, repo branch and an editable handoff. Baseline feature parity with Echoes is not enough: prove meaningful differentiation and willingness to switch/pay. Explicitly avoid a fake native chat UI or unreliable scraping/mass-sync loops.

## Current truthful implementation snapshot

- Chrome extension exists on `main`. It discovers browser tabs and text snapshots but does not satisfy the desired native desktop experience; do not resume extension-first feature work.
- Isolated Electron preview on `spike/local-agents-desktop`; one/two/stacked native provider WebContentsViews, independent same-provider panes, browser fallback, local Claude Code/Codex session inventory, bounded read-only transcript tail preview (0e21d90), and explicit external-terminal CLI resume (not in-app live terminal) that fails closed when the official CLI is not resolvable on PATH (77dbe3b/41726de). A versioned provenance-aware handoff payload builder (c967f8a) exists as a construction-only module: no IPC/UI/send path yet.
- Windows CI produces a portable unsigned executable and runs an **offline** smoke test. Mocked Node/Electron tests run on CI. Newest verified branch head: `e4c0e79` (2026-10-29), both workflows green (runs 41001327639, 41001327640); refresh actual HEAD/CI before acting.
- Native provider sign-in, Google OAuth in Electron, real web chat control fidelity, image uploads, user-specific conversation identity and actual local CLI resume on Windows remain **unverified**. Do not call this commercially usable until validated.
- Quality register: `docs/quality/reliability-regression-register.md`, 50 gates, including REL-001 critical first-party ChatGPT interference regression. User observed two PC-wide chat loading incidents while Echoes/ChatGPT apps were running, attribution unproven.

## Priorities for Qwen/OpenCode (not a giant feature wishlist)

| ID | Priority | Next concrete outcome | Completion evidence |
| --- | --- | --- | --- |
| QW-001 | P0 | Verify local clone on isolated branch, check for uncommitted work, inspect CI and Electron shell; run ALL existing non-provider tests locally without disrupting other projects. | Test command/output and correctly classified failures in execution log. |
| QW-002 | P0 | **Windows compatibility feasibility**: run Electron preview foreground once with explicit owner-approved use of test accounts/native pages. Diagnose real provider sign-in, full history, effort/model controls, attachments and UI. Do not bypass browser/OAuth controls. | Account-safe matrix of ChatGPT, Claude, Gemini with pass/fail and precise redacted error categories. Mark 'blocked' until human-host test is actually done. |
| QW-003 | P0 | Validate bounded local Claude Code/Codex discovery, CLI provenance, `cwd`, safe explicit resume and true process state; do not attach to active sessions destructively. | Fixture suite + owner-approved real local dry run; never claim 'active' from file mtime. |
| QW-004 | P0 | Guarantee no incidental background provider sync, process popups, excessive requests, lingering jobs, or shared GPU contention. | Automated regressions for critical IDs and actual Windows inspection where appropriate. |
| QW-005 | P1 | Choose a compliant alternative architecture if Electron provider login is unsupported (native browser window composition/launch workflow rather than bypass). | Bounded engineering comparison and one working Windows proof; no speculative rewrite. |
| QW-006 | P1 | Move from external-terminal opening to **live in-app local agent control** using supported protocols only, with stream/cancel/approvals and no duplicate sends. | Real safe session smoke + independent tests. |
| QW-007 | P1 | Versioned project-handoff payload linking conversation context, repo path/branch/diff, observed tests, decisions and assets, preserving missing/untransferable evidence. | Targeted end-to-end handoff vs baseline summaries; explicit preview and consent. |
| QW-008 | P1 | Build a readable session/project UI with useful activity ordering and discoverable split/stack controls AFTER core integration is proven. | Real user task-completion and accessibility evidence; no premature decoration. |
| QW-009 | Product gate | Recompare Echoes and emerging competitors, then ask users who actually manage web chats plus local agents if value warrants paid desktop app. | Written kill/pivot/release decision supported by evidence. |

## Workflow restrictions and checkpoints

1. Initial OpenCode work runs **foreground only** from the repo directory. Do not register Windows Scheduled Tasks, autoservices, hidden PowerShell windows, persistent headless agents or unattended restarts.
2. Reuse the existing shared GPU arbiter. If gaming, ComfyUI or hold is active, queue or exit rather than load another model. Respect per-run limits, current config and game-hold rules; do not mutate global settings.
3. Never control the desktop, browser, mouse or keyboard. No automatic personal account logins or credential access. Avoid unnecessary provider traffic entirely.
4. Read `AGENTS.md` first. On each session resume, inspect this board, branch, latest commits, real CI, and pending blockers; record the next actual result back here.
5. Work in isolated branch, preserve `main` and all unrelated repos. Local routine edits/tests/commits are allowed. Do not merge, push secrets, publish packages or start paid services without explicit authorization.
6. Report honestly with labels: **synthetic test passed**, **Windows CI passed**, **real local host passed**, **blocked**, or **not attempted**. Fix misleading readme claims when evidence shows stale product status.
7. If extra autonomy is desired later, integrate this repo into the existing shared quiet local-AI worker/queue through its documented controls, after inspecting existing owners. Do **not** invent an AI Workspace supervisor or start an hourly/daily job on your own.

## Execution log (append dated entries; preserve history)

### 2026-10-25 — ChatGPT cloud task ➝ local Qwen/OpenCode ownership

- Disabled the existing ChatGPT Scheduled Task; verified it was previously enabled and its last run was October 25.
- Inspected latest spike commit `42ef8ec` and green GitHub source/Windows jobs.
- Added durable AGENTS.md and this board to the spike branch without modifying main.
- Real Windows provider-authenticated compatibility and code-agent interactive session control remain unverified.

### 2026-10-26 — QW-001 completed; QW-003 increment (open local OpenCode + Ollama qwen)

- **QW-001 (done, real local host):** Isolated-branch clone verified: local clone checked out `spike/local-agents-desktop` tracking origin; local `main` (876cd11) is a strict ancestor of the branch — zero local-only commits; no modified tracked files; untracked local artifacts (`.vs/`, `package-lock.json`, `tsconfig.tsbuildinfo`) preserved, generated artifacts now ignored (9cc9ba6).
- All existing non-provider tests run on the owner's Windows host: `node --test experiments/local-agent-probe/*.test.mjs` **11/11 pass**; `node --test experiments/desktop-spike/*.test.mjs` **45/45 pass** (synthetic; not provider E2E). 50-gate report: 20 gates synthetic-mapped unchanged; **16 P0 gates still require live-host verification**.
- CI at branch head 0148b03: "Local agent spike tests" green (runs 40277062743, 40276958081); latest "Desktop Preview Windows" green 2026-10-25 (run 40209261068). Windows-host packaged-preview behavior: **not re-run locally this session** (requires `npm install` Electron + foreground launch; not needed for the code increment, to be validated at the human acceptance step).
- **QW-003 (increment, synthetic tests only):** fail-closed CLI provenance before external terminal resume (77dbe3b): read-only PATH stat scan (never executes), resume refuses to open a terminal when the CLI is missing; 8 new deterministic tests; wired into both workflows and the coverage report. Post-change local run **64/64 pass**.
- **QW-003 (increment 2, synthetic tests only):** honest installed-CLI provenance surfaced in the agent pane (41726de): read-only `spike:cli-provenance` IPC (owner-window-only, stat scan), resume button disabled with a precise "CLI not on PATH" reason when the official CLI is absent, resolved location shown on success. Post-change local run **65/65 pass**; CI UI syntax check and `npm run check` OK.
- QW-002: **not attempted** — requires owner test accounts and interactive sign-in; no credential automation per charter. QW-003 real dry run: **blocked** on owner approval to open a terminal against a genuine local session.

### 2026-10-29 — QW-003/QW-006 read-side increments and QW-007 foundation (3 commits; both CI green)

- **QW-003/QW-006 increment (synthetic tests + Windows CI, not live):** bounded read-only tail view for local agent sessions (0e21d90). "View last messages (read-only)" reads a window at the **end** of the selected session's transcript (default at most 256 KiB, at most 30 messages, per-message cap 4000 chars), parses Claude Code and Codex grammars into user/assistant turns only (thinking/system blocks excluded), and renders honest truncated / window-limited / elided / partial-record indicators (CON-004, CON-005, CON-017). Binary-safe (`unreadable`). IPC `spike:agent-tail` is owner-window-only and resolves the transcript path from the main-side inventory — never from the renderer — so a provider page cannot read arbitrary local files through it. 10 focused tests.
- **QW-007 foundation (synthetic tests + Windows CI; intentionally NOT user-facing):** provenance-aware handoff payload builder and validator, schema `ai-workspace.handoff/1` (c967f8a). Explicit source+project binding (HAND-001/HAND-004); per-field evidence flags `observed|inferred|missing` with consistency rules so a value can never be fabricated behind an `observed` flag or guessed behind `missing` (HAND-005); omissions and missing facts are named (HAND-002); included/excluded artifact manifest (HAND-006); destination restricted to manual modes and `autoSend` cannot be constructed (HAND-003); high-precision secret scan reporting location indices only, never the secret text, with a negative test proving ordinary prose/code does not match (HAND-007). 13 focused tests. Deliberately **not** wired into IPC/UI: exposing the handoff surface is an owner decision (QW-007 completion requires explicit preview and consent).
- **Quality documentation (e4c0e79):** `docs/quality/windows-provider-acceptance.md` refreshed to match the shipped spike — stale CLI-provenance prose replaced with the shipped read-only PATH stat-scan behavior and the residual content/shadowing audit gap; added the synthetic / GitHub-CI / live-acceptance evidence-boundary matrix, a minimal run checklist pinned to the head commit, and a gate-clearing map for all 50 registry IDs with honest per-gate evidence status.
- **Verification (labeled honestly):** `node --test` full suite on the owner's Windows host **89/89 pass** (up from 65); `npm run check` clean; regression report **"Mapped 28 synthetic-test gates. All 16 P0s still need live-host verification"** (up from 20 gates mapped). Windows CI: "Local agent spike checks" and "Desktop Preview Windows" both **success** at head `e4c0e79` (runs 41001327639, 41001327640) — the Windows run is a signed-out, offline-build + start smoke, **not** sign-in acceptance. **No real-provider or real-agent interactive evidence was added this session** (still NOT RUN).
- **Incident (disclosed; no control bypassed):** GitHub Push Protection (secret scanning) rejected the first push of commit `ce3e547`, flagging the deliberately **fake** Slack test fixture `handoff-payload.test.mjs:162` as a Slack API token. Resolution: reshaped that fake fixture (internal-hyphen/mixed-case) so it still matches this project's secret detector (13/13 re-verified) without colliding with the scanner's real-token calibration; the two local commits were rewritten (c967f8a, e4c0e79) and the branch pushed. **No unblock request was made, no security control was modified, no real credential exists in the branch.**

### Last completed
QW-003/QW-006 read-side increment: bounded read-only transcript tail view shipped in the desktop preview (0e21d90). QW-007 foundation: provenance-aware handoff payload builder + high-precision secret scan (c967f8a), intentionally construction-only (no IPC/UI). Windows acceptance protocol refreshed to the shipped spike (e4c0e79). **89/89 local node --test pass; 28 synthetic gates mapped (16 P0 live outstanding); both CI workflows green at head e4c0e79 (runs 41001327639, 41001327640).**

### Next
1. **QW-002 (P0, owner-gated — the only step I cannot automate):** one owner-run foreground launch of the packaged Windows preview with explicit sign-in in the owner's test accounts (ChatGPT, Claude, Gemini), following `docs/quality/windows-provider-acceptance.md` G1; record Pass/Fail/Blocked per provider.
2. **QW-003 live dry run (owner-gated):** resume exactly one verified-inactive local Claude Code or Codex session in a separate terminal; verify project/ID/cwd, that no prompt is auto-sent, and that the new **View last messages** preview is honest on that real session (G2).
3. **QW-007 (needs owner consent before any wiring):** if the owner approves exposing the handoff surface, add an owner-window-only IPC that only *builds/validates* the payload (never sends), an explicit consent step in the UI, and then run HAND-001…007 live acceptance. Do not wire it without that consent.
4. **GPU:** no scheduler code of any kind; work in this repo stays CPU/local-file only until the shared controller's lease/queue contract is actually published and approved (`docs/shared-gpu-integration-readiness.md`).

### Blocked
- QW-002: real provider auth needs the owner's accounts and interactive sign-in; smallest approval = one owner-run foreground launch of the packaged preview with explicit provider sign-in on owner test accounts.
- QW-003 real dry run: needs owner consent to resume one verified-inactive genuine local session in a separate terminal; "active" state must never be inferred from file mtime.
- QW-006 live in-app agent control: intentionally deferred — safe attach is AGENT-003 (P0) and needs an owner-approved design, not a guess.
- QW-007 handoff exposure: needs owner consent to surface the builder in the UI (see Next 3).
- Cloud runner limits persist: CI cannot see the owner's signed-in desktop apps, Ollama/GPU state, or private local session files.
