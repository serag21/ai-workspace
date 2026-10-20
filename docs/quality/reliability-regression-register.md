# AI Workspace — mandatory reliability and competitor regression register

**Critical quality contract · 2026-10-19 · applies to all future desktop and extension builds.**

This is the **release gate** for known user pain and competitor failures. It is **not** a claim that AI Workspace currently passes. Every item stays open until there is both a repeatable verification method and passing evidence. "Works on my machine" is not sufficient. Do not mark a provider-specific test passing because a mocked unit test passes.

**Evidence categories**
- **U**: direct observation by AI Workspace's owner, not independently reproduced.
- **R**: a public competitor user-review allegation; self-selected and potentially fixed since publication.
- **C**: user-observed failure of the existing AI Workspace prototype.
- **H**: quality hypothesis / desired safeguard (not an allegation about a competitor).
- **P**: documented competitor feature / comparative parity goal, not a complaint.

**Priority:** P0 = release blocker (security/data loss/provider availability), P1 = required reliability/parity, P2 = product polish or platform-specific compatibility.

**Evidence boundaries:** A user's report that ChatGPT chats failed while Echoes was running and loaded as soon as Echoes was force-closed is a compelling *correlation*, **not proof** of the exact technical cause. Do not assert traffic volume, credential interference, account punishment, or root cause without logs/reproduction.

## A. Reported interference, background syncing, authentication and resource use

| ID | Prio | Origin | Failure / complaint to prevent | Required regression assertion |
|---|---|---|---|---|
| REL-001 | **P0** | **U 2026-10-19** | **All existing ChatGPT chats reported "could not load"; repeatedly retrying failed; all recovered immediately after force-closing Echoes in Task Manager.** | Starting, viewing, syncing, pausing, and closing AI Workspace must not disrupt first-party ChatGPT/Claude/Gemini tabs or desktop apps. Test concurrently using independent browser sessions; record baseline versus while running, restore after quit. Treat any corroborated interference as a no-ship event. |
| REL-002 | P0 | U 2026-10-19; R 2026-04-13 | Browser/provider selection appears to trigger account sync without explicit user request. | **No implicit mass sync:** navigating to or previewing a provider does not call history-list or transcript-fetch integrations; explicit, informed per-account connection and initial-sync consent required. |
| REL-003 | P0 | U; R 2026-04-13 | Sync continues aggressively after provider rate limit, "Retry in 60s" cycle, high fan/CPU activity. | Honor 429 and Retry-After, bounded attempts, cooldown + circuit breaker; no scheduled retries after user pauses, stops, disconnects, or quits. |
| REL-004 | P0 | R 2026-04-13 | No visible, effective way to stop a running synchronization process. | Pause/Cancel disables scheduling immediately, drains/aborts active work when safe, and stops further provider requests; verify with counted mocked calls. |
| REL-005 | P0 | R 2026-03-25 | Excessive ChatGPT provider requests. | Explicit per-provider concurrency and request budgets, incremental checkpoints, no full-history retry loops, measurable outbound rate counters, no retries of non-idempotent sends. |
| REL-006 | P1 | U | Repeated reauthentication/reconnect dialogs even after signing out/in and retrying (including AI Studio). | Account failures have distinguishable states, human-readable reasons, "Retry" and "Disconnect", and a retry budget; sign-out invalidates only the selected account. |
| REL-007 | P1 | U | Provider left in a reconnect/rate-limit loop after it was merely explored in UI. | Browsing UI must be side-effect-free. Pending retry timers are cancelled on disconnect and persisted as intentionally paused across restart. |
| REL-008 | P1 | R 2026-03-01 | Adding a second Gemini account reportedly prevents the first from indexing. | Strict account isolation: distinct storage keys, auth partitions, sync cursors, job queues, and disable controls. One account's failure cannot pause/overwrite another. |
| REL-009 | P1 | R 2025-09-24 | Slow launch, provider-page interference, freezing, and computer performance degradation. | Cold-launch and idle resource budgets, no provider-page content injection when not required, bounded data reads, cancellation, responsiveness tested with thousands of stored sessions. |
| REL-010 | P0 | R 2026-03-20 | Frequent app crashes. | Crash-restart and forced-termination recovery; recover workspace layout, sessions, drafts and safe sync checkpoint without duplicating external actions. |
| REL-011 | P1 | R 2026-07-20 | Perplexity account connection reportedly fails. | Clear connect failure state and provider-specific login QA; never loop forever or call it connected without proof. Applies if/when Perplexity supported. |
| REL-012 | P1 | R 2025-10-04 | Gemini Custom Gems missing/broken and user reported unanswered support. | If Gemini Gems supported, open correct Gem context, preserve specialty UI, and test replies and navigation; don't advertise support without E2E proof. |
| REL-013 | P0 | H | Embedded provider login/session security regression. | Sandbox remote contents, no Node integration; isolate account sessions, deny unneeded permissions, never read/import Chrome cookies or provider tokens, test OAuth flow without security bypasses. |
| REL-014 | P0 | H | Background worker continues when app is closed; user cannot stop it. | Quit/force-close stops network jobs, timers and child processes; no headless sync service without opt-in. |
| REL-015 | P1 | H | Providers 403/401/429/5xx or network timeouts produce endless "Working". | Distinct auth/rate-limit/network/retry-exhausted/offline indicators; deterministic terminal states and testable recovery. |

