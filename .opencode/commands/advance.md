---
description: Advance AI Workspace from its durable backlog (manual / shared-worker invocation only)
agent: build
---

Act as the bounded local engineer for AI Workspace. This command is a **native OpenCode prompt entrypoint**; invoking it does not create a Windows task, background process, global scheduler or GPU lease.

1. Read `AGENTS.md`, `PROJECT_CHARTER.md`, `BACKLOG.md`, `DECISIONS.md`, `RUN_STATE.json` and relevant existing project acceptance docs. Inspect Git status, current branch, previous commit and actual tests/CI; **do not assume a stale RUN_STATE observation is true without verifying**.
2. If called in foreground by the owner, you may do safe CPU-only repo work and normal OpenCode inference under the owner's current resource settings. If invoked by an unattended worker, confirm the **real central OpenMontage controller** has already granted a valid local-model/GPU lease and the run was explicitly enabled; absent verifiable authority, do **not** start local inference or other GPU workloads. Game Hold, ComfyUI and Emergency stop take precedence.
3. Choose the highest-value **READY** task whose dependencies are satisfied, preferring a real product risk over cosmetic changes. Respect the 60-minute unattended cycle limit, 30-minute clean checkpoints, two deterministic retries, zero paid services, one GPU model, no surprise downloads or background jobs. Do not spin in a retry loop or work for the sake of activity.
4. Check that the current branch is `spike/local-agents-desktop`. Preserve uncommitted/untracked data; do not reset, force push, merge to main, access unrelated projects, run an active Codex/Claude session or automate provider login. Never use unofficial auth bypasses, secret harvesting or desktop/mouse/keyboard control.
5. Implement a substantial but bounded, testable improvement with existing mature code/SDKs when possible. Add realistic tests and inspect outputs. Distinguish synthetic tests from real Windows/provider verification. If a task is genuinely blocked by account access, a missing GPU contract or owner approval, record it and select another ready CPU-only task.
6. At clean milestones, update the task row in `BACKLOG.md`, checkpoint `RUN_STATE.json`, and document material design changes in `DECISIONS.md` if necessary. Commit coherent work on the isolated branch; inspect CI when available. Never overwrite a concurrently advancing remote branch or conceal failures.
7. Finish with at most four short lines for the owner: **What now works / Evidence / Owner action (or None) / Next**. Keep technical details and recovery state in Git, not in the user-facing report.

**No automatic recurrence is activated here.** Future unattended invocation must come from the already-designated shared OpenMontage worker after publication, review and approval of its actual lease/queue contract. Do not implement your own worker or modify the controller.

Additional optional focus for this cycle: $ARGUMENTS
