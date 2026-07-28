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
   if it contains a `.git` **directory**; linked worktrees and submodules, where
   `.git` is a file, are skipped (see Edge cases).
2. **Confirm a remote exists**, then **fetch:** `git fetch --all --prune --quiet`.
   A repo with no remote is `error: no remote` — note that `fetch --all` exits 0
   there, so check `git remote` first rather than relying on the fetch to fail.
   If the fetch itself fails (auth, network), record `error: fetch failed` and
   continue to the next repo.
3. **Resolve the default branch** from
   `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, falling back to
   `refs/remotes/origin/main` then `refs/remotes/origin/master`. If none exists,
   record `no default branch` and skip. Resolve this *after* fetching so a stale
   or absent `origin/HEAD` is refreshed first.
4. **Read local state (no network):** current branch and dirty flag
   (`git status --porcelain`).
5. **Fast-forward safely.** Every result must be distinguishable — always capture
   the branch tip **before** and **after** the operation and derive the result
   from the difference. Never report success on exit code alone: `merge --ff-only`
   and `fetch <b>:<b>` both exit 0 when nothing moved, so an exit-code-only check
   cannot tell `advanced` from `up-to-date`.
   - **Dirty** working tree → do not pull. Record `dirty (skipped), N behind`,
     counting with `git rev-list --count HEAD..@{u}` (or `..origin/<default>`
     when there is no upstream) so the user knows how stale it is.
   - `scope=current-branch`: if the current branch has no upstream, record
     `no upstream (skipped)` — do **not** silently fall back to the default
     branch. Otherwise `git merge --ff-only @{u}`; if that fails, record
     `diverged (needs manual merge)`.
   - `scope=default-branch`, default branch **is** checked out:
     `git merge --ff-only origin/<default>`.
   - `scope=default-branch`, default branch **is not** checked out: update it
     without checkout via `git fetch origin <default>:<default>`. This fails
     safely and changes nothing if it would not be a fast-forward — but it fails
     the same way when that branch is checked out in another worktree, so read
     stderr and separate `in use by another worktree (skipped)` from
     `diverged (needs manual merge)`. They need different fixes.
6. **Never** run `git reset`, `git checkout -f`, `git stash`, `git rebase`, or
   any push. Never pass `--force`.
7. **Report** (table + one-line summary). The full result vocabulary is:
   `advanced N commits` · `up-to-date` · `created local <default>` ·
   `dirty (skipped), N behind` · `diverged (needs manual merge)` ·
   `in use by another worktree (skipped)` · `detached (skipped)` ·
   `no upstream (skipped)` · `no default branch` · `error: <reason>`.
   When the default branch was updated while another branch is checked out,
   suffix `(on <current>)`.

   | repo | branch | result |
   |------|--------|--------|
   | api-service | main | advanced 6 commits |
   | web-client | feature/x | dirty (skipped), 2 behind |
   | shared-lib | main | up-to-date |
   | infra-tools | main | diverged (needs manual merge) |
   | legacy-svc | main | error: fetch failed |

   End with: `N repos: X advanced, Y up-to-date, Z skipped, W diverged, V errors.`
   List the diverged/error/dirty repos again as an explicit "needs attention"
   line so nothing important scrolls off.

## Ready-to-run reference

Adapt the root as needed. This is read-only except for fetch + ff-only.

```bash
ROOT="${1:-$PWD}"; SCOPE="${2:-default-branch}"
# Never block on a credential prompt — one private repo must not hang the run.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"
r() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }
find "$ROOT" -maxdepth 2 -name .git -type d 2>/dev/null | while read -r g; do
  repo="$(dirname "$g")"; name="$(basename "$repo")"
  cur="$(git -C "$repo" branch --show-current 2>/dev/null)"
  [ -z "$cur" ] && { r "$name" "detached" "detached (skipped)"; continue; }
  git -C "$repo" remote | grep -q . || { r "$name" "$cur" "error: no remote"; continue; }
  git -C "$repo" fetch --all --prune --quiet 2>/dev/null || { r "$name" "$cur" "error: fetch failed"; continue; }
  def="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  for b in main master; do
    [ -n "$def" ] && break
    git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/$b" && def="$b"
  done
  [ -z "$def" ] && { r "$name" "$cur" "no default branch"; continue; }
  dirty="$(git -C "$repo" status --porcelain 2>/dev/null | head -1)"
  if [ -n "$dirty" ]; then
    ref="origin/$def"; git -C "$repo" rev-parse --verify --quiet '@{u}' >/dev/null 2>&1 && ref='@{u}'
    r "$name" "$cur" "dirty (skipped), $(git -C "$repo" rev-list --count "HEAD..$ref" 2>/dev/null || echo '?') behind"; continue
  fi
  if [ "$SCOPE" = "current-branch" ]; then
    git -C "$repo" rev-parse --verify --quiet '@{u}' >/dev/null 2>&1 || { r "$name" "$cur" "no upstream (skipped)"; continue; }
    target="$cur"; upstream='@{u}'
  else
    target="$def"; upstream="origin/$def"
  fi
  if [ "$target" = "$cur" ]; then                       # update in place, ff-only
    before="$(git -C "$repo" rev-parse HEAD)"
    if git -C "$repo" merge --ff-only "$upstream" --quiet 2>/dev/null; then
      after="$(git -C "$repo" rev-parse HEAD)"
      [ "$before" = "$after" ] && r "$name" "$target" "up-to-date" \
        || r "$name" "$target" "advanced $(git -C "$repo" rev-list --count "$before..$after") commits"
    else r "$name" "$target" "diverged (needs manual merge)"; fi
  else                                                   # update default branch without checkout
    before="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$def")"
    if err="$(git -C "$repo" fetch origin "$def:$def" 2>&1 >/dev/null)"; then
      after="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$def")"
      if   [ -z "$before" ];         then r "$name" "$def" "created local $def (on $cur)"
      elif [ "$before" = "$after" ]; then r "$name" "$def" "up-to-date (on $cur)"
      else r "$name" "$def" "advanced $(git -C "$repo" rev-list --count "$before..$after") commits (on $cur)"; fi
    else
      case "$err" in *"checked out"*|*"in use"*|*worktree*) r "$name" "$def" "in use by another worktree (skipped)";;
                     *) r "$name" "$def" "diverged (needs manual merge)";; esac
    fi
  fi
