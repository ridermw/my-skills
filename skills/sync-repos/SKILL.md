---
name: sync-repos
description: 'Use when the user wants to update or sync many local git repositories at once — "pull latest for all repos", "sync all repos from main", "walk through the repos and pull", "update all my git repos", "fetch all clones", or bulk fast-forward across a folder of git checkouts. Non-destructive, fast-forward-only; never force/reset/stash/push.'
---

# Sync Repos — bulk fetch + fast-forward across many local clones

Update a folder full of git clones in one pass: fetch each, fast-forward the
selected default or current branch when safe, then
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

1. **Discover clones.** A clone is `root` itself, or a direct child of `root`,
   that contains a `.git` **directory** — nothing deeper is scanned. Linked
   worktrees and submodules, where `.git` is a file, are skipped (see Edge
   cases), and `node_modules` is pruned explicitly because a depth cap alone
   still matches `<root>/node_modules/.git`. Pointing at a single clone
   therefore syncs that clone; pointing at a folder of clones syncs each of
   them. If `root` is itself a clone *and* holds nested clones, both levels are
   in scope and every one of them appears in the report — nothing is updated
   invisibly, and every update is still fast-forward-only.
2. **Read local state and fetch only needed remotes.** Read the current branch
   and dirty flag (`git status --porcelain`). Confirm an `origin` remote exists.
   Everything here resolves through `origin`, so
   check `git remote get-url origin`: a clone whose remote is named `upstream`
   would otherwise pass a bare "some remote exists" guard and then be
   misreported as `no default branch`. Then `git fetch --prune --quiet origin`,
   plus the current branch's tracking remote when needed for `current-branch`
   scope or a dirty checkout's behind-count. Read `branch.<current>.remote`
   directly: remote names can contain `/`, and `.` means a local upstream
   branch, not a remote to fetch. A clean `default-branch` update does not need
   the feature branch's remote.
   Do **not** use `fetch --all`: it exits non-zero when *any* remote fails, so a
   single unrelated broken remote would mark a perfectly healthy repo
   `error: fetch failed`. Record `error: no origin remote` when `origin` is
   missing, and `error: fetch failed` when a remote this run genuinely needs is
   unreachable.
3. **Resolve the server's default branch when needed**, using
   `git ls-remote --symref origin HEAD` after fetching. Cached `origin/HEAD` can
   retain the old default after a rename; do not guess from `main` or `master`.
   Record both its branch name and advertised HEAD commit for verification.
   Missing symbolic HEAD means `no default branch`; a lookup failure or an
   unfetched advertised branch is an explicit error. A clean `current-branch`
   update does not depend on discovering a default branch.
4. **Verify the selected commit before using it.** Resolve the selected
   tracking ref to a commit. For the default branch, compare it with the
   advertised HEAD commit. For a configured remote upstream, compare it with
   the exact `branch.<current>.merge` ref returned by
   `git ls-remote --exit-code <tracking-remote> <merge-ref>`.
   A local upstream (`branch.<current>.remote = .`) needs no remote check.
   Preserve configured fetch refspecs: never override an exclusion or fetch
   an excluded branch separately to make verification pass. A missing,
   unmapped, stale, or unverifiable selected ref is `error: <reason>`, before
   any update or behind-count. Use the verified commit ID for every later
   count, ancestry check, and update, not a tracking ref that could move.
5. **Fast-forward safely.** Every result must be distinguishable — always capture
   the branch tip **before** and **after** the operation and derive the result
   from the difference. Never report success on exit code alone: `merge --ff-only`
   and `fetch <b>:<b>` both exit 0 when nothing moved, so an exit-code-only check
   cannot tell `advanced` from `up-to-date`.
   - **Dirty** working tree → do not pull. Record `dirty (skipped), N behind`,
     counting with `git rev-list --count HEAD..<verified-commit>` for its
     upstream, or the default branch when no upstream is configured. Report a
     verification/counting failure as an error rather than inventing a count.
   - `scope=current-branch`: if the current branch has no upstream, record
     `no upstream (skipped)` — do **not** silently fall back to the default
     branch. Otherwise fast-forward to the fetched upstream commit.
   - `scope=default-branch`, default branch **is** checked out:
     fast-forward to the fetched `origin/<default>` commit.
   - `scope=default-branch`, default branch **is not** checked out: update it
     without checkout by fetching the verified commit from the local
     repository (`git fetch . <verified-commit>:refs/heads/<default>`).
     This avoids a second network fetch racing the ancestry check. A branch
     checked out in another worktree is `in use by another worktree (skipped)`.
   - **Classify history before updating.** Use `git merge-base --is-ancestor`
     in both directions. If the target already contains the upstream commit,
     report `up-to-date` and retain local commits. Only two non-ancestor tips
     mean `diverged`. An ancestry error, lock failure, permission failure, or
     failed update is `error: <reason>`, with diagnostic stderr preserved —
     never infer divergence from an operation's exit code alone.
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
export LC_ALL=C
case "$SCOPE" in default-branch|current-branch) ;;
  *) printf 'error: unsupported scope: %s\n' "$SCOPE" >&2; exit 2;; esac
