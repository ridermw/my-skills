---
name: ado-pr-build-monitor
description: 'Use when the user wants to monitor or watch an Azure DevOps (ADO) pull request build to completion — "monitor PR [url] and let me know when the build completes", "watch this PR build", "tell me when the PR build passes and a work item is linked", "is the PR gate green yet", ADO PR build/policy/gate status polling. Read-only; reports status, does not post comments or complete the PR.'
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

Throughout, a **required build** is a build the PR's branch policy requires. The
ADO API exposes these as *policy evaluations* that point at a *pipeline run*;
"gate" is used loosely for the same thing. Prefer "required build" in your
report so the user is not left mapping three names onto one object.

## When to use

- "monitor PR [url] and let me know when the PR Build is completed and a work
  item has been linked"
- "watch the build on this PR" / "ping me when the gate is green"
- Checking build and work-item conditions on an ADO PR. Full merge readiness
  requires other policies too; passing these checks alone does not prove it.

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

- get pull request by id (title, status, source/target branches and revisions)
- list current PR policy evaluations, including configuration and run context
- get build / pipeline run status + logs for the build id the policy points to
- list PR work-item refs (linked work items)

If a needed capability has no MCP tool, use the Azure CLI with the
`azure-devops` extension: `az repos pr show`, `az repos pr policy list`,
`az repos pr work-item list`, `az pipelines runs show`, and
`az boards work-item show`. Supply the resolved organization/project explicitly.

There is no `az pipelines runs tail` command. Use the authenticated REST
transport available in the environment (`az devops invoke` is one option) for
GET-only log retrieval:

```text
GET /{project}/_apis/build/builds/{buildId}/timeline?api-version=7.1
GET /{project}/_apis/build/builds/{buildId}/logs?api-version=7.1
GET /{project}/_apis/build/builds/{buildId}/logs/{logId}?startLine={start}&endLine={end}&api-version=7.1
```

These paths are relative to `https://dev.azure.com/{org}`. Use the timeline's
failed task/job records and their log IDs; get line counts from the log list,
then fetch a bounded range. See the official [Build Log API](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/builds/get-build-log?view=azure-devops-rest-7.1).
If no authenticated read capability is available, report that and stop. Never
queue/re-evaluate a policy or build to obtain fresh status.

## Procedure

1. **Set one deadline and resolve the PR.** Record start time and an absolute
   deadline from `max wait`; neither a new push nor a scheduled wake resets it.
   Check that deadline before each poll/wake and bound waits and request
   timeouts by the remaining budget.
   Fetch title, status, source/target branches, and current source/target commit
   IDs (for example `lastMergeSourceCommit.commitId` and
   `lastMergeTargetCommit.commitId`). A completed or abandoned PR is terminal.
2. **Refresh associations on every poll.** Re-fetch the PR and all current
   policy evaluations, following continuation pages. Identify enabled, blocking
   Build policies and their current evaluation/run IDs; exclude disabled,
   optional, and `notApplicable` evaluations from required-build success.
   Replace cached associations when the PR revisions, policy set, evaluation,
   or run changes. A newly queued evaluation without a run ID is pending, not
   absent or successful. Do not select a pipeline's last successful run.
3. **Read the currently associated runs.** Build `status` describes lifecycle
   (`notStarted`, `inProgress`, `cancelling`, `postponed`, `completed`); `result`
   describes the completed outcome. A run is terminal only when
   `status: completed`. Do not equate `cancelling` with `canceled`.
   A success candidate needs both `result: succeeded` and the current required
   policy evaluation's `status: approved`. Queued/running evaluations remain
   pending; rejected/broken evaluations are not success.
   PR validation can build a synthetic merge commit, so do not demand raw
   `build.sourceVersion == PR source SHA` equality. Establish relevance through
   the current policy evaluation's run association and PR revisions. If that
   association cannot be established, report it as unverified.
4. **Check linkage according to the request.** List linked work items (all
   pages) and obtain titles when available. A link is required when an enabled,
   blocking work-item policy applies **or** the user explicitly asked for both
   a passing build and a linked item. Otherwise linkage is informational and
   never a reason to keep polling. When policy-required, also check that
   evaluation's approval rather than inferring it from a listed item alone.
