# Local development bridge: VS Code, repositories, and terminal handoff

**Status:** Proposed architecture. Not implemented in the current Chrome extension build.
**Decision:** Keep extension-first. Build and validate browser-session workflows first; prototype this as an optional local companion, not a cloud command-execution service.

## The job to solve

AI Workspace should let a person move from a browser AI conversation to the actual local project without manually copying prompts, repository paths, and commands between ChatGPT, Claude, VS Code, and PowerShell.

Example: the OpenMontage project contains a ChatGPT “Mastermind” session, a ChatGPT “Thumbnail Studio” session, a Gemini thumbnail backup, and a local Claude Code session. From the Mastermind session, the user should be able to choose the real OpenMontage workspace currently open in VS Code, prepare a handoff, and place the approved task or command into the correct terminal or agent composer. The user remains in control of execution.

The product opportunity is not a generic “copy command” button. It is **project-aware handoff between web conversations and local development work**.

## Competitive reality

This territory is not empty:
- [Clagentic Console](https://github.com/clagentic/clagentic-console) already runs Claude Code/Codex sessions in a self-hosted browser workspace, offers project and session status, and can pin terminal output and browser tabs as agent context.
- [Crispy](https://marketplace.visualstudio.com/items?itemName=the-sylvester.crispy) offers a browser / VS Code / Cursor experience for Claude Code and Codex with transcript search, session controls and multi-agent work.
- [ContextKeeper](https://marketplace.visualstudio.com/items?itemName=contextkeeper-vscode.contextkeeper) saves AI conversations from browser and terminal tools into a searchable dashboard.
- VS Code's own Agent window has continued adding session grouping, side-conversations and prompt/file-change navigation. See the [August 2026 Copilot release notes](https://github.blog/changelog/2026-08-31-github-copilot-in-vs-code-august-2026-releases/).

Therefore, “we integrate VS Code” is not a sufficient differentiator. The thesis to test is: **existing signed-in browser conversations + one project/session model + a reliable local repo handoff, with no API-key requirement and no automatic command execution**. That combined workflow still needs competitor hands-on testing and user validation.

## Proposed user experience

1. Open a browser AI session in AI Workspace and click **Send to local project**.
2. Choose from workspaces currently open in the local VS Code companion, showing project name, repository root, Git branch, and a small dirty/clean indicator. Do not infer the target solely from a similar project name.
3. Choose a handoff type:
   - **Instruction for Claude Code/Codex:** prepare the task text for a known local agent terminal/session.
   - **Shell command:** prepare an explicit command to paste into a project terminal.
   - **Open repo:** focus/open the selected VS Code workspace.
4. Review the handoff preview. Include the source session title/provider, selected project path, optional selected transcript excerpt, user's instruction, and safety constraints.
5. Click **Prepare in VS Code**. The companion creates or focuses a terminal in the selected workspace and inserts text **without sending Enter**. The user reviews it and presses Enter. For agent composer drafts, leave the task in the input for review before submission.
6. Report the result back in AI Workspace: prepared, cancelled, bridge offline, repo not found, or unsupported action. Never pretend a command ran if it only was staged.

## Architecture

### Chrome extension
- Retain the existing provider/session capture architecture and local transcript database.
- Add a local-development provider/session adapter only after the browser MVP passes manual release tests.
- Talk to a companion host through a narrowly scoped RPC surface, not through content scripts.
- Treat text from a web conversation as untrusted data. Show it as text, not HTML; do not let it choose a repo silently; do not automatically execute it.
- Require a user gesture and confirmation before staging code or shell operations.

### VS Code companion
- A small separately installable VS Code extension knows its current workspace folders, active editor, Git repository root/branch, and whether each workspace remains open.
- It can open a folder via VS Code's command API, create a terminal using the selected workspace folder as its working directory, or prepare a prompt for an agent session where the target IDE supports it.
- Support multi-root workspaces as multiple selectable targets.
- The first supported editor should be VS Code. Support for full Visual Studio should be evaluated separately instead of claiming both are supported.

### Local communication bridge
Chrome's documented Native Messaging API lets an extension talk to a registered local host using structured messages, but requires the native host to be installed and registered. Use the official [Native Messaging model](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging?hl=en) rather than exposing an unauthenticated arbitrary local HTTP command server.

The host should expose only allow-listed operations such as:
- listWorkspaces
- getWorkspaceStatus
- openWorkspace
- prepareTerminalInput
- prepareAgentPrompt
- listSupportedAgentSessions (only where a supported adapter exists)

It must not expose generic exec(command), unrestricted filesystem operations, or arbitrary shell pass-through. The host validates every request, binds target workspace IDs to paths discovered locally, checks that the caller is the expected extension ID, and logs failures without recording private prompt bodies by default. Content scripts must never connect directly to the native host.

A local HTTP/WebSocket implementation can be used for an early development spike, but it must bind only to loopback, authenticate the extension, resist DNS-rebinding/CSRF, expose no generic execution endpoint, and clearly request any browser local-network permission. It is not the preferred public-release architecture.

## Trust and safety requirements

- **Stage, don't execute:** pre-fill a terminal or agent composer and leave Enter/submission to the user.
- **Explicit destination:** display the full repository path and branch before staging. Never silently route a command based only on title similarity.
- **No hidden prompt injection:** text from a webpage may contain malicious commands. Display the exact text that will be staged, allow edit/cancel, and do not treat website content as trusted control instructions.
- **Narrow filesystem authority:** the bridge can act only on workspaces explicitly enumerated and selected by the user.
- **No credential collection:** do not ask AI Workspace users for provider API keys as a prerequisite to this handoff.
- **Offline gracefully:** if VS Code or the bridge is not running, keep the handoff in the local UI and offer copy-to-clipboard as a fallback.
- **No full-context auto-transfer:** make transcript snippets opt-in and visible. Never inject the entire conversation or repo contents by default.
- **Auditable:** show the exact destination, operation, and staged text. Later agent automation must have explicit per-project permissions and approval gates.

## Delivery sequence

### Phase 0 — current extension release
- Stabilize provider session identity, transcript capture, create/send/close/reopen, search, project handling, and manual nickname.
- Keep project/repo integration out of the critical path for the browser-only release.

### Phase 1 — local project association
- Let each AI Workspace project link to a local repository identity once the companion can enumerate open workspaces.
- Show connected/offline state.
- Offer Open in VS Code and Prepare handoff.
- Add tests with paths containing spaces, multi-root workspaces, renamed folders, closed workspaces, and multiple branches.

### Phase 2 — command/agent handoff
- Allowlist destinations and terminal/agent types.
- Stage text without executing.
- Verify no duplicate handoffs on lost acknowledgements, matching the extension's safe-send rule.
- Return a status receipt to the source AI session.

### Phase 3 — local agent sessions as first-class entries
- Show Claude Code/Codex sessions beside browser conversations in the same project.
- Add live status, waiting/needs-you state, recent output, continue/resume, and safe focus/open actions.
- Reuse vendor-native auth and local settings; do not reimplement Skills/MCP or silently bypass permissions.

### Phase 4 — evaluate desktop
Build a desktop surface only if testing shows a meaningful need for terminal/process management or browser-independent access. The same workspace/project/session model should power it; it should not become a separate duplicate app.

## Acceptance criteria for an initial bridge

- Enumerates currently open VS Code workspace folders and maps them to stable local IDs.
- Displays name, canonical path, repository root, branch, and dirty/clean state accurately; doesn't confuse duplicate project names.
- Selecting a workspace opens/focuses the correct VS Code window.
- A prepared command appears in a terminal at the correct working directory with no newline/auto-execution.
- Prepared agent instructions are shown for review before submission.
- Malformed messages, web content, and unknown operation names cannot execute shell commands or access paths outside the selected workspace.
- If the IDE closes, the workspace changes, or the bridge disconnects, the UI reports a clear recoverable error.
- Unit/integration tests cover workspace selection, quoting/paths, duplicate handoff prevention, permissions, and interrupted communication.

## Current build status

The current Chrome extension has no native bridge, local terminal controller, VS Code companion, or repository discovery. Do not describe any of those as shipped. Current functionality remains browser AI session management. This document is the agreed direction to evaluate after the extension release candidate is stable.