r() { printf '%s\t%s\t%s\n' "$1" "$2" "$3"; }
error() {
  r "$name" "$target" "error: $1"
  [ -z "$2" ] || printf '%s: %s\n' "$name" "$2" >&2
}
find "$ROOT" -maxdepth 2 -name node_modules -prune -o -name .git -type d -print | while IFS= read -r g; do
  repo="$(dirname "$g")"; name="$(basename "$repo")"
  cur="$(git -C "$repo" branch --show-current 2>/dev/null)"
  [ -z "$cur" ] && { r "$name" "detached" "detached (skipped)"; continue; }
  target="$cur"
  git -C "$repo" remote get-url origin >/dev/null 2>&1 || { r "$name" "$cur" "error: no origin remote"; continue; }
  # Git diagnostics stay on stderr, never inside values parsed as data.
  if dirty="$(git -C "$repo" status --porcelain)"; then :;
  else error "cannot read working-tree state" ""; continue; fi
  if err="$(git -C "$repo" fetch --prune --quiet origin 2>&1)"; then :;
  else error "fetch failed (origin)" "$err"; continue; fi
  upr="$(git -C "$repo" config --get "branch.$cur.remote")"
  if { [ "$SCOPE" = current-branch ] || [ -n "$dirty" ]; } &&
     [ -n "$upr" ] && [ "$upr" != origin ] && [ "$upr" != . ]; then
    if err="$(git -C "$repo" fetch --prune --quiet "$upr" 2>&1)"; then :;
    else error "fetch failed ($upr)" "$err"; continue; fi
  fi
  upstream="$(git -C "$repo" rev-parse --verify --quiet --symbolic-full-name '@{u}' 2>/dev/null)"
  merge_ref="$(git -C "$repo" config --get "branch.$cur.merge")"
  if { [ "$SCOPE" = current-branch ] || [ -n "$dirty" ]; } &&
     [ -z "$upstream" ] && { [ -n "$upr" ] || [ -n "$merge_ref" ]; }; then
    error "configured upstream ref unavailable (check fetch filters)" ""; continue
  fi
  ref="$upstream"; remote="$upr"; expected=""
  if { [ "$SCOPE" = default-branch ] && [ -z "$dirty" ]; } ||
     { [ -n "$dirty" ] && [ -z "$upstream" ]; }; then
    if advertised="$(git -C "$repo" ls-remote --symref origin HEAD)"; then :;
    else error "default branch lookup failed" ""; continue; fi
    def="$(printf '%s\n' "$advertised" | sed -n 's#^ref: refs/heads/\([^[:space:]]*\)[[:space:]]HEAD$#\1#p')"
    [ -n "$def" ] || { r "$name" "$cur" "no default branch"; continue; }
    ref="refs/remotes/origin/$def"; remote=origin
    expected="$(printf '%s\n' "$advertised" | awk '$2 == "HEAD" {print $1}')"
    [ -n "$dirty" ] || target="$def"
  else
    [ -n "$ref" ] || { r "$name" "$cur" "no upstream (skipped)"; continue; }
    if [ "$remote" != . ]; then
      [ -n "$remote" ] && [ -n "$merge_ref" ] ||
        { error "cannot identify configured upstream" ""; continue; }
      if advertised="$(git -C "$repo" ls-remote --exit-code "$remote" "$merge_ref")"; then :;
      else error "upstream lookup failed ($remote $merge_ref)" ""; continue; fi
      expected="$(printf '%s\n' "$advertised" | awk -v ref="$merge_ref" '$2 == ref {print $1}')"
    fi
  fi
  if desired="$(git -C "$repo" rev-parse --verify "$ref^{commit}")"; then :;
  else error "selected ref unavailable ($ref); check fetch filters" ""; continue; fi
  if [ "$remote" != . ]; then
    [ -n "$expected" ] || { error "selected remote commit was not advertised" ""; continue; }
    [ "$desired" = "$expected" ] ||
      { error "stale tracking ref ($ref); check fetch filters or retry" ""; continue; }
  fi
  if [ -n "$dirty" ]; then
    if behind="$(git -C "$repo" rev-list --count "HEAD..$desired")"; then
      r "$name" "$cur" "dirty (skipped), $behind behind"
    else error "cannot count commits behind" ""; fi
    continue
  fi
  suffix=""; [ "$target" = "$cur" ] || suffix=" (on $cur)"
  before="$(git -C "$repo" rev-parse --verify --quiet "refs/heads/$target")"
  if [ -n "$before" ]; then
    if git -C "$repo" merge-base --is-ancestor "$desired" "$before"; then
      r "$name" "$target" "up-to-date$suffix"; continue
    else
      rc=$?; [ "$rc" -eq 1 ] || { error "cannot compare history" ""; continue; }
    fi
    if git -C "$repo" merge-base --is-ancestor "$before" "$desired"; then :;
    else
      rc=$?
      if [ "$rc" -eq 1 ]; then r "$name" "$target" "diverged (needs manual merge)"
      else error "cannot compare history" ""; fi
      continue
    fi
  fi
  if [ "$target" = "$cur" ]; then
    if err="$(git -C "$repo" merge --ff-only "$desired" --quiet 2>&1)"; then :;
    else error "merge failed" "$err"; continue; fi
  else
    if err="$(git -C "$repo" fetch --quiet . "$desired:refs/heads/$target" 2>&1)"; then :;
    else
      case "$err" in
        *"checked out at"*|*"current branch"*) r "$name" "$target" "in use by another worktree (skipped)";;
        *) error "local branch update failed" "$err";;
      esac
      continue
    fi
  fi
  if after="$(git -C "$repo" rev-parse --verify "refs/heads/$target")"; then :;
  else error "cannot read updated branch" ""; continue; fi
  if [ -z "$before" ]; then r "$name" "$target" "created local $target$suffix"
  elif [ "$before" = "$after" ]; then r "$name" "$target" "up-to-date$suffix"
  elif count="$(git -C "$repo" rev-list --count "$before..$after")"; then
    r "$name" "$target" "advanced $count commits$suffix"
  else error "cannot count advanced commits" ""; fi
