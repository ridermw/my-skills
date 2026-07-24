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

## Related skills by others

Not bundled here (their gist text isn't openly licensed), but excellent
companions for planning — by **Garry Tan**:

- **plan-exit-review** — interactive pre-implementation plan review (scope
  challenge → architecture → code → tests → performance):
  https://gist.github.com/garrytan/001f9074cab1a8f545ebecbc73a813df
- **plan-mega-review** — maximum-rigor plan review (system audit, failure-mode
  registry, threat model, observability + deploy):
  https://gist.github.com/garrytan/120bdbbd17e1b3abd5332391d77963e7
- **gstack** — Garry Tan's full suite these evolved into: https://github.com/garrytan/gstack

## License

[MIT](LICENSE) © Matthew Williams. Covers the skills authored in this repo.
Linked third-party skills remain © their respective authors.
