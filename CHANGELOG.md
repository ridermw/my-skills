# Changelog

All notable changes to the skills in this repo.

## [Unreleased]

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
