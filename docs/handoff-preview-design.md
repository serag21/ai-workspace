# Handoff preview — local-only design (NOT wireable yet)

**Status: DESIGN ONLY, owner approval required before any exposure.**
This document is the AW-007 local-only preview design for the QW-007 handoff
surface. It deliberately contains **no IPC handlers, no UI routes, and no send
path**. Exposing the builder to the desktop preview, or to any external
destination, is an owner decision (charter "Next 3", QW-007).

## What the preview shows (fabricated fixture data only)

A single "Preview handoff" pane rendered from `buildHandoffPayload()` output,
populated with a fixed fabricated fixture (a made-up repo, made-up branch, made-up
sections, invented token-shaped artifact paths). The pane displays:

1. **Source binding** — provider, conversation id, title, and the per-field
   `observed|inferred|missing` evidence flags exactly as declared.
2. **Project binding** — name / repo path / branch / commit with flags and the
   `bindingComplete` indicator (a name without a repo path must read as
   incomplete, not as a binding).
3. **Sections in ship order** — the summary is always first; each section shows
   its evidence flag; omitted sections appear under an **Omissions** list with
   the byte-cap reason, verbatim from `payload.omissions`.
4. **Artifact manifest** — included vs excluded paths, sizes (or "unknown"),
   and per-artifact `sha256` when present. Excluded paths are visually
   separated; they are part of the *local document*, not of the outgoing set.
5. **Secret-scan panel** — count and `{id, index, section}` findings for the
   outgoing text only; the panel states plainly that findings are token-shape
   flags requiring manual review, and that no secret text is carried in them.
6. **Destination block** — provider + manual mode, with `autoSend: false` shown
   explicitly. There is no other destination state in this schema.
7. **Validation verdict** — `validateHandoffPayload()` problems/warnings for
   the *same* object that would be handed over, so a tampered or foreign-schema
   payload visibly fails before any human could act on it.

The pane's copy repeats the honesty contract: *nothing in this preview has
been sent anywhere; nothing has touched a provider account.*

## Consent model (future, owner-approved scope)

- **Build → validate → preview** are one local action; only the preview step
  has a visible affordance ("Review").
- **Copy is manual:** the human copies what they reviewed. No auto-clipboard,
  no paste-into-provider, no upload control exists in this design.
- A second explicit step (a typed or clicked consent control that names the
  destination mode — `manual-paste` vs `external-terminal`) must precede any
  action that could move text out of the app. Until the owner approves that
  step, the preview is read-only.
- Secret findings block the consent control until each finding is explicitly
  dismissed as reviewed (dismissal is recorded locally in the preview session
  only, and never written into the outgoing payload).

## IPC boundary (if and when approved)

- Owner-window IPC only: `spike:handoff-build` takes a serialized input and
  returns the payload + validation verdict. It builds and validates; it has no
  network, child process, or file-write capability.
- The renderer never holds provider credentials; the preview reads only the
  builder's output plus the fixture.
- `autoSend` cannot appear as `true` anywhere in the wire shape; the validator
  treats it as a payload problem if it does.

## Hard constraints (non-negotiable, mirrored by tests)

- Construction-only: no send path, no provider traffic, no disk writes
  (HAND-003).
- Omissions and missing facts named (HAND-002); evidence flags consistent — a
  text section may never claim `missing` (HAND-005); artifact inclusion is an
  explicit `true` (HAND-006).
- Secret scan is high-precision, location-only, never embedded in outgoing
  text (HAND-007).
- Real conversation data, real repo paths from live sessions, or real token
  values must not enter the preview until the owner explicitly approves and
  the acceptance matrix (HAND-001…007, G2) has been run on a real host.

## Not delivered yet (owner decision)

- UI wiring in `index.html`/`preload.cjs`/`main.cjs`.
- Any live acceptance of an actual handoff (AW-014, LATER, post-G1/G2).
- Diff excerpts, test-run evidence capture, or cross-conversation context —
  all remain design-level until QW-007 acceptance defines what "verified"
  means for them.
