---
name: sync-repos
description: 'Use when the user wants to update or sync many local git repositories at once — "pull latest for all repos", "sync all repos from main", "walk through the repos and pull", "update all my git repos", "fetch all clones", or bulk fast-forward across a folder of git checkouts. Read-only-safe; fetches and fast-forwards only, never force/reset/stash/push.'
---

# Sync Repos — bulk fetch + fast-forward across many local clones

Update a folder full of git clones in one pass: fetch each, fast-forward the
default branch (and the current branch when it is clean and tracking), then
report exactly what advanced, what was skipped, and what needs attention.

This is deliberately **safe**. It only ever runs `git fetch` and
`git merge --ff-only` / `git pull --ff-only`. It never force-pushes, resets,
checks out over dirty state, stashes, or discards anything. Repos with local
changes or diverged history are reported, not touched.

## When to use

- "walk through the repos and pull latest" / "sync all repos from main"
- "update all my git repos" / "fetch everything under ~/git"
- Any request to refresh a directory of clones before starting work.

Do **not** use this to reconcile a fork with heavy local divergence, resolve
merge conflicts, or rebase — those need a per-repo interactive decision. Flag
such repos in the report and stop.

## Inputs

- **root** (optional): directory to scan. Default order:
  1. An explicit path the user gave.
  2. The current working directory if it contains 2+ git clones.
  3. `~/git` as a fallback.
  If none of these clearly applies, ask the user for the root before scanning.
- **scope** (optional): `default-branch` (default) or `current-branch`.
  - `default-branch` — update each repo's main/default branch (matches "sync
    from main"). Does not switch away from a dirty or feature branch.
  - `current-branch` — fast-forward whatever branch is checked out (matches
    "pull latest").

## Procedure

1. **Discover clones.** Find top-level git repos under `root` (depth 1–2, do not
   recurse into a repo's own subdirs or `node_modules`). A directory is a clone
   if it contains a `.git` entry.
2. **Per repo, gather state first (no network):** current branch, dirty flag
   (`git status --porcelain`), and the default branch
   (`git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, falling back to
   `main`/`master`).
3. **Fetch:** `git fetch --all --prune --quiet`. If it fails (no remote, auth,
   network), record `error: <reason>` and continue to the next repo.
4. **Fast-forward safely:**
   - If the working tree is **dirty** → do not pull. Record `dirty (skipped)`.
     Still report ahead/behind counts so the user knows if it is stale.
   - `scope=current-branch`: if the current branch has an upstream and is clean,
     `git merge --ff-only @{u}`. If it is not a fast-forward, record
     `diverged (needs manual merge)` and leave it alone.
   - `scope=default-branch`: update the default branch without checkout when it
     is not the current branch, using
     `git fetch origin <default>:<default>` (this fails safely and does nothing
     if it would not be a fast-forward — record `diverged` in that case). If the
     default branch **is** the current branch and clean, use `git merge --ff-only`.
5. **Never** run `git reset`, `git checkout -f`, `git stash`, `git rebase`, or
   any push. Never pass `--force`.
6. **Report** (table + one-line summary):

   | repo | branch | result |
   |------|--------|--------|
   | api-service | main | advanced 6 commits |
   | web-client | feature/x | dirty (skipped), 2 behind |
   | shared-lib | main | up-to-date |
   | infra-tools | main | diverged (needs manual merge) |
   | legacy-svc | main | error: auth failed |

   End with: `N repos: X advanced, Y up-to-date, Z skipped-dirty, W diverged, V errors.`
   List the diverged/error/dirty repos again as an explicit "needs attention"
   line so nothing important scrolls off.

## Ready-to-run reference

Adapt the root as needed. This is read-only except for fetch + ff-only.

```bash
ROOT="${1:-$PWD}"; SCOPE="${2:-default-branch}"
# Never block on a credential prompt — a single private repo must not hang the run.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"
find "$ROOT" -maxdepth 2 -name .git -type d 2>/dev/null | while read -r g; do
  repo="$(dirname "$g")"; name="$(basename "$repo")"
  cur="$(git -C "$repo" branch --show-current 2>/dev/null)"
  [ -z "$cur" ] && { printf '%s\t%s\t%s\n' "$name" "detached" "detached (skipped)"; continue; }
  def="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  [ -z "$def" ] && def="$(git -C "$repo" show-ref --verify --quiet refs/heads/main && echo main || echo master)"
  dirty="$(git -C "$repo" status --porcelain 2>/dev/null | head -1)"
  git -C "$repo" fetch --all --prune --quiet 2>/dev/null || { echo "$name	$cur	error: fetch failed"; continue; }
  if [ -n "$dirty" ]; then echo "$name	$cur	dirty (skipped)"; continue; fi
  if [ "$SCOPE" = "current-branch" ] && git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
    before="$(git -C "$repo" rev-parse HEAD)"
    git -C "$repo" merge --ff-only @{u} --quiet 2>/dev/null \
      && { after="$(git -C "$repo" rev-parse HEAD)"; [ "$before" = "$after" ] && echo "$name	$cur	up-to-date" || echo "$name	$cur	advanced"; } \
      || echo "$name	$cur	diverged (needs manual merge)"
  else
    if [ "$cur" = "$def" ]; then
      git -C "$repo" merge --ff-only "origin/$def" --quiet 2>/dev/null && echo "$name	$def	updated" || echo "$name	$def	diverged (needs manual merge)"
    else
      git -C "$repo" fetch origin "$def:$def" --quiet 2>/dev/null && echo "$name	$def	default updated (on $cur)" || echo "$name	$def	diverged or in-use"
    fi
  fi
done
```

Prefer running the loop and then presenting a clean table to the user rather
than dumping raw tab output. If there are many repos, run the fetches and
summarize; do not narrate each repo.

## Edge cases

- **Worktrees / submodules:** skip nested `.git` inside a repo; treat only
  top-level clones. Do not auto-update submodules unless asked.
- **No `origin/HEAD`:** fall back to `main` then `master`; if neither exists,
  report `no default branch`.
- **Detached HEAD:** report `detached (skipped)`, never fast-forward.
- **Auth prompts:** if a fetch would block on credentials, record it as an error
  and move on — never hang the whole run on one repo.
- **Large trees:** cap discovery depth at 2; if the user points at a huge root,
  confirm scope before scanning thousands of directories.

## Stop condition

Done when every discovered repo has a recorded result and the summary line is
produced. Anything requiring a human decision (diverged, dirty with important
changes, auth error) is surfaced in the "needs attention" line — do not attempt
to resolve it automatically.
