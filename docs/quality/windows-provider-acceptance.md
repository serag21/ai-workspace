# AI Workspace — real Windows provider/agent acceptance protocol

**Status: NOT RUN.** This is a manual evidence protocol for the isolated desktop spike, **not** an assertion that embedded login, provider controls or live local agents work. No credentials, chat contents, cookies, OAuth codes or private repository files should be captured in test evidence.

## Entry conditions

- Use only an **unsigned, private preview artifact from a successful Windows workflow on the exact branch commit under test**. Confirm the GitHub Actions run's head SHA and verify the archive is from the intended repository. Do not treat CI's `--offline-smoke` as a signed-in browser test.
- Use an expendable, non-sensitive provider conversation and a disposable local coding repository/session for the first test. Keep official browser/desktop provider apps available as independent controls.
- Do not copy Chrome cookies, extract tokens, modify user-agent strings to evade authentication controls, use undocumented provider APIs, or perform mass history requests.
- Stop if official provider conversations become unavailable, unexpected repeated requests occur, or the app accesses an unrelated project. Capture only timestamps, high-level symptoms and redacted error classes.

## G1 — real native webpage compatibility (ChatGPT, Claude, Gemini)

For **each provider**, record the app version, Windows version, provider, exact tested UI feature and result as **Pass / Fail / Blocked / Not tested**:

1. Start the app with the official browser's existing chat open. Verify the official chat remains usable; open a *different* expendable conversation in the preview.
2. Attempt **normal provider sign-in** within the embedded page, without bypasses. Record whether it succeeds or whether popup/OAuth/embedded-browser policy blocks it. If blocked, stop that provider's embedded-login test and use the **Open in browser** fallback.
3. If signed in: verify native history, reopen a specific existing thread, navigate to another thread and back, send one harmless prompt, observe a reply, and check the model/effort picker **if that provider/account offers it**.
4. Test native attachment selection with a harmless tiny text/image file, without uploading private files; record whether it completes. Check native scrolling, artifacts/previews if available, and keyboard input.
5. Open a second pane with a *different thread from the same provider*. Verify both remain independently navigable and that actions in one pane do not silently replace the other. Repeat with two different providers.
6. Quit/restart and confirm login state and thread identity where supported. Check that official browser/desktop sessions continue functioning during and after the preview.
7. Test the browser fallback while on an existing thread: it should open **the same recognized thread** without carrying query/fragment data. On a login/callback/unrecognized path, it must open only the provider homepage. If the URL format is not recognized, report the path **shape only** (replace identifiers with `<id>`).

**G1 pass** requires usable normal login and native conversation controls for the target providers, persistent sessions, two independent panes, and no first-party interference. A successful static page render, offline Windows smoke, or a mock test is **not** a G1 pass. A provider refusing embedded login is a product architecture decision point, not a reason to bypass its safeguards.

## G2/G3 — genuine local Claude Code/Codex acceptance

1. In the Windows host, select one known *closed/inactive* Claude Code session and one known *closed/inactive* Codex session from a disposable project. Compare displayed provider, UUID, project path, branch and last update with official local tools. Treat active status as **unknown** until verified from an official process/event source.
2. Refresh the inventory and verify no duplicates or unrelated project identities appear. Verify that no prompts are sent by inventory refresh.
3. For one **known inactive** disposable session only, explicitly confirm **Resume in Windows terminal**. Verify the CLI opens in the expected working directory and identifies the intended session; verify no prompt is auto-sent. Close the terminal. Do not resume an already-running session.
4. Confirm no agent process is silently owned or terminated by the desktop preview. Check that exiting the preview does not stop a pre-existing independent agent.
5. Mark live in-app streaming, approval handling and attach-to-active-session **Not implemented** unless separately demonstrated; opening an external terminal does not satisfy G3.

## G2 reliability — large local inventory and safe resume

The read-only discovery implementation now limits concurrent transcript metadata reads to **12**. Synthetic tests verify that its worker pool respects a concurrency ceiling and preserves result order; they do **not** prove acceptable Windows disk latency or handle usage.

On a Windows host with a representative existing Claude Code/Codex history, measure the time to first inventory, a second refresh, UI responsiveness while refreshing, and whether the official clients remain usable. Record only elapsed time, session counts and coarse CPU/memory/handle observations—not transcript text, paths or account identifiers. Repeat with a large disposable fixture if feasible; do not manufacture or overwrite actual agent histories. Treat excessive latency, UI hangs, open-file errors or unexpected process launches as failures requiring remediation.

The **Resume in Windows terminal** button is not safe attachment to an active process. The app cannot currently prove session ownership or activity status. Only test on a known inactive disposable session after confirming the project and reading the warning; never use an actively running session to validate resume. A CLI can potentially continue its own pending work even though the app sends no prompt.

## REL-001 / issue #3 — first-party interference control

Run normal provider conversations in the official browser while the preview starts, switches providers, displays two panes, refreshes local metadata and quits. Check before/during/after behavior without spamming retries. If the failure reported on October 19 recurs, change **one** competing app/extension at a time, record which change first restores the browser, and avoid claiming a cause without isolation. Never export raw network headers or session data.

## Minimal redacted result record

| Field | Example |
| --- | --- |
| Build commit and Actions run | `<sha>`, `<run-id>` |
| OS / provider / action | Windows 11 / Claude / existing chat open |
| Result | Pass / Fail / Blocked / Not tested |
| Observation | OAuth popup blocked; no workaround attempted |
| Official browser before/during/after | OK / OK / OK |
| Evidence | Local timestamp, screenshot with chat contents/account details hidden |
| Next decision | Fix app / provider limitation: browser composition pivot / retest |

**Release rule:** Issue #2 and all P0 real-host gates remain open until evidence is collected. Issue #3 remains an investigation, not an Echoes root-cause finding. G1 failure on major providers triggers an OS-level browser-window composition feasibility study or product pause—not credential extraction, stealth scraping or synthetic-pass relabeling.
