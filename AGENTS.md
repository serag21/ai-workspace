# AI Workspace — instructions for local coding agents

These rules govern this **desktop experiment** and future work on this branch. The original Chrome extension remains on `main` and must not be broken or silently replaced.

## Mission (do not drift)

Build a dependable, appealing, potentially commercial **Windows desktop AI workbench** that uses genuine ChatGPT, Claude, and Gemini conversation experiences while integrating real local Claude Code/Codex sessions, project context, and trustworthy handoffs. The idea must be validated against Echoes and other competitors, not justified by decorative feature additions.

Core test: would a real user choose AI Workspace instead of Echoes + separate official coding-agent apps? If there is no evidence of a superior workflow, say so and change direction or stop.

## Required context (read before any implementation)

- `PROJECT_CHARTER.md` — permanent original product vision, scope, non-negotiables, release/business success criteria.
- `BACKLOG.md` — prioritized, independently executable READY tasks, dependencies and acceptance evidence.
- `DECISIONS.md` — owner-level decisions, rejected approaches, and why they were made.
- `RUN_STATE.json` — machine-readable current task, last verified result, safe checkpoint and next action.
- `.opencode/commands/advance.md` — native OpenCode `/advance` entrypoint. It is **invoked manually for now**; it is not a scheduler.
- `docs/local-first-development-charter.md` — earlier milestones and the detailed local-first execution history.
- `docs/shared-gpu-integration-readiness.md` — central GPU-controller ownership, this repo's current workloads, pause/resume limitations and future thin-adapter contract; no independent scheduler.
- `docs/desktop-pivot-research-2026-10-19.md` — market alternatives and decision gates.
- `docs/quality/reliability-regression-register.md` — all 50 mandatory quality gates; never silently remove one.
- `docs/desktop-preview-user-guide.md` — precise desktop preview limitations.
- GitHub issues #2 and #3 — provider interference and uncertain attribution.
- Inspect actual code in `experiments/desktop-spike` and `experiments/local-agent-probe`; don't infer features from marketing text.

## Implementation ownership

- **Local first:** OpenCode using the already installed Ollama runtime and measured high-quality local coding models is the ordinary developer. Use the existing shared GPU/resource arbiter rather than starting a new one.
- Local models presently available include `qwen3.8:27b`, `qwen3-coder:30b`, and `qwen3-vl:30b`. Prefer the strongest model demonstrated on representative coding and tool-use benchmarks; comparison is permitted, automatic downloads/installations are not.
- **Codex Cloud, Claude Code and paid APIs are optional escalations**, never required routine gateways or hidden fallbacks. Obtain specific consent before initiating paid calls or switching providers.
- GitHub holds durable state: commit meaningful changes on `spike/local-agents-desktop` only, add focused tests, and keep `docs/local-first-development-charter.md` up to date. No force pushes or direct merges into main.
- Keep human intervention to actual product approval, security, costs, authentication and physical-machine acceptance, not repetitive prompt relaying or command execution.

## Critical operational boundaries

- **Do not create, start, re-enable or modify Windows Scheduled Tasks, services, background supervisors, terminal polling loops, OS startup hooks or GPU schedulers.** The owner disabled flashing Director/Supervisor PowerShell processes; do not recreate them. No 15-minute popups, hidden terminals, or recurring local background actions.
- Initial execution is **manual foreground only** in the current OpenCode terminal. Before any autonomous worker/queue integration, locate and reuse the owner's existing shared local AI scheduler and its Game Hold / Stop / Emergency controls; obtain explicit approval before activation.
- Never use desktop mouse/keyboard control or personal browser automation. Do not touch credentials, cookies, token files, personal histories, or account settings except approved project-specific test fixtures.
- Do not compete with gaming, ComfyUI, or other local AI projects for the RTX 5090. Never load multiple large models concurrently just to run subagents. Yield or queue work when the shared GPU arbiter reports busy/hold.
- Do not automatically send provider prompts, upload files, push private code, buy services, or publish the app. Never bypass OAuth or embedded-browser restrictions.
- Stay within this repository. Never alter or launch scripts from unrelated projects. Avoid deleting or rewriting prior work; inspect `git status` before editing.
- Do not assert a test passed merely because a mock fixture passed. Distinguish synthetic CI, GitHub Windows build, and actual interactive Windows/provider/CLI end-to-end acceptance.

