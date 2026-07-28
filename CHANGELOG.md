# Changelog

All notable changes to the skills in this repo.

## [Unreleased]

### Fixed
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
