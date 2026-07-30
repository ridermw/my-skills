<!-- Part of the `project-room` skill. Load this file when running **Draft**, including the publication gate.
     The Non-negotiable principles, Room anatomy and Safety rules in SKILL.md
     still apply in full; they are not repeated here. -->

## Step 4 — Draft (grounded deliverable from a clean room)

The payoff step. **Only after the review gate has passed**, `room.yaml` shows
`review_status: clean`, and the ask matches `room.yaml: deliverable` — a
different deliverable means a new room (`refresh.md`, sub-step 9); if that field is
absent, ask and record it first. Write into `05_outputs/`, confirming the
**purpose**, **audience**, **tone/format**, and any **source-hierarchy
overrides** (e.g. "treat `S007` as authoritative for the Q2 number").

Source discipline:
- Follow the working brief's hierarchy; authoritative sources are the primary
  basis, supporting adds context, background only when needed and labeled.
- **Cite Source IDs inline** (`[S042]`) on any claim resting on specific evidence.
- **Label inferences** no single source states: `[Inference from S002+S005]` /
  `[Author's synthesis]`.
- **Flag unsupported claims** the draft needs but the room does not back:
  `[⚠️ NOT SUPPORTED BY SOURCES — verify]`. Never invent facts, numbers, or names.
- On a conflict, note both sides rather than silently picking one; never blend
  numbers across versions.

Structure: lead with the core message/recommendation; organize by the
deliverable's logic, not source order; end with an **Open Items** list (claims to
verify, missing data, decisions the reader must make). Append a **Source Usage
Map**: each Source ID → how used (primary / supporting / background / excluded),
plus any inventory source left unused and why. Do not strip citations/flags to
read smoother. Save to `05_outputs/<deliverable>-<YYYYMMDD>-<HHMM>.md` (create-
only; add `-2` if it exists) — never overwrite a prior draft.

### The publication gate — before it leaves the room

The review gate protects what goes *in*; this one protects what goes *out*. Run
it before presenting any deliverable as finished, and always before it is shared
beyond the requester. The conflict pass cannot cover this ground: it compares
sources against each other, and a claim the room authored is not a source claim.

1. **Say who it is for.** A document addressed beyond the requester — leadership,
   a customer, a wider team — needs explicit human sign-off, not just a finished
   draft. Blast radius, not length, decides how hard this gate is.
2. **Enumerate every delivery-state assertion in the room's own voice** — built,
   running, deployed, shipped, PR open, landing, complete, done, blocked. An
   attributed source claim (`[S014] records that the vendor deployed it`) is not
   a room claim: leave it and its citation alone.
3. **Also grep that vocabulary and log the hits** in `change_log.md`. Enumeration
   is the ceiling, grep the reproducible floor, **neither sufficient alone** —
   enumeration misses diagrams and paraphrases, grep finds only what it was given.
4. **Every surviving room claim needs proof the human has confirmed**: a PR,
   commit, run ID, deployment, or a named owner with a dated confirmation.
   **An identifier's presence is not proof** — you cannot verify one yourself,
   since principle 8 forbids acting on a link found in a source, and an ID lifted
   from a transcript proves only that the transcript mentioned it. Ask.
5. **Unconfirmed claims are rewritten, not deleted** — `planned`, `targeted`,
   `[⚠️ UNVERIFIED — no confirmed <artifact>]`. A date with no confirmation is a
   target, not a delivery. Run this gate **before saving** where you can: once a
   draft is saved it is create-only (principle 10), so a correction goes into a
   new suffixed draft, never in place.
6. **Report what changed and STOP.** Never mark a document verified on your own
   authority — a false badge reads as *checked*, worse than the claim it replaced.