## Engineering map

- `experiments/desktop-spike/main.cjs`, `preload.cjs`, `index.html`: Electron Windows preview, genuine provider web panes, local-agent session inventory.
- `experiments/local-agent-probe`: bounded read-only discovery and optional Claude Agent SDK metadata.
- `experiments/desktop-spike/agent-actions.cjs`: explicit external terminal resume (not in-app live control).
- `.github/workflows/local-agent-spike.yml`: source / safety / regression tests.
- `.github/workflows/desktop-preview-windows.yml`: unsigned Windows x64 portable package and offline smoke.
- Original extension TypeScript/React lives at repo root, but is not the active product direction.

## Test commands (from project root)

- `node --test experiments/local-agent-probe/*.test.mjs`
- `node --test experiments/desktop-spike/*.test.mjs`
- `node experiments/desktop-spike/regression-report.mjs` (50-gate coverage report; synthetic only)
- For packaging, check the existing GitHub Actions Windows workflow. Do not call mocked tests real browser E2E.
- For extension changes only: `npm run typecheck`, `npm run test:smoke`, `npm run build` after dependencies are installed.

## Work cycle

1. Read the four durable state files, inspect branch/working tree/CI, and reconcile any stale run state with actual Git/test evidence. Preserve original product scope.
2. Choose a small, high-value, testable increment that does not require interfering with unrelated PC apps.
3. Implement, run scoped tests, inspect failures, fix, document honest limitations, commit to the isolated branch.
4. Update charter's **Last completed / Next / Blocked** notes and link commits/CI.
5. When a task is blocked by real Windows sign-in, CLI verification or an unpublished GPU lease contract, record the blocker and select the next meaningful **READY CPU-only** task in BACKLOG.md. Stop only if no safe valuable work remains, the configured budget ends, or release/product gates are reached; never invent filler work.
6. Do not keep scheduling or running silently when the user closes the terminal. Local inference stops with the local machine.

Do not overwrite this file with `/init` or generate a generic competing set of project instructions.

## Bounded autonomous continuation contract (added 2026-10-29)

- The owner wants development to resume **without copying a new prompt after every milestone**, not indefinite GPU utilization. Use OpenCode's native command and noninteractive run/session-continuation features, not a second custom supervisor.
- **No unattended local AI task is currently activated.** Future local scheduled execution is owned exclusively by the existing OpenMontage central worker after its real lease/queue contract and explicit owner approval, plus a quiet two-cycle recovery smoke. No invented endpoints, hidden PowerShell jobs or duplicate schedulers.
- Each approved bounded cycle has finite duration/retry/compute budget described in RUN_STATE.json. Do not start a GPU inference cycle unless the existing shared controller has authorized it; Gaming Hold and emergency controls always win. Committed Git state is the checkpoint—not an assumption that an in-flight model response survives reboot.
- Agent autonomy covers ordinary code/test/docs/branch commits; major architecture, security access, money, launch, pricing, publishing and product pivots stay with the owner. Avoid unbounded model benchmarks and speculative infrastructure.
- On each cycle: choose the highest-value ready task, implement/test it, commit evidence, update BACKLOG.md / RUN_STATE.json and a material DECISIONS.md entry if needed; present a short outcomes-only summary. If the product is ready for user acceptance, ask for **one meaningful milestone test**, not routine micromanagement.
- To check the contract offline before claiming progress: `node scripts/validate-autonomy-contract.mjs`. Tests: `node --test scripts/validate-autonomy-contract.test.mjs`.
