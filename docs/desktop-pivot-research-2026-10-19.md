# AI Workspace desktop pivot — competitive evidence and execution gates
Research snapshot: **2026-10-19**. Living decision record, not a commitment to launch.

## Decision today

**Do not continue polishing the current Chrome extension as a stand-alone product.**
Preserve main. Run a deliberately narrow desktop feasibility spike on
\`spike/local-agents-desktop\`. The original browser-tab pain is demonstrably addressed
by Echoes and competitors; we must prove a different end-to-end workflow.

Candidate value proposition: **existing consumer ChatGPT/Claude/Gemini conversations
beside live, local Claude Code/Codex sessions in one user-controlled desktop workbench,
with trustworthy cross-session project continuity and optional handoffs**.

This product hypothesis remains **unproven** commercially and technically. Do not claim
a unique market position or advertise native provider functionality until tested.

## What the user observed firsthand (not independently verified)

- Echoes quickly indexed ~2,905 existing ChatGPT/Claude/Gemini conversations,
  showed full native-looking conversations, recency and provider sorting.
- Its library UI felt sparse and hard to scan. Some account icons seemed to trigger
  sync automatically before the user requested it; certain providers got stuck
  reconnecting or rate-limited with timed retries.
- Draft typed in official Claude Desktop did not appear in Echoes, but Echoes' own
  draft survived a full app restart. Cross-app draft propagation is not confirmed.
- Echoes' Code entry displayed cloud/GitHub Claude Code sessions rather than the
  local PC terminal sessions. Selecting a new session asked for the official
  desktop app or a cloud repository.
- User did not find the advertised multi-chat view intuitively; do not call the
  capability missing without testing the actual desktop flow.
- Context menu revealed "Continue in" ChatGPT/Claude/Gemini/Grok/AI Studio,
  summaries (local/provider), and JSON/HTML/Markdown/PDF exports.
- Desired experience: real provider controls, model/effort picker, full back-and-forth,
  files/images/artifacts; not an imitation textbox, with local agents in the same
  multi-pane application.

## What competitors demonstrably offer

| Tool | Verified value | Remaining gap / uncertainty |
| --- | --- | --- |
| Echoes Desktop | 7 native-style provider website interfaces, library, cross-provider continuation, multi-chat, labels, exports, local database | No documented attach-and-control of existing local Codex/Claude Code sessions; manual observations of sync frustration need follow-up. |
| Sortbase | Polished nested folders, icons, cross-provider browser chat organization | Chrome extension, not a complete local-agent workbench; reviews cite import and support issues. |
| AgentHydra | Reads local Claude, Codex, OpenCode sessions; live-tails transcripts; replies to Claude; multiple instances | Codex read-only as documented; not an integrated consumer web chat client. |
| cdesktop | Local Claude Code/Codex/Gemini CLI/OpenCode/Hermes CLI sessions with terminal, diffs, worktrees, previews | Coding-agent-oriented; no clearly documented capture/control of existing consumer website chats. |
| Harness (Codegraff) | Multi-pane workspace for local coding-agent tools, Windows builds | Coding-agent workflow rather than a cross-provider historical consumer-web chat library. |
| Claude Desktop | Claude + local Claude Code in same app, parallel agent arrangements | Does not consolidate ChatGPT/Gemini existing consumer chats. |
| ChatGPT Desktop | ChatGPT + Codex + Work in same app | Does not consolidate Claude/Gemini existing chats; Codex separate view/history. |
| ADDOM / Zod | Cross-provider, projects, local tools/terminals and desktop surfaces | Must hands-on test whether they adopt existing provider *website* chat histories using consumer subscriptions rather than configured API credentials/new chats. |


### Additional close products verified during the second pass

- **Parallax (https://github.com/Houchen181/parallax)**: Windows desktop, up to **six** side-by-side model chats, broadcast prompts, Claude/GPT/Gemini using API credentials, plus an option to use a ChatGPT subscription in its app. It does **not** document adopting the user's existing consumer-web conversation histories or live Claude Code/Codex sessions. Consequence: six-pane chat layout and multi-model broadcast are commodities, not moats.
- **Hydra by jpdlr (https://github.com/jpdlr/hydra)**, **Hydra IDE (https://github.com/ndunl075/hydra)**, **Harness by Codegraff (https://codegraff.com/harness)**, **Happy Desktop (https://happy.engineering/desktop-app/)** and **Caprock (https://caprock.dev/)** each offer serious local Claude Code/Codex workflow capabilities; do not claim those are uniquely ours. Most are coding-agent oriented rather than existing consumer website library managers.
- **Codex–Claude Desktop Bridge (https://github.com/KeeVeeG/codex-claude-desktop-bridge)** already supports two-way text messages via MCP between selected existing Codex Desktop and Claude Desktop Code sessions on Windows. Consequence: even agent-to-agent communication is not a new differentiator; the broad web-chat ↔ local-agent boundary and workflow quality must prove value.
- **OpenAI ChatGPT built-in browser (https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app)** now brings browsed pages into the ChatGPT desktop experience. This may reduce some customer switching costs, but it is not the same thing as a unified library of existing Claude/Gemini consumer-web threads.

**No surveyed product has been verified to satisfy every boundary simultaneously.**
That is not evidence of a durable moat. Treat as a falsifiable hypothesis.

## Directly surfaced complaint inventory

### Echoes extension: firsthand review excerpt evidence
Public excerpts from https://chrome-stats.com/d/ppnfnillfndkellpbphafglnljdefjph/reviews
(accessible portion only; the site's full 174-review corpus was paywalled).

| When | Complaint or positive counter-evidence | Candidate requirement |
| --- | --- | --- |
| 2026-07-20 | Perplexity connection failed and exact-match highlights sometimes become a blob. | Provider diagnostics and accurate search excerpts |
| 2026-06-28 | Privacy / security-policy ambiguity complaint. | Clear, honest dataflow, user controls and optional audits |
| 2026-04-13 | 1,000+ ChatGPT chats: repeated reading/retries despite rate-limit warning, high fan usage, no obvious stop control. | Explicit opt-in, manual stop, bounded sync, provider cooldown |
| 2026-03-25 | Excessive ChatGPT requests. | Incremental checkpointing and budgets |
| 2026-03-20 | Crashed repeatedly in that user's setup. | Crash resilience + recovery tests |
| 2026-03-01 | Adding second Gemini account reportedly paused first account indexing; after remove/re-add recovered. | Multi-account isolation, independent cursors, observable state |
| 2025-10-04 | Gemini Custom Gem handling failed and support complaint. | Specialized provider context regression tests, support |
| 2025-09-24 | Slow startup, provider-page interference, freezes, frequent paywall prompts. | Strict performance budget, no intrusive upsells |
| 2025-10-13 | Positive: quick fixes, communication, superior search. | Compete against an actively improved product |
| 2026-03-01 | Positive: powerful multi-provider exports, tags, >1,200 conversations, willingness to pay. | Baseline value is proven; high bar to switch |

**Crucial correction:** Echoes has a significantly more explicit privacy policy
updated **2026-10-16**, after the June complaint. It says full library text is local,
while *search query terms*, account/settings metadata and selected desktop
highlights are synced; the browser AI assistant may send limited titles to a
cloud model. Do not keep repeating that its privacy policy is unchanged since
2024, and do not claim conversation content always goes to its backend.
Source: https://echoes.r2bits.com/privacy-policy

The Chrome Web Store listing lists release fixes for search preview correctness,
stuck sync indicators and onboarding; dated complaints may no longer reproduce.
Source: https://chromewebstore.google.com/detail/echoes-chatgpt-claude-mor/ppnfnillfndkellpbphafglnljdefjph

### Adjacent organizer complaints and features worth stealing in spirit
Sources:
- https://chrome-stats.com/d/gdocioajfidpnaejbgmbnkflgmppibfe/reviews
- https://chrome-stats.com/d/mngeddjcngpcdakdhfcbaefeonmmeomg/reviews
- https://chrome-stats.com/d/eoabjnjdfdcgbebgmhphnjfekdnacief/reviews

Sortbase reviews: excellent nested folders/colors/drag and drop, but reports of
unimported ChatGPT threads ("Cannot bookmark. Chat not imported yet"),
Claude loading hangs, inaccessible paid features, difficult support, cluttered
nested folders. AI Workspace Pro reviews mention instability, upgrade prompts,
complexity. Foldermate reviews mention data disappearing across updates and
requests for portable backups/cloud sync.

These are self-selected reviewer reports, not statistically representative,
and not necessarily desktop-specific.

### Tiny/unverified user-experience complaints to retain as hypotheses
- Difficulty discovering multi-chat / split-view gestures.
- App does not show when a conversation is currently responding vs awaiting input.
- Sparse list with hundreds of pages; desire cards or context snippets without sacrificing a fast table mode.
- Manual sorting by exact *real last message time*, not last sync/preview read.
- Unsent drafts in separate official apps do not necessarily transfer into third-party embedded site sessions.
- Some third-party handoff summaries may omit project constraints, artifacts, images and provenance.
- Native voice/images/attachments/model effort controls may fail even if the webpage itself loads.
- Possible account sync started merely on visiting a provider menu.
- Extra login/OAuth friction or sessions disconnected between native Chrome and embedded Electron cookies.
- Providers' rate limits and app upgrades may break unsupported integration methods.
- Metadata/title leakage via telemetry may undermine "local-first" expectations.

Do not label these as broadly verified product flaws without independent testing.

## Proposed product strategy

**Core:** full native provider webpages (not fake chat re-renderings)
+ genuine local agent sessions + multi-pane and project views.
A user could put ChatGPT planning beside a live Claude Code session for the
matching repository. Initial mode should be comfortable as an everyday
desktop app, not only a control center for developers.

**Differentiating possible second feature:** provenance-aware handoffs that
can include selected project decisions, source conversation context, current
repository path/branch/diff/test results, linked screenshots/images (only
when accessible and explicitly consented), pending work and constraints.
First draft remains editable. Attachments should be retained as explicit
references if automatic portability is unavailable. Cross-provider handoffs
must handle project-identity ambiguity and require explicit choice if same
project name appears on both sides. Never present a summary as complete when
there are missing or truncated parts.

### User experience rules
1. Default: no mass history sync, no background account API scanning.
2. Each account has Connect / Pause / Retry / Disconnect, retry budget,
   exponential backoff and one-click hard cancel.
3. Genuine user activity ordering. Distinguish last message, last observed,
   last synced and last local-agent update.
4. Default native website view with all provider controls; never promise
   visual parity until checked on real logged-in accounts.
5. Explicit one/two/agent split buttons plus discoverable drag resizing later.
6. Local-only storage for chat content by default, export/restore support,
   per-account isolation, no copied credentials from Chrome profiles.
7. Agent sending / approvals need explicit user action. Never assume a file
   mtime means agent is actively working.
8. No accidental cross-project context mixing.
9. Clear error labels vs "working" forever; first-party service provider
   errors separated from our integration errors.
10. No arbitrary automatic file uploads to third-party providers; redact
    secrets and show exactly what leaves the machine.

### What not to build yet
- General AI model router or model API proxy.
- Full ChatGPT/Claude/Gemini DOM clone.
- Infinite automatic history import and high-frequency scraping.
- Cloud account or subscriptions/paywall.
- Autonomous git writes, arbitrary shell execution or message auto-send.
- Cross-application unsent-draft synchronization without supported interfaces.

## Technical path and explicit evidence

**Local agent inventory:** A read-only Node implementation and synthetic
tests live in experiments/local-agent-probe. Claude Code stores JSONL under
~/.claude/projects; Codex has rollouts under ~/.codex/sessions/YYYY/MM/DD.
This fallback does not guarantee all app/cloud histories, and reports
"unknown" activity status.

Anthropic publishes official list_sessions / get_session_messages in its
Agent SDK and an example session browser:
https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser

Codex's official app-server supports thread/list, thread/resume, streamed
notifications, paginated history, and approvals:
https://learn.chatgpt.com/docs/app-server

**Desktop embedding:** Electron WebContentsView and persistent partitions
can construct a genuine browser-pane prototype:
https://www.electronjs.org/docs/latest/api/web-contents-view
https://www.electronjs.org/docs/latest/api/session
https://www.electronjs.org/docs/latest/tutorial/security

This is **not proof that provider OAuth, bot detection, native model selectors,
all uploads and login flows will work**. The desktop-spike shell must be tried
against real Windows accounts; no auth bypasses or stolen browser cookies.
Remote content has sandbox=true, nodeIntegration=false, contextIsolation=true,
webSecurity=true; this is prototype hardening, not a full security audit.

## Execution and kill gates

| Gate | Check | Pass bar |
| --- | --- | --- |
| G0 | Read local Codex and Claude session metadata with fixtures | Tests green (DONE on CI). |
| G1 | In Windows Electron, log in with the user's account to ChatGPT and Claude and interact in *two genuine webpages side by side* | Model/effort controls, full transcript, prompt and reply, files and login across restart work; native Claude/Gemini account state and separate Chrome accounts are understood. |
| G2 | Discover existing real Claude Code + Codex sessions from Windows host | Correct project/ID/last turn, no duplicate/phantom entries; no full-file scanning that freezes machine. |
| G3 | Resume *one* safe existing agent session through official supported interfaces, without taking ownership of another active process | Stable live streaming and explicit approvals, correct working directory and no duplicated prompts. |
| G4 | Handoff one planning conversation into a repo-bound Claude Code task | Verified constraints/files/test result preserved; user can review payload and opt out. |
| G5 | Research demand with 10-15 users who actually operate consumer web chats + local agents | Several describe this as recurring pain and prefer the combined app over existing products; evidence of willingness to install/pay. |

**Kill/pivot decision:** If provider login / native UI in Electron fails broadly,
do not bypass security; adopt OS-level browser-window composition or stop.
If G1/G3 take outsized effort, or if existing apps cover daily workflow,
keep this as a personal utility or pause. No commercial launch claims until
performance, security, onboarding and install experience have been tested.

## How to reproduce spike

- \`node --test experiments/local-agent-probe/discover.test.mjs\`
- \`node experiments/local-agent-probe/discover.mjs\` prints read-only local metadata.
- Optional isolated desktop experiment: \`cd experiments/desktop-spike && npm install && npm start\`.
  No Windows/Electron runtime test has been performed yet; package installation
  pulls Electron and the first app run opens a provider website. Do **not**
  point the prototype at irreplaceable accounts until security/login QA.

No requirement for the user to run these immediately. Local machine checks are
needed only to establish the actual Windows capability.

## Research limitations

Accessible free reviews are not the full review corpus; Chrome-Stats gates
older material behind a subscription. Direct app-store feedback is mixed
with browser-extension feedback. Product marketing isn't proof of a working
experience, and source implementation is not a substitute for user testing.
Keep source links and date in follow-on claims.