## B. Conversation fidelity, session identity, history and drafts

| ID | Prio | Origin | Failure / complaint to prevent | Required regression assertion |
|---|---|---|---|---|
| CON-001 | **P0** | C | Open in Chrome sometimes opens *new chat* instead of the selected existing thread. | Only reopen canonical validated conversation URLs/IDs, distinguish drafts vs real threads, reject unresolved aliases; test close/reopen and route transitions. |
| CON-002 | **P0** | C | Generic prompts/PowerShell output appear as bogus conversation titles. | Never promote body text to title; use provider title when verified, stable user override, otherwise a neutral fallback. |
| CON-003 | P1 | C | Sessions seem randomly sorted, not by most recently sent/replied-to message. | Separate true last message timestamp from last-seen/synced/snapshot time; pins first and user-selectable "recent activity" sort. Reading a chat must not bump message timestamp. |
| CON-004 | P1 | C | Text snapshot shows arbitrary document section, incomplete turns, or heavily truncated responses. | Full native provider webpage is the interactive source of truth; optional preview displays last 2–3 complete exchanges, "truncated" indicator and scrollable archive. |
| CON-005 | P1 | C | Preview box doesn't scroll and clips the relevant newest messages. | Keyboard, wheel and touch scrolling; latest turns accessible; long code/markdown messages render legibly without losing content. |
| CON-006 | P1 | C | No visible model/effort picker, native provider buttons, full back-and-forth, attachment upload. | Use original native provider UI for actual chat; test model/effort, file/image attachment, message scroll, native artifacts/previews; fail honestly on unsupported features. |
| CON-007 | P1 | U | Draft typed in official Claude Desktop missing from corresponding Echoes chat. | Never claim cross-client unsent-draft sync unless verified. Preserve *our own* per-session drafts through tab switching, app restart, and crash without leaking drafts into another thread. |
| CON-008 | **P0** | H | A draft sent or a prompt duplicated by retries or reopening. | Exactly-once *attempt* semantics: no automatic resend after ambiguous acknowledgement; visible uncertainty and manual verification. |
| CON-009 | P1 | H | Partial transcript import/sync silently overwrites a more complete conversation. | Versioned snapshots, stable conversation IDs and per-account provenance; partial reads cannot delete prior saved messages. |
| CON-010 | P1 | H | Closing tabs or restoring from backup loses unsaved context. | Safe close only with confirmed local capture; recovery and export/import tests; never claim local cache is a full native backup. |
| CON-011 | P1 | R 2026-07-20 | Search result highlight broken/too broad (exact query shown as a blob). | Precise highlighted matched spans, readable snippets, correct title and provider routing. |
| CON-012 | P1 | R 2025-09-24; 2026-03-01 | History import stalls, old conversations never indexed, "Chat not imported yet". | Progress, cancellation, bounded resumable per-account sync; imported item count matches validated provider archive. |
| CON-013 | P1 | R Foldermate review | Saved folders/bookmarks reportedly disappeared after an update. | Schema migrations are reversible/tested; backups, idempotent upgrade, state persisted after clean and crash restart. |
| CON-014 | P1 | U | Thousands of histories feel like a sparse 117-page spreadsheet; hard to scan. | Compact list plus optional card/project view, clear timestamps and context; search over 3k+ sessions without noticeable typing lag. |
| CON-015 | P2 | U | Multiple-conversation layout advertised but hard to find intuitively. | One-click visible Split Right/Split Down/Chat+Agent, accessible keyboard alternatives and discoverable drag resizing; real UX testing. |
| CON-016 | P1 | H | Multiple browser accounts/provider clients collide or show the wrong native conversation. | Canonical URL and account identity, explicit account switching, isolation of cookies/storage without touching official browser profiles. |
| CON-017 | P1 | H | Live response state falsely shows Waiting/Working after process ends. | Correct terminal states; no inference from file modification timestamp alone; account for provider-page errors and pending approvals. |

