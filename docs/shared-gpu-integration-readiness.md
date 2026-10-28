# AI Workspace — shared RTX 5090 integration readiness (2026-10-27)

**Status: requirements and preliminary inventory only. No global GPU controller API is defined here; do not implement a second controller, scheduler, arbiter, daemon, background process or kill switch.** The designated shared GPU-dashboard project is the sole owner of leases, game holds, emergency controls, prioritization, telemetry, and inter-project coordination. Local OpenCode/Ollama is the default development stack; paid frontier tools are opt-in escalation.

## 1. Repository and existing GPU-related files

- Repository: `serag21/ai-workspace`, development branch `spike/local-agents-desktop`.
- Primary code: `experiments/desktop-spike/{main.cjs,index.html,preload.cjs,agent-actions.cjs}`, `experiments/local-agent-probe/`; legacy Chrome extension lives on `main`.
- Project rules: `AGENTS.md`, `docs/local-first-development-charter.md`.
- Current tree does **not** include its own CUDA inference service, ComfyUI workflow, Ollama launcher, GPU lock, GPU lease client, task queue, or GPU-control dashboard. This is a source-tree observation, not an inspection of the owner's global Windows environment.
- Electron's WebContentsViews render websites and might use normal browser **GPU acceleration**; this is not an intentional 20–30 GB GPU inference job. Browser graphics acceleration must not be conflated with launching a local LLM.
- `agent-actions.cjs` launches existing Claude/Codex CLI in an external terminal only after user confirmation. It does not launch Ollama or ComfyUI, nor an autonomous background coding worker.

## 2. Workloads, launch path, and preliminary resource estimates

| Workload | Launcher | GPU demand | Notes |
| --- | --- | --- | --- |
| Repo inspection, Node tests, TypeScript, packaging, Git | Existing OpenCode tools / Node / GitHub Actions | **Normally CPU-only** | Some frontend build tasks consume considerable CPU/RAM, not large CUDA VRAM; CI packaging runs on cloud Windows runners |
| Local AI coding/review using `qwen3.8:27b` or `qwen3-coder:30b` | **Existing** OpenCode + Ollama stack, managed outside this repo | **High; model weights + KV cache may use tens of GB depending on quantization/context and CPU offload** | Exact GPU memory, CPU RAM, throughput, model lifetime, electricity must be **measured** from current Ollama model/context and host telemetry, not guessed or hardcoded |
| Local image/visual reasoning using `qwen3-vl:30b` (potential future optional testing) | Existing Ollama stack | **High if actually invoked** | No such automated workflow is currently implemented in AI Workspace |
| Native provider webpages in Electron | Electron's WebContentsViews | Low–moderate graphics, variable | Browser acceleration might consume some VRAM; monitor if resource usage matters; no local inference intentionally launched |
| Read-only local agent transcript discovery and SDK metadata | Node/Electron on demand | **CPU + disk only** | Bound scan fanout and file reads; never poll continuously |
| Future local summaries, embeddings, code indexing, multimodal handoffs | **Not implemented** | Unknown / may be high | Must register workloads with shared GPU controller only after contract exists |

**Do not put numeric VRAM requirements in executable policy until measured.** GPU usage of an Ollama session varies with exact model variant, quantization, context length, batch, model scheduling, competing processes, and CPU offload.

## 3. Pause, checkpoint, resume and safety

- Git repository work persists through Git commits, isolated branch, `AGENTS.md`, and the dated charter execution board; test output is reproducible.
- Foreground OpenCode tool work can normally stop at task boundaries; do not assume an in-progress model generation can be migrated or resumed exactly from a token checkpoint.
- When a GPU lease is unavailable, **queue the pending task in the designated shared queue** once a real contract exists. For now, do CPU-only repo/test/docs work and avoid launching or cold-loading new models.
- Before future GPU work starts, check shared controller state for gaming, ComfyUI, emergency stop, and explicit owner holds. Respect preemption at safe task boundaries, persist enough backlog state to retry idempotently; never kill Ollama, games, ComfyUI, or unrelated processes as a unilateral "cleanup".
- The desktop preview itself must not automatically launch an inference job, attach to an active agent, send a prompt, or leave a hidden worker running on exit.
- Failures and cancellation should save *task-level* state (inputs, logs excluding private data, commit/branch, attempted actions) without falsely promising exact in-progress sampling checkpoint restoration.

## 4. Conflicting workers, schedulers and monitors

- No project-local GPU scheduler or arbiter was found in the current AI Workspace source tree.
- Prior `AutonomousAgencySupervisor` and `AutonomousEngineeringDirector` scheduled tasks were reported **disabled** because interactive PowerShell windows interrupted the user's PC. This is user-reported host state, **not** a runtime inspection by this repository. Do not reactivate these jobs.
- The AI Workspace ChatGPT **cloud scheduled development** task was disabled 2026-10-25. It is unrelated to the local Windows shell popup mechanism.
- Ollama/OpenCode/global shared controller are external dependencies **owned by other projects**. Do not install duplicates, change global Ollama configuration, register competing tasks, or automatically assume the controller is already deployed.

## 5. Thin client integration after contract is available

1. Read the actual versioned controller client contract from its owning project; confirm namespace, lease scope, process identity, priority, TTL/heartbeat, hold and cancellation semantics, queue persistence, security boundaries, and what happens when controller is offline.
2. Implement only a **thin adapter** in AI Workspace. It must never create an independent global queue, controller daemon or dashboard. No speculative endpoints or undocumented JSON payloads.
3. Classify actions as `cpu-only` or `gpu-intensive`. CPU-only tasks may proceed without a lease; GPU-intensive tasks require a valid granted lease before invoking Ollama via OpenCode. Implement denial, queued, lost lease, and clean stop states.
4. Report actual local model/VRAM/CPU usage via existing controller telemetry (or explicitly approved passive diagnostics); do not add a second polling service.
5. Add synthetic adapter tests for no-lease-denied, gaming hold, ComfyUI hold, stop/emergency, timeout/offline, controller restart, queuing, and idempotent task resumption. Only then obtain approval for real-host GPU validation.
6. Ensure packaging and main Electron process do not inherit an implicit dependency on controller availability. The desktop app must remain usable for normal native chats and CPU-only session management when Ollama/GPU is unavailable.

## Next decision

**No GPU integration code should be authored until the real shared controller contract arrives.** Continue QW-002 (manual-account compatibility preparation), QW-003 (local agent safety), QW-004 (CPU-only reliability tests) and QW-005 (compliant browser-auth architecture feasibility) in the meantime. Do not create extra inference sessions to benchmark model choices while the owner is tuning OpenCode/Ollama.

Canonical project quality gates: `docs/quality/reliability-regression-register.md`; product charter: `docs/local-first-development-charter.md`.
