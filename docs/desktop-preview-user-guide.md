# AI Workspace Desktop Preview — Windows x64

**Status:** Experimental technical preview, not a public release or installer. Source branch: spike/local-agents-desktop. Main Chrome extension remains unchanged.

## What exists

- One chat, Two chats, Stack chats, and Chat + local agents visible layout controls.
- Isolated Electron WebContentsView containers that load actual ChatGPT, Claude and Gemini webpages, retaining native UI only if the provider permits the embedded user agent.
- Two independently navigable chats from the SAME provider, alongside or stacked. They share provider-specific login partition but have separate webpage state.
- Read-only local inventory of Claude Code and Codex sessions, with optional official Claude Agent SDK metadata.
- Explicit, confirmed Resume in Windows terminal action for an existing session with a valid local working directory. Uses the user-installed Claude/Codex CLI, sends no prompt, and launches an external terminal, not an embedded live terminal.
- Open in browser fallback preserves a provider conversation path but never includes OAuth callback queries or other provider login URLs.
- No history scraping, background sync jobs, mass private API requests, browser cookie copying or provider credentials imported from other apps.

## Build artifact

Workflow: .github/workflows/desktop-preview-windows.yml

1. Open the newest successful run named Desktop Preview Windows on the spike branch in GitHub Actions.
2. Under Artifacts, download AI-Workspace-Preview-Windows-x64.
3. The GitHub artifact archive contains AI-Workspace-Preview-Windows-x64.zip; extract again if necessary.
4. Run AI Workspace Preview.exe from the extracted portable app directory (not from inside ZIP); keep all other Electron files alongside it.
5. Binary is unsigned and unverified for production. Run only from your verified repository and do not bypass unknown or untrusted executable warnings.

The Windows workflow uses pinned Electron 44.9.3, creates a portable app with @electron/packager, confirms required local-agent files exist inside app.asar, launches the packaged executable with --offline-smoke (no provider traffic) and uploads the artifact. Only use a workflow that passed on the current head commit.

## Local development

From experiments/desktop-spike run npm install followed by npm start.

## Important limitations

- Authenticated provider pages have NOT been validated on a real Windows account. Providers may reject Electron/embedded user agents. Google restricts OAuth login in embedded user agents; do not work around those restrictions. Popups deliberately remain blocked pending a compliant authentication design.
- The app does not import or synchronize a unified library of thousands of account web chats. It displays each provider's native history in that provider page.
- The right-side local-agent inventory does not stream, manage approvals, or attach to a running CLI. A new terminal may fail if the actual CLI is missing from PATH.
- Provider login state is isolated from the Chrome profile and official desktop apps; unsent draft synchronization is not guaranteed.
- Local transcript inventory may miss alternate client storage layouts; unknown working status remains unknown rather than guessed.
- No signing, installer, auto-updates, deployment, subscriptions or production-grade security review yet.

## Human release gates

1. App can start and quit without interfering with official ChatGPT/Claude/Gemini tabs.
2. Provider native history, model picker, attachments, replies, and any other required UI can be accessed in the real Windows app or an exact incompatibility is recorded.
3. Same-provider dual panes work and maintain independent conversation navigation.
4. Local Claude Code/Codex inventory matches known real PC sessions.
5. One explicit terminal resume opens the correct repository/session without sending a prompt automatically.
6. Closing app leaves no hidden sync jobs or child processes.
7. If provider login is blocked by embedded-user-agent rules, pivot the integration instead of bypassing safeguards.

The canonical 50-gate quality checklist is docs/quality/reliability-regression-register.md. Synthetic CI success is not real user-account acceptance.

## Commercial decision

The strongest unproven value is an everyday desktop workbench with genuine consumer AI sessions beside true local Codex/Claude Code project state. If that integration does not reliably work or outperform established competitors, keep the tool as an experiment rather than investing months in a generic chat clone.