5. **Confirm freshness before a terminal build report.** Re-read PR revisions
   and current required evaluations after reading runs/linkage. If the revision,
   policy set, run association, or relevant evaluation state changed, discard
   the candidate result and continue from step 2 within the original deadline.
   A startup run's success is not evidence for a new push or expired validation.
   Apply this confirmation to failed, partially succeeded, and canceled runs
   too, so a superseded failure does not terminate the current monitor.
6. **Evaluate the confirmed snapshot:**

   | Condition | Action |
   | --- | --- |
   | All applicable required builds completed/succeeded and their evaluations approved; any required linkage satisfied | Report **requested checks passed**, not "PR ready". |
   | Current run completed/failed | Stop immediately; report failure and relevant timeline/log evidence, even if another build is still running. |
   | Current run completed/partiallySucceeded | Stop with **partially succeeded — required build not passed**; inspect warning/failing tasks and bounded logs. |
   | Current run completed/canceled | Stop with **canceled — required build not passed**; include an observed cancellation reason, or say unavailable. |
   | Required evaluation rejected/broken | Report the policy failure and its diagnostic; do not override it with a green run. |
   | Completed run has missing/unknown result, or association is unverified | Report **unverified**, never success; name the missing evidence. |
   | Builds passed but required linkage is missing/pending | Flag that condition. Keep polling only if the user asked to wait for both; otherwise report and stop. |
   | Builds/evaluations still pending | Wait the poll interval and restart at step 2. |
   | No applicable required builds | Report that explicitly, not vacuous build success; monitor linkage alone only if explicitly requested. |
   | Deadline reached | Report timeout and last observed states with their timestamps; stop. |

   Other branch policies can still block completion. This monitor does not
   certify full PR readiness. On failure, show the failing stage/job and at most
   ~15 relevant, redacted log lines as a root-cause hint, not a full log dump.
7. **Report** using this shape:

   ```
   PR <id>: <title>  <link>
   Observed: <timestamp>  Source: <commit>  Target: <commit>
   Outcome: <requested checks passed | failed | partially succeeded | canceled | pending | unverified | timed out | PR closed | no required builds>
   Required builds:
     <name>  <status>/<result>  policy: <state>  <duration>  <link>
   Work items (<required | informational>): <id> <title>   (or: none linked yet)
   Next action: <one line>
   ```

   On failure, add the stage/job and relevant log lines beneath its build row.
   The title labels the requested change; build status does not verify that its
   implementation matches that goal.

## Output length

Report the outcome, not the journey. While polling, stay quiet — one line when
you start and one line if you pause is enough; do not narrate each poll or each
unchanged status. The final report is the shape above and nothing more: no
restated PR description, no full log dump beyond the root-cause lines, no
closing summary of what you just said.

## Long builds — don't block the session

If builds will take many minutes, do not sit in a tight sleep loop for the whole
duration. In order of preference:

- Poll a bounded number of times, then create a scheduled re-check if supported.
  Persist the PR identity, request/linkage condition, interval, original start
  time/deadline, and last observed revision/evaluation/run associations. Claim a
  future re-check only after scheduling succeeds. On wake, restart at step 2;
  do not resume polling only the old build IDs.
- If your runtime has no scheduling facility, report the current status, state
  clearly that monitoring has paused, and offer to resume on request. Do not
  silently stop watching.

Always keep the original hard `max wait` cap. Cancel the monitor's schedule
when the PR closes, a terminal report is produced, or the deadline expires.
Use the runtime's documented creation API; a wakeup primitive for an existing
loop does not itself create a monitor.

## Safety

- Read-only. No PR comments, votes, completion, or work-item creation unless the
  user explicitly asks in this session.
- Never approve or complete a PR automatically, even if all gates are green.
- If auth or a tool is unavailable, say so plainly and stop — do not guess build
  status.

## Stop condition

Done when a confirmed terminal outcome in step 6 or PR closure is reported, or
the original deadline expires. Pending builds continue at the configured
interval; pending required linkage continues only when waiting for both was
requested. Every stop has a final report and any monitor-owned schedule is
canceled.
