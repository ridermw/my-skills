# my-skills

Portable, self-contained **agent skills** for GitHub Copilot CLI, Claude Code,
and Cursor.

A "skill" is a folder with a `SKILL.md` entry point and YAML frontmatter that an
AI coding agent loads and follows. Larger skills include supporting Markdown
files loaded on demand. Copy the whole folder, not just the entry point; the
skill's own instructions travel together without a build or installation step.

## Skills

| Skill | Author | What it does |
| --- | --- | --- |
| [`project-room`](skills/project-room/) | this repo | Turn a messy pile of sources into an inspectable "project room" — source inventory, duplicate/conflict/missing-context logs, per-source summaries, working brief — then draft a **grounded, source-cited deliverable** from the reviewed room. Preparation before drafting; stable source IDs; never overwrites originals or invents facts. Works with zero prior setup. |
| [`adversarial-review`](skills/adversarial-review/) | this repo | Pressure-test an idea, plan, or change with genuinely independent reviewers instead of a generic pros/cons list. SPAR mode for decisions, Rubber Duck mode for code/plans; premortem pass, consensus-ranked findings, evidence standards, and honest disclosure when model diversity or subagents aren't available. Selects frontier models dynamically from OpenAI, Anthropic and xAI, requests `xhigh` effort, and pins no model versions. |
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

All skill folders contain Markdown instructions rather than executables.
Operational workflows still need the corresponding environment capabilities:

- `sync-repos` — needs `git` on `PATH` and an agent that can run shell commands.
  Its reference loop uses Bash/POSIX utilities; native Windows hosts need Git
  Bash/WSL or a faithful PowerShell translation.
- `ado-pr-build-monitor` — needs Azure DevOps access, via either the
  [Azure DevOps MCP server](https://github.com/microsoft/azure-devops-mcp) or the
  Azure CLI with the `azure-devops` extension. Logs require authenticated GET
  access to the Build API when the connector does not expose them.
- `plan-mega-review` — works locally on its own. Its optional independent pass
  reuses an installed `adversarial-review` skill and available subagent tools;
  missing optional capabilities are disclosed rather than guessed.

## Updating

```bash
cd my-skills && git pull
cp -R skills/<skill-name> ~/.copilot/skills/<skill-name>   # re-copy after pull
```
(Or symlink `~/.copilot/skills/<skill-name>` → this repo's folder to skip the copy.)

## Contributing

Each skill must stay **self-contained** — a single `SKILL.md`, plus optional
supporting `.md` files in the same folder when a skill is large enough that
loading everything up front is wasteful. Supporting files are markdown only: no
executables, no install step, no machine-specific paths or private tools. A
skill must work by copying its folder and nothing else. Be honest about
guardrails. PRs welcome.

Keep `description` within the Agent Skills specification's 1,024-character
limit. `allowed-tools`, where used, is a space-separated scalar; its
host-specific preapproval hints do not replace a skill's written safety rules.

### Verification

Repository-only regression coverage lives outside the distributable skill
folders. With Python 3.9+, Git, and Bash:

```bash
python3 -B -m unittest discover -s tests -v
```

The suite executes the shipped shell examples in temporary local Git
repositories and room fixtures, and checks scalar frontmatter constraints.
It needs no network, Azure credentials, or third-party Python packages.
`tests/skill_scenarios.json` supplies dry-run agent scenarios for the ADO,
review-mode, and room-maintenance instructions; run them against the full
affected skills before changing their workflow. These are separate from the
automated suite and do not claim live Azure integration coverage.

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
