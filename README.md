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
| [`plan-exit-review`](skills/plan-exit-review/) | [Garry Tan](https://github.com/garrytan/gstack) (MIT), adapted | Bounded, interactive engineering-readiness review of a plan before coding: scope challenge → architecture → code → tests → performance, with recommendation-first questions. Review only. |
| [`plan-mega-review`](skills/plan-mega-review/) | [Garry Tan](https://github.com/garrytan/gstack) (MIT), adapted | Maximum-rigor review for high-risk/cross-cutting plans (EXPANSION / HOLD / REDUCTION): system audit, failure-mode registry, threat model, observability + deploy. Review only. |

## Install

Each skill is a folder under `skills/`. Install one by copying (or symlinking)
its folder into your tool's skills directory as `<skill-name>/SKILL.md`.

**GitHub Copilot CLI**
```bash
git clone https://github.com/ridermw/my-skills
cp -R my-skills/skills/project-room ~/.copilot/skills/project-room
```

**Claude Code**
```bash
cp -R my-skills/skills/project-room ~/.claude/skills/project-room
```

**Cursor / other agents**: copy `skills/project-room/` into your tool's skills
directory.

Then invoke it — say "use the project-room skill", or use a trigger phrase from
the skill's description (e.g. "organize my sources", "new project room").

## Updating

```bash
cd my-skills && git pull
cp -R skills/project-room ~/.copilot/skills/project-room   # re-copy after pull
```
(Or symlink `~/.copilot/skills/project-room` → this repo's folder to skip the copy.)

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

[MIT](LICENSE) © Matthew Williams covers this repo's own work (`project-room`).
The adapted `plan-exit-review` / `plan-mega-review` are MIT © Garry Tan with
modifications MIT © Matthew Williams — see each folder's `LICENSE` and
[`NOTICE`](NOTICE).
