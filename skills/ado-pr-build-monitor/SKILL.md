---
name: ado-pr-build-monitor
description: 'Use when the user wants to monitor or watch an Azure DevOps (ADO) pull request build to completion — "monitor PR <url> and let me know when the build completes", "watch this PR build", "tell me when the PR build passes and a work item is linked", "is the PR gate green yet", ADO PR build/policy/gate status polling. Read-only; reports status, does not post comments or complete the PR.'
---

# ADO PR Build Monitor

Watch an Azure DevOps pull request's build/policy gates until they reach a
terminal state, confirm a work item is linked, and report the outcome. On a
build failure, surface the failing stage and the root-cause lines from the log
so the user can act immediately.

This is a **read-only monitor**. It does not comment on the PR, vote, complete,
or create work items. If the user also wants a code review or PR write-backs,
that belongs to a separate code-review skill — keep this one focused on
"watch and report."

## When to use

- "monitor PR <url> and let me know when the PR Build is completed and a work
  item has been linked"
- "watch the build on this PR" / "ping me when the gate is green"
- Checking whether an ADO PR is ready to complete.

## Inputs

- **PR URL** (required). Both Azure DevOps URL forms are supported:
  - `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`
  - `https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}` (legacy)

  Parse `org`, `project`, `repo`, and numeric `prId`. If the URL is missing the
  project segment (some orgs collapse it when project == repo), resolve the
  project from the repo before continuing rather than guessing.
- **max wait** (optional): default cap ~45 min. Never poll forever.
- **poll interval** (optional): default 60–120s.

## Authentication

Azure DevOps access is via whatever Azure CLI / MCP credential the environment
already uses. If the first ADO call returns an auth error, ask the user to sign
in and wait for them to confirm before retrying:

```bash
az login
```

If the user keeps separate Azure profiles for different tenants, they can scope
the login with `AZURE_CONFIG_DIR` (for example
`AZURE_CONFIG_DIR=~/.azure-work az login`; on Windows,
`$env:AZURE_CONFIG_DIR = "$env:USERPROFILE\.azure-work"`). Use the same
`AZURE_CONFIG_DIR` for every subsequent call in the session. Never guess a
profile path — ask which one to use.

## Tool discovery

Azure DevOps access is normally provided by the official [Azure DevOps MCP
server](https://github.com/microsoft/azure-devops-mcp), whose tools are prefixed
`azure-devops-*` (a.k.a. `ado-*`). Tools may be deferred or lazily loaded, so
**search first** (if your runtime has a tool-search facility) for
`azure-devops|ado|pull_request|build|pipeline|work_item`, then pick the ones for:

- get pull request by id (title, status, source/target branch)
- list PR policy evaluations / statuses (the build/gate results)
- get build / pipeline run status + logs for the build id the policy points to
- list PR work-item refs (linked work items)

If a needed capability has no MCP tool, fall back to the Azure CLI with the
`azure-devops` extension: `az repos pr show`, `az pipelines runs show`,
`az pipelines runs tail`, and `az boards work-item show`. If neither the MCP
server nor the CLI extension is available, say so and stop — do not fabricate
build status.

## Procedure

1. **Resolve the PR.** Fetch PR by id. Record title (the *stated goal*), status
   (active/completed/abandoned), and source→target branches. If the PR is
   already completed or abandoned, report that and stop — nothing to monitor.
2. **Identify the build gate.** From the PR policy evaluations, find the required
   Build policy and the build/pipeline run id it triggered. There may be more
   than one required build; track all of them.
3. **Poll to terminal state.** Every poll interval, re-check each tracked build's
   status. Terminal states: `succeeded`, `failed`, `partiallySucceeded`,
   `canceled`. Between polls, sleep the interval; stop as soon as all tracked
   builds are terminal or `max wait` is hit. Do not hammer the API — respect the
   interval. For long builds, prefer a scheduled re-check (see "Long builds").
4. **Check work-item linkage.** Fetch the PR's linked work items. Note id(s) and
   title(s), or that none is linked yet. Not every org enforces work-item
   linkage — if no such policy exists on this PR, report linkage as
   informational rather than as a blocker.
5. **Evaluate the stop condition:**
   - **Success:** all required builds `succeeded` **and** ≥1 work item linked →
     report ready.
   - **Build failed:** stop immediately. Fetch the failing build's timeline/log,
     and report the failing stage/job + the last ~15 relevant error lines as a
     root-cause hint.
   - **Build green but no work item linked:** this is the common half-done case.
     Report the build is green and explicitly flag the missing work-item link as
     the remaining blocker. Poll a short while longer for the link if the user
     asked to be told "when both are done," else report and stop.
   - **Timeout:** report the last known status of every gate and stop.
6. **Report:**
   - PR title + link, and whether the change still matches its stated goal at a
     glance.
   - Each required build: result, duration, link.
   - Linked work item(s), or "none linked yet".
   - One-line **next action** (e.g. "ready to complete", "link a work item",
     "fix failing stage X — see errors above").

## Long builds — don't block the session

If builds will take many minutes, do not sit in a tight sleep loop for the whole
duration. In order of preference:

- Poll a bounded number of times at the interval and, if still running, tell the
  user you will re-check — then use a scheduled/self-paced wakeup if your runtime
  offers one.
- If your runtime has no scheduling facility, report the current status, state
  clearly that monitoring has paused, and offer to resume on request. Do not
  silently stop watching.

Always keep a hard `max wait` cap and a clear terminal report.

## Safety

- Read-only. No PR comments, votes, completion, or work-item creation unless the
  user explicitly asks in this session.
- Never approve or complete a PR automatically, even if all gates are green.
- If auth or a tool is unavailable, say so plainly and stop — do not guess build
  status.

## Stop condition

Done when either (a) all required builds are terminal and work-item linkage is
resolved (linked, or reported missing), or (b) `max wait` elapsed — in both
cases a final status report with a next action is produced.
