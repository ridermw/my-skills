# Changelog

All notable changes to the skills in this repo.

## [Unreleased]

### Fixed
- **`project-room`** — a room-written output could be cited as evidence for a
  fact the room never observed. `05_outputs/` was the one generated directory
  missing from the inventory's exclusion list, so a room-authored document could
  be given a Source ID and an `authoritative` Authority value — the same tier as
  a direct measurement. The conflict pass cannot catch this: it compares
  *sources* against each other, and a claim inside a generated output is not a
  source claim. `05_outputs/` is now excluded alongside the other room artifacts,
  with the rule stated plainly — **renders are not sources**. Reported in #3.
- **`project-room`** — `review_status` never reached the surface a reader
  actually orients from. Step 1 reads `README.md` first, but `review_status`
  lived only in `room.yaml`, so a room whose approval had just been invalidated
  by a Refresh looked identical to an approved one. The README now carries a
  `Review status` mirror, and principle 5 and Refresh sub-step 8 keep both
  copies in sync.
- **`project-room`** — nothing ever asked whether the README `## Status
  snapshot` was still true. The Index STOP prompt enumerated counts, duplicates,
  and conflicts but never the room's headline status, and Refresh moved
  `last_refreshed` without re-checking the content underneath it — a fresh date
  over stale content is worse than an obviously old file, because the date is
  the reader's staleness signal and it lies. Both operations now check the
  snapshot and propose corrections for the human rather than editing it
  silently. Reported in #2.
- **`sync-repos`** — the reference script could not produce its own documented
  report. In the default `default-branch` scope it printed `updated` for every
  successful repo, because `git merge --ff-only` and `git fetch <b>:<b>` both
  exit 0 when nothing moved; a repo that advanced and a repo already current
  were indistinguishable, so the mandated `X advanced, Y up-to-date` summary was
  unobtainable. Both paths now capture the branch tip before and after and
  derive the result from the difference. Also fixed: `dirty` repos now report
  the promised behind-count instead of nothing; a repo with no `origin` remote is
  reported as `error: no origin remote` rather than misread as `no default
  branch` (and `git fetch --all` exits 0 with no remotes at all, so the fetch
  could not serve as the guard); a branch checked out in
  another worktree is separated from a genuinely diverged one; a missing
  upstream in `current-branch` scope is reported rather than silently falling
  back to the default branch; and `no default branch` is now reachable. The
  prose result vocabulary and the script's output are now identical.

### Changed
- **`project-room`** — the review checkpoint is now a **named gate** referenced
  from the five places that used to restate it, following the same deduplication
  applied to `plan-mega-review` and `plan-exit-review`. Paired with dropping a
  menu-shape example that duplicated the picker spec and the shell snippet above
  it, this paid for the publication gate and Step 7: the file is 500 lines, at
  the guidance rather than past it.
- **`project-room`** — principle 8 now covers **room-generated files**, not only
  sources. Step 1 reads the working brief and the primary output first, so a
  prior render is re-ingested every session; it is data, not instruction, and may
  carry a claim that was never true.
- **`project-room`** — "moving a file edits every claim that addresses it by
  name" is now stated in Safety & scope, with the reference sweep required in the
  same pass as the move. Cross-references are written as bare filenames in prose,
  so a relocation silently repoints every document that named one — reorganizing
  is provenance editing. Reported in #3.
- **`project-room`** — Refresh sub-step 9 is a **hard trigger**: a request for a
  deliverable other than `room.yaml: deliverable` stops and recommends a new
  room. The Intent section now states the boundary directly — a room is a unit of
  work, not a filing cabinet. This replaces the proposed `room_kind: program`
  mode, which would have legitimized the anti-pattern rather than caught it.
- **`project-room`** — the README `## Status snapshot` and the working brief now
  have an explicit authority split: the brief owns the evidence view, the README
  owns the state view (done / next / blocked) and remains the one surface that
  says which dated document is live. Reported in #2.
- **`adversarial-review`** — model selection is version-free. The
  Model Diversity Heuristic no longer names any model or version floor; it now
  selects by *provider tier and generation* read from the runtime at request
  time, excludes the small/fast tier by the runtime's own tier description, and
  forbids hardcoding a version anywhere. A stale allow-list silently degraded
  the review by excluding models that did not exist when it was written. Also
  added a proportionality rule (do not spawn three reviewers for a trivial
  artifact) and an output-length section, and the description now states what
  the skill does, not only when to use it.
- **Trigger disambiguation across the three review skills.**
  `plan-mega-review` no longer claims the trigger `"adversarial plan review"`,
  which collided head-on with `adversarial-review`. All three descriptions now
  point at the other two, so a plan-critique request routes deterministically.
