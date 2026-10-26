# AI Workspace — instructions for local coding agents

These rules govern this **desktop experiment** and future work on this branch. The original Chrome extension remains on `main` and must not be broken or silently replaced.

## Mission (do not drift)

Build a dependable, appealing, potentially commercial **Windows desktop AI workbench** that uses genuine ChatGPT, Claude, and Gemini conversation experiences while integrating real local Claude Code/Codex sessions, project context, and trustworthy handoffs. The idea must be validated against Echoes and other competitors, not justified by decorative feature additions.

Core test: would a real user choose AI Workspace instead of Echoes + separate official coding-agent apps? If there is no evidence of a superior workflow, say so and change direction or stop.

## Required context (read before any implementation)

- `docs/local-first-development-charter.md` — owner-approved local-first operating model and current handoff.
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

1. Inspect the branch, working tree, CI, project charter, quality gates and one meaningful user workflow.
2. Choose a small, high-value, testable increment that does not require interfering with unrelated PC apps.
3. Implement, run scoped tests, inspect failures, fix, document honest limitations, commit to the isolated branch.
4. Update charter's **Last completed / Next / Blocked** notes and link commits/CI.
5. Stop when blocked by missing real Windows sign-in/CLI verification; record exactly the smallest approval/test needed instead of pretending it was completed or introducing unsafe workarounds.
6. Do not keep scheduling or running silently when the user closes the terminal. Local inference stops with the local machine.

Do not overwrite this file with `/init` or generate a generic competing set of project instructions.
