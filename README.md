# AI Workspace

**Your AI work, in one place.**

AI Workspace is a local-first Chrome extension for managing active work across ChatGPT, Claude, and Gemini. It brings browser conversations into a calm, project-based workspace so you can see what is working, what needs attention, and what you can continue—without manually hunting through tabs.

The long-term direction is one session model for both web AI conversations and local agents such as Claude Code. The current build is the browser-extension MVP; local coding-agent control and the desktop surface are planned, not implemented.

## What is in the current build

- **All work view** across projects, with workspace-wide Needs you / Working / Done counts.
- **Automatic discovery** of open ChatGPT, Claude, and Gemini tabs.
- **Project organization** with Inbox-first onboarding, manual move/pin, and review-before-moving project suggestions.
- **Session lifecycle** for open, discarded, and closed tabs.
- **Recent conversation context** in session cards and a selected-session transcript, cached locally (up to the latest 100 messages per session).
- **Create new chats from the workspace** with ChatGPT, Claude, or Gemini. New chats open in background tabs and use the user's existing signed-in provider session.
- **Continue from the workspace** by sending a prompt to a selected provider session. If a cached session is closed, Workspace can reopen it in a background tab to continue.
- **Close tabs in bulk** after attempting to capture a local transcript first. Tabs that cannot be safely captured are left open rather than risking lost context.
- **Local transcript search** over cached messages when the user searches, plus title and recent-message search.
- **Related work** suggestions that surface other potentially relevant sessions.
- **Performance safeguards**: no eager full snapshots of every session, throttled scans/publication, compact persisted previews, and no blind multi-attempt prompt retries.

## What it does not do yet

- It does **not** import your entire historical ChatGPT/Claude/Gemini account archive. It captures sessions that have been open and observed by the extension. Closing a session before it is first captured can mean its transcript is not available in Workspace.
- It retains the latest 100 messages it has captured per session, not an unlimited full archive. Open the provider conversation for its complete context.
- Web integrations depend on provider page structure and can need fixes when a provider changes its UI.
- The extension requires Chrome or a compatible Chromium browser, and the browser/provider session may need to open in the background to continue a closed conversation.
- Provider sign-in prompts, rate limits, CAPTCHA/checks, and unusual provider errors are not yet exposed as a complete, provider-independent attention taxonomy.
- There is no Claude Code/local terminal integration, desktop app, cross-device sync, account system, or cloud backend in the current MVP.

## Privacy and storage

Current session metadata and project preferences are stored in Chrome extension local storage. Transcript messages are stored in IndexedDB under the extension's origin. Search over these cached transcripts runs locally. The extension does not require an AI API key or a Workspace account, and the current build has no Workspace cloud backend.

The extension reads rendered conversation text on the supported provider websites so it can display recent context and continue a conversation. Those provider tabs still send your prompts to the provider you chose, under that provider's own account and policies. Local storage is not the same as encrypted storage: anyone with access to your browser profile and machine may have access to these locally cached transcripts.

## Install for development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run typecheck
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist` directory. Pin AI Workspace to the toolbar if you want quick access. Open the extension side panel by clicking its toolbar icon.

After pulling changes, run `npm run build` again and use **Reload** on the extension card. An extension reload may require refreshing already-open provider tabs to ensure their content scripts use the latest code.

## Development checks

GitHub Actions runs TypeScript typechecking, a production build, and extension-bundle checks on every push to `main`. See [Actions](https://github.com/serag21/ai-workspace/actions).

For a practical end-to-end test, use the [Extension Test Plan](docs/extension-test-plan.md). Keep the [Competitive Landscape](docs/competitive-landscape.md) as a standing requirement when making roadmap decisions.

## Roadmap direction

1. Make the extension's core workflows reliable and pleasant: session list, recent turns, send/continue, closed-session retention, search, attention state, projects, and related work.
2. Validate the product with real usage before expanding provider count.
3. Explore a local-agent bridge for coding/creative CLI agents after the extension has passed manual end-to-end testing.
4. Build a desktop surface only when user evidence validates the need for browser-independent access or richer local-agent/terminal support.

Core session management is intended to remain free and local-first. Optional monetization should never block the advertised core workflow.

## Contributing

Bug reports should include provider/browser, reproduction steps, expected behavior, actual behavior, and any performance impact. Do not include private conversation text, access tokens, or other secrets in public issues.