- **`plan-mega-review`** — a 36-word STOP block repeated verbatim 11 times
  (396 words) is now a single named "section STOP rule" referenced from each
  section, and the near-duplicate "CRITICAL RULE" / "For Each Issue You Find" /
  "Formatting Rules" sections are merged into one. Net 327 words lighter and
  back under the 500-line guidance, with imperative density down from 7.2 to
  2.5 per 100 lines.
- **`plan-exit-review`** — same STOP-block and duplicate-question-section
  deduplication; imperative density down from 7.7 to 4.0 per 100 lines.
- **Output-length calibration** added to `plan-mega-review`,
  `adversarial-review`, and `ado-pr-build-monitor`, which had none. Current
  models run long by default and reasoning-effort settings do not reliably
  shorten a visible response, so length has to be asked for explicitly.
- **`ado-pr-build-monitor`** — the frontmatter description no longer contains an
  angle-bracket placeholder that could be parsed as an XML tag; added a report
  template and pinned down "required build" vs "policy evaluation" vs "gate",
  which were used interchangeably.

### Added
- **`project-room`** — a **publication gate** at the end of Step 4. The skill had
  exactly one mandatory STOP, before drafting, but the failure it was meant to
  prevent happens *after* that: a room-written document reaching a reader with a
  delivery claim nothing ever checked. The gate names the audience (a document
  addressed beyond the requester needs explicit human sign-off), enumerates
  delivery-state assertions **in the room's own voice** while leaving attributed
  source claims alone, requires a logged grep pass alongside the enumeration
  because neither catches what the other misses, and requires a human-confirmed
  artifact for every surviving claim — *presence of an identifier is not proof*,
  and principle 8 means the agent cannot verify one itself. Unconfirmed claims
  are rewritten as `planned` / `targeted` / `[⚠️ UNVERIFIED]`, never deleted, and
  the agent never marks a document verified on its own authority. Reported in #3.
- **`project-room`** — **Step 7, Archive superseded outputs.** Every other
  operation adds files and the skill forbids removal, so superseded drafts
  accumulated beside current ones with no way to tell which was live. Excluding
  `05_outputs/` from the inventory (#4) removed the hazard that made this
  unsafe — outputs no longer carry inventory `Path` cells, so archiving them
  cannot dangle a source reference or falsify a history snapshot. The human names
  the set, the move plan is written to `change_log.md` *before* anything moves so
  an interrupted run is resumable, and sources are never archived this way.
  Requested in #2.
- **`adversarial-review`** — SPAR / Rubber Duck adversarial critique with
  independent reviewer contexts, a premortem pass, a review constitution,
  consensus-ranked findings with evidence standards, and mandatory disclosure of
  execution path (never claims subagents or model diversity it did not achieve).
- **`sync-repos`** — bulk fetch + fast-forward across a folder of git clones,
  with a per-repo results table and an explicit "needs attention" line. Safe by
  construction: `fetch` and `--ff-only` only; never force/reset/stash/push.
  Skips dirty and detached-HEAD repos, and disables credential prompts so one
  private repo cannot hang the run.
- **`ado-pr-build-monitor`** — read-only Azure DevOps PR gate monitor: poll
  required builds to a terminal state, confirm work-item linkage, and on failure
  report the failing stage plus root-cause log lines. Bounded `max wait`, never
  votes or completes a PR. Supports both `dev.azure.com` and legacy
  `{org}.visualstudio.com` URL forms; works via the Azure DevOps MCP server or
  the Azure CLI.
- **`plan-exit-review`** and **`plan-mega-review`** — adapted from Garry Tan's
  MIT-licensed gstack skills (MIT © Garry Tan, upstream v2.0.0), modified for
  standalone cross-stack use: portability (no Rails/CLAUDE.md/TODOS.md hard
  deps), tool-independent questions (AskUserQuestion prose fallback), review-only
  boundary, exit-review SMALL-mode fix, mega safety fixes (redacted logging,
  idempotent retry, no fabricated p99, no over-logging), disambiguated triggers,
  and an optional capability-gated independent pass. Each folder carries its own
  MIT `LICENSE`; see `NOTICE`.

## [1.0.0] — 2026-07-24

### Added
- **`project-room`** skill (v1.0). Turn a messy pile of sources into an
  inspectable project room, then draft a grounded, source-cited deliverable.
  - Portable and self-contained: works with zero prior setup; first-run
    bootstrap creates a project-rooms base (default `~/project-rooms`, override
    `PROJECT_ROOMS_DIR`) and your first room.
  - Interactive room picker when invoked with no room named; "create new project
    room" option last.
  - Six operations: Orient, Seek, Capture, Index, Draft, Refresh, New room.
  - "Seek, don't scan" retrieval (index → summary → raw slice, or a subagent as a
    context firewall) to keep the agent's context small.
  - Guardrails: preparation before drafting with a human-review checkpoint;
    stable source IDs; append-only originals; conflicts/duplicates logged not
    resolved; sensitive sources metadata-only; source content treated as
    untrusted data (prompt-injection boundary); create-only writes.
