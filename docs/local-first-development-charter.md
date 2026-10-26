# AI Workspace — local-first developer handoff and living execution board

**Owner decision: 2026-10-25.** Source of truth for the OpenCode/Ollama implementation phase. Update this document with dated evidence as work proceeds. Keep the previous research and 50-gate quality register intact.

## Why the ownership changed

The owner no longer wants ChatGPT Scheduled Tasks, Codex Cloud or Claude Code to be mandatory daily coding intermediaries. Local OpenCode + Ollama on the RTX 5090 will perform routine implementation, debugging, review and tests. Paid/frontier tools are optional escalations where measured improvement justifies them, never implicit dependencies.

**The ChatGPT daily AI Workspace Development task has been disabled 2026-10-25.** It had run Oct 23–25 and authored changes on `spike/local-agents-desktop`. It was cloud-side, not the cause of local Windows PowerShell popups. No additional Windows schedulers should be activated for this project.

Existing shared local setup (re-verify without overwriting): OpenCode 1.19.3, Ollama 0.40.6 at `127.0.0.1:11434`, local models `qwen3.8:27b` (current preferred coder), `qwen3-coder:30b` (comparison), `qwen3-vl:30b` (vision). The RTX 5090 has 32 GB VRAM. The separate shared GPU worker/arbiter has Stop / Hold / Emergency semantics. Do not install another Ollama, another OpenCode, another scheduler, or start competing processes. Local AI cannot run while the PC is off.

## End product and business validation

One genuine desktop workspace with independent/native provider chat panes, local coding-agent sessions, project grouping and trustworthy cross-agent project continuity. A single project can put a planning conversation alongside Claude Code/Codex state, test results, repo branch and an editable handoff. Baseline feature parity with Echoes is not enough: prove meaningful differentiation and willingness to switch/pay. Explicitly avoid a fake native chat UI or unreliable scraping/mass-sync loops.

## Current truthful implementation snapshot

- Chrome extension exists on `main`. It discovers browser tabs and text snapshots but does not satisfy the desired native desktop experience; do not resume extension-first feature work.
- Isolated Electron preview on `spike/local-agents-desktop`; one/two/stacked native provider WebContentsViews, independent same-provider panes, browser fallback, local Claude Code/Codex session inventory, explicit external-terminal CLI resume (not in-app live terminal).
- Windows CI produces a portable unsigned executable and runs an **offline** smoke test. Mocked Node/Electron tests run on CI. The newest known verified branch before this handoff: `42ef8ec` from 2026-10-25, green source and Windows builds; refresh actual HEAD/CI before acting.
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

### Last completed

Local-first handoff directives prepared and committed to GitHub; awaiting first foreground OpenCode run on the owner's PC.

### Next

QW-001 local repository audit and test execution. Then QW-002 real Windows compatibility evidence without credentials in logs, followed by QW-003.

### Blocked

Cloud runner cannot access the owner's local OpenCode configuration, real Ollama GPU, signed-in native desktop apps, or private local Claude Code/Codex session files. Do not pretend to have tested them.
