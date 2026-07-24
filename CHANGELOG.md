# Changelog

All notable changes to the skills in this repo.

## [Unreleased]

### Changed
- Switched Garry Tan's `plan-exit-review` / `plan-mega-review` from bundled
  mirrors to **links** (their gist text isn't openly licensed). See README
  "Related skills by others". The repo now hosts only its own MIT-licensed work.

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