## C. Project context, handoff, assets and native coding agents

| ID | Prio | Origin | Failure / complaint to prevent | Required regression assertion |
|---|---|---|---|---|
| HAND-001 | **P0** | C | Earlier AI Workspace handoff mixed unrelated OpenMontage context into Claude wallpaper thread. | Explicit source/provenance and project scope; unrelated threads OFF by default; cross-project transfer requires user opt-in. |
| HAND-002 | P1 | C | Source transcript insufficient and source AI handoff was partial/stale. | Complete/marked summary and extraction validation; reject missing segments; show omissions and original references. |
| HAND-003 | P1 | U | Cross-provider chat handoffs usually require manually copying huge chats or costly exported file uploads. | Destination selector, editable preview, source-attribution, chunk/summary decision and bounded data; no automatic send without consent. |
| HAND-004 | P1 | H | Same-named projects on both sides have different repos or objectives. | Compare normalized name **and** associated repo identifier/path; prompt explicit disambiguation, never silent merge. |
| HAND-005 | P1 | H | Handoff omits branch, changed files, test results, unresolved decisions. | Optional provenance-aware packet with verified repo path/branch/status/tests, open blockers and "do not redo" requirements; distinguish observed vs inferred. |
| HAND-006 | P1 | H | Images, artifacts, plans, references silently lost across providers. | Attachment manifest and content inventory; only transfer files when supported and approved; mark untransferred assets explicitly. |
| HAND-007 | **P0** | H | Sensitive source files/secrets copied to another AI by handoff. | User-facing manifest of outgoing paths/text and destination, preview/redaction, opt-in per file, never automatic secret upload. |
| AGENT-001 | **P0** | U | Echoes Claude Code view shows cloud/GitHub sessions, not the user's local PC sessions. | Discover real local Claude Code and Codex sessions in host machine folders with canonical IDs, project cwd and honest "unknown" live status. |
| AGENT-002 | P1 | U | Echoes cannot start a new *local* Claude Code session from its cloud-only Code view. | Support local repo selection, official SDK/app-server session create/resume, clear distinction between local and cloud sessions. |
| AGENT-003 | **P0** | H | Attaching to an actively running agent causes duplicate execution or corrupts its state. | Verify session ownership/locking; safe read-only attach first, explicit agent resume and permissions, non-destructive session transfer. |
| AGENT-004 | P1 | H | No shared layout between consumer chat and local coding agent. | Actual provider webpage alongside a live agent UI with streamed output and approvals; independent scroll, resize and lifecycle. |
| AGENT-005 | P1 | H | Agent status inferred from file mtime / file existence mislabels approvals. | Live status only when connected to official event stream/process; "unknown" otherwise, including after crash/disconnect. |

## D. Trust, privacy, portability, support and commercial friction

