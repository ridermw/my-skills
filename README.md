# my-skills

Portable, self-contained **agent skills** for GitHub Copilot CLI, Claude Code,
and Cursor.

A "skill" is a single Markdown file (`SKILL.md`) with YAML frontmatter that an AI
coding agent loads and follows. Every skill here is self-contained — one file, no
external setup — so you can drop it into your tool's skills directory and go.

## Skills

| Skill | Author | What it does |
| --- | --- | --- |
| [`project-room`](skills/project-room/) | this repo | Turn a messy pile of sources into an inspectable "project room" — source inventory, duplicate/conflict/missing-context logs, per-source summaries, working brief — then draft a **grounded, source-cited deliverable** from the reviewed room. Preparation before drafting; stable source IDs; never overwrites originals or invents facts. Works with zero prior setup. |
| [`adversarial-review`](skills/adversarial-review/) | this repo | Pressure-test an idea, plan, or change with genuinely independent reviewers instead of a generic pros/cons list. SPAR mode for decisions, Rubber Duck mode for code/plans; premortem pass, consensus-ranked findings, evidence standards, and honest disclosure when model diversity or subagents aren't available. |
| [`sync-repos`](skills/sync-repos/) | this repo | Bulk-update a folder of git clones in one pass: fetch, fast-forward, and report what advanced, what's dirty, what diverged, and what errored. Deliberately safe — `fetch` and `--ff-only` only; never force, reset, stash, or push. |
| [`ado-pr-build-monitor`](skills/ado-pr-build-monitor/) | this repo | Watch an Azure DevOps PR's build/policy gates to a terminal state, confirm work-item linkage, and on failure surface the failing stage plus root-cause log lines. Read-only: never comments, votes, or completes the PR. |
| [`plan-exit-review`](skills/plan-exit-review/) | [Garry Tan](https://github.com/garrytan/gstack) (MIT), adapted | Bounded, interactive engineering-readiness review of a plan before coding: scope challenge → architecture → code → tests → performance, with recommendation-first questions. Review only. |
| [`plan-mega-review`](skills/plan-mega-review/) | [Garry Tan](https://github.com/garrytan/gstack) (MIT), adapted | Maximum-rigor review for high-risk/cross-cutting plans (EXPANSION / HOLD / REDUCTION): system audit, failure-mode registry, threat model, observability + deploy. Review only. |

## Install

Each skill is a folder under `skills/`. Install one by copying (or symlinking)
its folder into your tool's skills directory as `<skill-name>/SKILL.md`.

**GitHub Copilot CLI**
```bash
git clone https://github.com/ridermw/my-skills
cp -R my-skills/skills/<skill-name> ~/.copilot/skills/<skill-name>
```

**Claude Code**
```bash
cp -R my-skills/skills/<skill-name> ~/.claude/skills/<skill-name>
```

**Cursor / other agents**: copy `skills/<skill-name>/` into your tool's skills
directory.

Install all of them at once:
```bash
cp -R my-skills/skills/* ~/.copilot/skills/
```

Then invoke one — say "use the project-room skill", or use a trigger phrase from
the skill's description (e.g. "organize my sources", "sync all my repos",
"pressure-test this plan").

### Requirements

All skills are plain Markdown and work with any agent that loads `SKILL.md`
files. Two have optional external dependencies:

- `sync-repos` — needs `git` on `PATH` and an agent that can run shell commands.
- `ado-pr-build-monitor` — needs Azure DevOps access, via either the
  [Azure DevOps MCP server](https://github.com/microsoft/azure-devops-mcp) or the
  Azure CLI with the `azure-devops` extension.

## Updating

```bash
cd my-skills && git pull
cp -R skills/<skill-name> ~/.copilot/skills/<skill-name>   # re-copy after pull
```
(Or symlink `~/.copilot/skills/<skill-name>` → this repo's folder to skip the copy.)

## Contributing

Each skill must stay **self-contained** (a single `SKILL.md`), portable (no
machine-specific paths or private tools), and honest about its guardrails. PRs
welcome.

## Credits & third-party skills

`plan-exit-review` and `plan-mega-review` are adapted from **Garry Tan's** skills
in [gstack](https://github.com/garrytan/gstack) (MIT © Garry Tan, upstream
version 2.0.0), modified for standalone, cross-stack use — portability,
tool-independent questions, a review-only boundary, and safety fixes. Each skill
folder keeps its own `LICENSE` preserving Garry's copyright alongside the
modifications. See [`NOTICE`](NOTICE).

- Original source: https://github.com/garrytan/gstack
- The suite these evolved into (plan-eng/ceo/design/devex-review + autoplan): same repo.

## License

[MIT](LICENSE) © Matthew Williams covers this repo's own work (`project-room`,
`adversarial-review`, `sync-repos`, `ado-pr-build-monitor`).
The adapted `plan-exit-review` / `plan-mega-review` are MIT © Garry Tan with
modifications MIT © Matthew Williams — see each folder's `LICENSE` and
[`NOTICE`](NOTICE).
