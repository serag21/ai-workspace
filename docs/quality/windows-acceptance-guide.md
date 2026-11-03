# AI Workspace Preview — owner acceptance guide (AW-009)

**What this is.** A single unsigned Windows x64 preview zip with everything needed to judge it in one sitting: the app, this guide, a safe test attachment, and a SHA-256 checksum. **What it is not:** a release, an installer, or evidence that provider sign-in works. Recording what *doesn't* work — honestly — is exactly what this test is for.

The whole test is designed for one flow: **launch → run the in-app checklist → save the report → send the two files back.** No developer tools, no log files to hunt for, no typing in a terminal.

## 1. Before you start (≈2 minutes)

1. **Pick a disposable provider account** for any sign-in steps. Never use your real account for this.
2. Keep **one normal chat open in your regular browser** (ChatGPT, Claude or Gemini) for the whole test — the app must not disturb it.
3. Note the **Actions run commit** (40 hex characters) of the run you downloaded the zip from. Step 4 verifies the build matches it.

## 2. Verify and extract

The package is a folder containing the app plus these files:

| File | Purpose |
| --- | --- |
| `AI-Workspace-Preview-Windows-x64.zip` | The app (extract its *whole contents* into a folder of its own) |
| `AI-Workspace-Preview-Windows-x64.zip.sha256` | Checksum of the zip |
| `Owner-Acceptance-Guide.md` | This guide |
| `SAFE-TEST-ATTACHMENT.txt` | The only file you may attach during testing (it is harmless) |

**Optional checksum check (PowerShell, in the folder containing both files):**

```powershell
$expected = (Get-Content .\AI-Workspace-Preview-Windows-x64.zip.sha256).Trim()
$actual = (Get-FileHash -Algorithm SHA256 .\AI-Workspace-Preview-Windows-x64.zip).Hash.ToLower()
if ($actual -ne $expected) { "MISMATCH" } else { "OK" }
```

**Extract with a standard tool** (right-click → Extract here, or 7-Zip/WinRAR), preserving the folder structure. Windows may show a **SmartScreen** warning — this build is unsigned by design. That is expected, not a defect; choose **More info → Run/Allow** to continue.

## 3. Launch and confirm build identity

1. Double-click **`AI Workspace Preview.exe`** inside the extracted folder.
2. The window opens with a left sidebar and four layout buttons (**One chat / Two chats / Stack chats / Chat + local agents**), a **“Owner acceptance test”** button, and a small **build chip near the title** showing the embedded commit (e.g. `111111122222…`).
3. **Compare the chip to the Actions run commit from step 1.** If the chip does not start with the same characters, stop and report that mismatch — you may be running a different build than the one you verified.

## 4. Run the in-app checklist

1. Click **Owner acceptance test**. A checklist of 19 items opens, each with:
   - a plain-language step to perform (do the step in the app beside you),
   - a result dropdown: **Pass / Fail / Blocked / Not tested**,
   - an optional note (≤400 characters).
2. Go top to bottom. **Record what actually happens** — if a step didn't work, `Fail` with a short note is the right answer; if the provider or platform prevented it (e.g. "popup was blocked"), that is **`Blocked`, and recording it IS the test** — do not look for workarounds or bypasses.
3. Where you choose not to test a step (e.g. the optional resume step without a safe disposable session), `Not tested` is an honest and complete answer.
4. **Notes are automatically scrubbed before saving:** links, e-mail addresses, and long token-shaped values are replaced, and notes are length-capped. You can safely paste what you saw; you don't need to censor yourself. What you still shouldn't do: attach private files, or type in secrets you don't want stored locally.

## 5. Save and send the report

1. Click **Save acceptance report**. The app writes **two files to your Downloads folder**:
   - `AI-Workspace-acceptance-<stamp>.md` — human-readable report,
   - `AI-Workspace-acceptance-<stamp>.json` — the same data for machine checking.

   Nothing is uploaded, sent, or synced anywhere. Saving is a local file write.
2. The saved paths and a **30-second summary** (build + `N pass · N fail · N blocked · N not tested`) are shown in the panel — select-all, copy, and paste it where you report back.
3. **Send both files (or the summary) back.** That's the whole deliverable.

## 6. Safe-data rules

- Use only the disposable account and the `SAFE-TEST-ATTACHMENT.txt` file for provider steps.
- Do not screenshot chat contents, account details, or login pages when reporting.
- The report contains **no** credentials, cookies, paths, session IDs or conversation text — only states, counts, build identity, and your notes after scrubbing.

## 7. Known limitations of this preview (context for results)

- **Popup sign-in is blocked by design.** Any provider that requires a popup/OAuth page will show **Popup blocked** — that is a limitation the test is meant to surface, not a bug to fix in the field.
- The app is a **feasibility preview**: no auto-updates, no telemetry, no scheduled tasks, no background services. Closing the window ends the process.
- Some items (attachments, model picker) depend on what that provider/account actually offers — if the control isn't there, record `Not tested` or `Blocked`, don't force a result.

## 8. Rollback / uninstall

There is nothing to uninstall:

1. Delete the extracted folder.
2. Optionally delete `C:\Users\<you>\AppData\Roaming\AI Workspace Preview` (contains session cache and, if a startup failure occurred, a small `startup-failure.log`).
3. No scheduled tasks, services, or startup entries are created by this build.

## 9. Troubleshooting

- **A dialog says the preview "could not start":** that is the honest startup-failure report, not a blank window. Open `%APPDATA%\AI Workspace Preview\startup-failure.log`, note the line, and include it in your report.
- **Blank window with no dialog:** that would contradict the startup-failure behavior; close it and re-launch. If it repeats, record it as `Fail` on "App launches from the downloaded zip".
- **Antivirus quarantines the .exe:** record which product did so and restore/quarantine status; don't disable antivirus to proceed.
- **A provider page never renders:** record the status line under the pane (e.g. "Load failed" + numeric code) — copy the code, not any URL.