| ID | Prio | Origin | Failure / complaint to prevent | Required regression assertion |
|---|---|---|---|---|
| TRUST-001 | P0 | R 2026-06-28 | User questioned privacy policy and authentication-data handling. | Publish exact local/remote dataflow including title/search/highlights telemetry; don't imply "everything local" if exceptions exist. No provider password/token harvesting. |
| TRUST-002 | P1 | R 2025-09-24; AI Workspace Pro reviews | Repeated upgrade prompts/paywall nagging disrupts core work. | Core features usable without coercive upsell modals; tested subscription downgrade and no interruption to active sessions. |
| TRUST-003 | P1 | R Sortbase reviews | Unresponsive support, broken paid features and complicated folder UX. | Honest feature status, support path, searchable troubleshooting, payment entitlement checks if monetized, UI user testing. |
| TRUST-004 | P1 | R Foldermate reviews | Requests for portable backups and cross-device recovery. | Export/import with schema version, integrity checks, user-readable format and restore smoke tests; no phantom sessions. |
| TRUST-005 | P1 | H | Sensitive chat contents exported or logged without user understanding. | Data minimization, no diagnostic logging of prompts by default, explicit export consent, protect error reports from private content. |
| TRUST-006 | P2 | H | App adds too much complexity via countless features. | One-click everyday workspace navigation, accessible default view and measured task-completion time before shipping. |

**Total: 50 independently trackable gates** (including observations, review allegations and preventive requirements). IDs persist when tests are refactored; never silently delete a gate. New incidents get a new ID; retain original report and remediation history.

## Additional incident — repeated PC-wide ChatGPT loading failures (2026-10-19)

**See [GitHub incident #3](https://github.com/serag21/ai-workspace/issues/3).**

- **First occurrence:** all ChatGPT conversations failed to load on the PC, recovered after Echoes was force-closed. This is correlation, not confirmed causality.
- **Second occurrence:** even previously open browser conversations stopped loading after a refresh; the user's **phone app still worked**. The user force-closed **both Echoes and ChatGPT/Codex desktop**, and the PC chats recovered. Because two applications were stopped at once, attribution is unresolved.
- **Do not mark REL-001 resolved** based on a clean mocked request-policy test. We need real Windows host verification that our app never interrupts native provider tabs or other clients.
- **Safe future isolation test:** if it happens again, without repeatedly clicking Retry, close **only one candidate application at a time**, check one known working chat between changes, and record which action restored it. Do not copy request headers, tokens, or private conversations to public issues.

## Test execution and reporting contract

1. Maintain automated tests named with the corresponding IDs (unit/integration) and an automated coverage report; tests that depend on a real provider mark **MANUAL REQUIRED**, never fake PASS.
2. For P0 gates, merge/release requires green automated evidence **plus** appropriate real-host verification. Automated synthetic fixtures do not establish provider compatibility.
3. Sync/retry/stop tests must use a fake provider HTTP transport and a virtual clock to prove zero forbidden requests, cancellation, Retry-After, total budgets, and account isolation. Do not hammer ChatGPT or any provider with automated live traffic.
4. E2E desktop QA must include: fresh install, sign in on user-owned accounts, no mass import by default, no interference with official ChatGPT/Claude/Gemini windows, real local agent discovery, process restart, force kill, crash recovery, native controls, image/file uploads and thread identity.
5. Public review allegations are signals, **not confirmed current bugs** in Echoes, Sortbase or any competitor. Preserve dates and whether the complaint pertains to browser extension vs desktop.
6. Never use automated test success as permission to send prompts, execute code in user repos, alter local agents, or synchronize third-party accounts.
7. Track **Not implemented / Mock passed / Real host passed / Failed / Needs investigation**, with reference to CI run and reproduction evidence. A P0 starts Not implemented until real-host acceptance passes.

## Evidence sources (original reports and public review excerpts)

- Direct user testing of Echoes Desktop and AI Workspace: October 19, 2026 conversation; observations above paraphrased without private chat content.
- Echoes extension review excerpts: https://chrome-stats.com/d/ppnfnillfndkellpbphafglnljdefjph/reviews (2025-09-24, 2025-10-04; 2026-03-01, 2026-03-20, 2026-03-25, 2026-04-13, 2026-06-28, 2026-07-20). Some archived review content is paywalled; only accessible excerpts were checked.
- Echoes current product and privacy disclosures: https://echoes.r2bits.com/desktop , https://echoes.r2bits.com/privacy-policy ; compare updated policy, don't assume an old policy remains.
- Sortbase/related Chrome-Stats organizer reviews cited in https://github.com/serag21/ai-workspace/blob/spike/local-agents-desktop/docs/desktop-pivot-research-2026-10-19.md .
- AI Workspace product tests: docs/extension-test-plan.md and ongoing desktop spike branch.