done
```

Prefer running the loop and then presenting a clean table to the user rather
than dumping raw tab output. If there are many repos, run the fetches and
summarize; do not narrate each repo.

## Edge cases

- **Worktrees / submodules:** discovery matches only a `.git` **directory**, so
  linked worktrees and submodules (where `.git` is a file) are skipped by
  construction. Do not auto-update submodules unless asked.
- **Branch checked out elsewhere:** a needed local ref update refuses when the
  branch is checked out in another worktree. Report
  `in use by another worktree (skipped)`, not `diverged`. If the branch already
  contains the upstream tip, no update is needed and it is `up-to-date`.
- **No `origin` remote:** everything here resolves through `origin`, so a repo
  whose only remote is named something else (`upstream` on a fork, a renamed
  remote) must be reported, not silently misread as `no default branch`. Guard
  with `git remote get-url origin`. Report `error: no origin remote`.
- **Several remotes:** fetch only `origin` and, when needed for a current-branch
  merge or dirty behind-count, the configured tracking remote. `.` is local;
  names containing `/` are used intact. `fetch --all` couples success to remotes it never reads —
  one broken remote fails the whole fetch and the repo is reported as
  `error: fetch failed` while `origin` is perfectly healthy.
- **Stale/missing `origin/HEAD`:** use the server's advertised symbolic HEAD,
  not the cached alias. Missing server HEAD is `no default branch`; a network
  failure is an error. Current-branch scope needs neither when clean.
- **Ahead-only history:** preserve the extra local commits and report
  `up-to-date` — nothing from the upstream is missing.
- **Locks or permissions:** report the operational error and its diagnostic.
  Do not remove lock files or suggest a manual merge for non-divergent history.
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