done
```

Prefer running the loop and then presenting a clean table to the user rather
than dumping raw tab output. If there are many repos, run the fetches and
summarize; do not narrate each repo.

## Edge cases

- **Worktrees / submodules:** discovery matches only a `.git` **directory**, so
  linked worktrees and submodules (where `.git` is a file) are skipped by
  construction. Do not auto-update submodules unless asked.
- **Branch checked out elsewhere:** `fetch <b>:<b>` refuses when the branch is
  checked out in another worktree, with the same non-zero exit as a non-fast-
  forward. Report `in use by another worktree (skipped)`, not `diverged` — the
  first needs no action, the second needs a manual merge.
- **No remote at all:** `git fetch --all` exits **0** in a repo with no remotes,
  so an exit-code check will not catch it. Check `git remote` first and report
  `error: no remote`.
- **No `origin/HEAD`:** fall back to `origin/main` then `origin/master`; if
  neither exists, report `no default branch`.
- **Detached HEAD:** report `detached (skipped)`, never fast-forward.
- **No upstream (current-branch scope):** report `no upstream (skipped)` rather
  than quietly switching to the default branch — a silent scope change is worse
  than a skip.
- **Auth prompts:** if a fetch would block on credentials, record it as an error
  and move on — never hang the whole run on one repo.
- **Large trees:** cap discovery depth at 2; if the user points at a huge root,
  confirm scope before scanning thousands of directories.

## Stop condition

Done when every discovered repo has a recorded result and the summary line is
produced. Anything requiring a human decision (diverged, dirty with important
changes, auth error) is surfaced in the "needs attention" line — do not attempt
to resolve it automatically.
