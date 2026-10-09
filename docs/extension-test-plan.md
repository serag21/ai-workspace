# Chrome extension end-to-end test plan

Use this for a release-candidate pass in a real Chrome profile. CI checks type/build/bundle, but it cannot prove website selectors, prompt delivery, tab lifecycle, or perceived performance. Complete this plan after the next stable build before publishing.

## 1. Build and install

- [ ] Run `npm install`, `npm run typecheck`, and `npm run build`.
- [ ] In `chrome://extensions`, enable Developer mode and load the generated `dist` folder.
- [ ] Confirm clicking the extension icon opens the side panel.
- [ ] Reload the extension after code changes; refresh already-open provider pages once so they receive the updated content script.
- [ ] Confirm no service-worker or side-panel errors appear in the extension's Inspect views.

## 2. Discovery and identity

- [ ] Open one existing ChatGPT conversation, one Claude conversation, and one Gemini conversation.
- [ ] Confirm all three appear without manually registering them.
- [ ] Open a second conversation on each provider and confirm distinct sessions are shown.
- [ ] Confirm titles are useful and provider labels/colors are correct.
- [ ] Open a generic provider home/new-chat tab and make sure a generic title does not overwrite a captured conversation title.
- [ ] Confirm the extension does not try to capture unrelated websites.

## 3. Status and attention

- [ ] Send a prompt from the provider page and confirm the session switches to Working.
- [ ] Wait for generation to finish and confirm Done appears briefly, then Needs you for a finished assistant response.
- [ ] Wait at least 15 seconds and one full periodic scan; confirm Needs you does not incorrectly revert to Idle.
- [ ] Confirm Working / Needs you / Done counters are workspace-wide, even when a project is selected.
- [ ] Click each attention counter and confirm it opens the All work view with the relevant filter.
- [ ] Leave a conversation where the last message is from the user; confirm it does not falsely appear as Needs you.
- [ ] Confirm a closed session never counts as an actively Working tab.

## 4. Transcript cache, search, and continuity

- [ ] Select a session and confirm recent user/assistant turns load.
- [ ] Search for a distinctive word in the title, latest preview, and a message further back in the cached transcript.
- [ ] Confirm cached-message search returns the right session, and changing/clearing the search removes stale results.
- [ ] Confirm sessions retain up to the latest 100 messages and that the UI makes the cached nature of the transcript apparent.
- [ ] Select related sessions and check the suggestions are genuinely relevant, not merely sharing generic words.
- [ ] Check that updating a selected session's transcript does not trigger repeated full snapshots or a render loop.

## 5. Closed and discarded sessions

- [ ] With a session fully captured, close its provider tab.
- [ ] Confirm the session remains in All work with a Closed state and its cached transcript remains readable.
- [ ] Send a new prompt from Workspace to that closed session.
- [ ] Confirm Workspace opens the provider page in the background, sends the prompt once, clears the composer on acknowledgement, and reflects new output.
- [ ] If delivery cannot be confirmed, verify Workspace does not blindly send the same prompt again.
- [ ] Discard a provider tab if supported by the browser and confirm it appears as Not loaded and can be reopened.
- [ ] Restart Chrome and confirm projects, assignments, pins, session records, and cached messages remain available.

## 6. Project workflow

- [ ] Move sessions between Inbox and a project.
- [ ] Pin and unpin sessions; confirm pin order persists after a refresh.
- [ ] Create a project manually.
- [ ] With multiple related Inbox chats, review suggested projects and verify nothing moves until Create & move is clicked.
- [ ] Dismiss a suggestion and confirm it stays dismissed after refresh.
- [ ] Create a suggested project whose name already exists and confirm it does not overwrite the existing project.
- [ ] Confirm search and status filters work inside All work and inside an individual project.

## 7. Start new chats and close tabs in bulk

- [ ] Choose ChatGPT in the new-chat provider selector and click New chat; confirm it creates a background tab, selects it in Workspace, and does not steal focus.
- [ ] Repeat for Claude and Gemini; verify each opens the correct new-chat surface while remaining in the user's signed-in provider session.
- [ ] Confirm each fresh chat is assigned to the currently selected project, or Inbox if All work was selected.
- [ ] Send a prompt to a new chat from Workspace; confirm it is sent once, the prompt preview appears, and the session continues to track correctly if the provider changes its URL after the first prompt.
- [ ] Confirm a provider URL transition does not leave a duplicate closed draft alongside the actual conversation.
- [ ] Close one completely blank new-chat draft; confirm this does not trigger a false “can't capture” warning.
- [ ] In a project, use Close tabs and confirm it lists/progresses through the currently visible filtered set only.
- [ ] During bulk close, verify conversation snapshots are saved before tabs are closed, and any conversation that cannot be captured and has no local cache is left open.
- [ ] Confirm bulk close never closes unrelated tabs, and completed transcript cache remains available in All work.

## 8. Reliability and performance

- [ ] Repeat quick project/session switching while one response is streaming.
- [ ] Observe ChatGPT/Claude/Gemini responsiveness with Workspace open versus closed; report any noticeable degradation.
- [ ] Leave several provider tabs open and ensure the extension is not continuously transmitting full transcripts during streaming.
- [ ] Inspect Chrome extension storage and confirm old duplicate `sessionStates` data is removed; recent previews should be compact.
- [ ] Test an unavailable content bridge and an unavailable/closed tab. Errors should be understandable and should not cause duplicated prompts.
- [ ] Reload the extension while a provider tab remains open and check the content bridge reattaches without multiplying timers/listeners.
- [ ] Check the browser console for errors, rejected promises, and selector exceptions.

## 9. Known scope boundaries

- [ ] Do not expect Workspace to reconstruct a chat that was already closed before the extension ever captured it.
- [ ] Do not expect more than the latest 100 captured messages in the local transcript pane.
- [ ] Do not expect a dedicated sign-in/rate-limit/CAPTCHA explanation for every provider yet.
- [ ] Do not expect Claude Code, Codex, Gemini CLI, terminal sessions, or a desktop app in this extension build.

## Release gate

Do not call the extension ready for public release until:
- typecheck, build, and extension-bundle CI pass on the latest commit;
- core discovery/status/send/close/reopen/search/project flows pass on all three supported providers;
- no duplicate prompt delivery occurs in the closed-session flow;
- performance impact is acceptable on real provider pages;
- limitations and local data handling are clear to a first-time user.
