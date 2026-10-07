---
name: adversarial-review
description: 'Pressure-tests an idea, plan, or change by reusing compatible prior coverage or running up to three separated adversarial reviewer perspectives instead of a generic pros/cons list, then synthesizes evidence-ranked findings without claiming consensus when none ran. SPAR mode debates a decision through roles with conflicting incentives; Rubber Duck mode critiques a selected artifact. Always discloses the execution path it actually achieved and never claims reviewers or model diversity it did not. Use when the user asks to pressure-test, stress-test, poke holes in, red-team or critique an idea, proposal, strategy, architecture tradeoff, code change, test plan, debugging hypothesis, suspected bug or risky decision. For a bounded pre-coding readiness gate on a concrete implementation plan use plan-exit-review, and for a maximum-rigor audit of a high-risk plan use plan-mega-review; this skill is adversarial critique of any artifact or decision, not a plan-approval workflow.'
---

# Adversarial Review

Updated: October 7, 2026

## First Response Line

Your first visible line after this skill loads is:

```text
Adversarial review | Updated: <date>
```

Replace `<date>` with the `Updated:` date at the top of this loaded text. Write this line before the mode, the target, any reviewer launch, or any analysis.

If the conversation already contains `<skill-context name="adversarial-review">`, for example after `/adversarial-review`, the skill is loaded. Do not call the skill tool for it again unless the runtime requires a loader call. Write the first response line from that loaded text.

The runtime can show its own invocation card before this line. This skill cannot change that card.

## Reviewer Guard

Every reviewer prompt starts with this exact line:

```text
Reviewer guard: You are a reviewer launched by adversarial-review. Do not load the adversarial-review skill. Do not launch agents or tasks. Review only the target below and return findings in the requested schema.
```

If your own prompt starts with `Reviewer guard:`, you are a reviewer. Do not choose a mode, launch agents, or load this skill. Review the target with the Premortem Pass, Review Constitution, Severity and Confidence Calibration, and Evidence Standards. Return the output your prompt requests: the Reviewer Output Schema for Rubber Duck, or the strongest objection, strongest support, hidden assumption, and failure mode for a SPAR role.

## Overview

Stress-test thinking before committing. Use separated perspectives first, then synthesize; do not collapse into a generic pros/cons list.

For implementation plans, code changes, tests, debugging hypotheses, or critique requests, prefer independent reviewer contexts and evidence-ranked findings. Consensus is useful only when independence is real.

## Identify the Target

Before you choose a mode, write one line: `Target: <exact target>`.

- Repository file, plan, or change: repository-relative path or diff range at the commit SHA, or `uncommitted changes on <branch> at <HEAD SHA>`.
- Pull request: full URL plus either the base and head commit SHAs or an
  immutable diff hash.
- Comment, thread, or web document: full URL.
- Pasted text that is not in a file: its first words in quotes.

If you cannot identify the exact target, or it differs from what the user named, ask before you launch reviewers. Give every reviewer the same target line.

## Review Intensity

The one public control is `low | auto | max`. `auto` is the default. Accept
natural forms such as `/adversarial-review low: ...` and
`/adversarial-review max: ...`; do not make the user choose a mode separately.

| Intensity | Required behavior |
| --- | --- |
| `low` | Reuse a qualifying prior review when possible. Otherwise use `single-agent` or at most one new reviewer. Do not claim consensus. |
| `auto` | Reuse exact-target coverage, review only changed or uncovered areas, and apply Proportionality. For substantive uncovered work, target three reviewers and cross-examine meaningful disagreement. |
| `max` | Bypass prior-review reuse as a substitute for fresh criticism. Run a fresh three-reviewer panel when available, mandatory cross-examination, and a groupthink check. `max` never means more than three first-pass reviewers. |

Intensity controls review investment, not mode. If the user does not name an
intensity, resolve it to `auto`; never silently upgrade or downgrade an explicit
choice. You may warn that `low` is weak for a high-consequence target, but honor
it.

## Choose the Mode

Infer mode from the desired output, not merely from the artifact named. An
explicit `force SPAR` or `force Rubber Duck` instruction overrides this table;
the selected intensity still applies. Treat force-mode syntax as an advanced
escape hatch, not another routine choice.

| Desired output | Mode |
| --- | --- |
| Choice, verdict, recommendation, product bet, or architecture tradeoff | SPAR |
| Defect assessment, review, critique, or audit of a selected path, code change, implementation plan, tests, or debugging hypothesis | Rubber Duck |
| Ambiguous high-stakes decision | SPAR, then Rubber Duck on the favored path |
| Unclear or out-of-scope request | Ask the user to clarify the decision or artifact before selecting a mode |

## Prior Review Check

After selecting the mode and before selecting reviewers, perform two distinct
searches in available session history:

1. **Exact-target reuse.** Search for a completed adversarial review matching
   the exact target by its immutable identity: commit SHA; for a pull request,
   its full URL plus the base and head commit SHAs or an immutable diff hash;
   content hash; or unchanged pasted text. Reuse must match that same immutable
   identity. It qualifies as reusable coverage only when its evidence is still
   accessible and its coverage is mode-compatible. A Rubber Duck review does
   not substitute for SPAR role analysis, and SPAR does not substitute for a
   Rubber Duck defect review.
2. **Delta-baseline discovery.** When the current target has changed, also
   search for a completed review of a prior immutable revision of the same
   logical target, such as the same pull request, file, or named artifact. It
   qualifies only when both the current and prior revisions and the prior
   evidence remain accessible, their relationship and delta can be established,
   and the prior coverage is mode-compatible. Use it only as a delta baseline,
   never as exact-target reuse or proof that the current target was reviewed.

- For `low`, reuse qualifying exact-target coverage and launch no replacement
  panel.
- For `low`, if only a qualifying delta baseline exists, use it to scope at most
  one new reviewer to changed or uncovered work.
- For `auto`, reuse qualifying exact-target coverage. For a changed target with
  a qualifying delta baseline, review only the delta and any missing lens
  instead of repeating the whole review.
- For `max`, bypass reuse and run fresh reviewers. Prior findings may inform
  verification, but they do not replace the fresh first pass.
- If the user forces a different mode from the prior review, perform the missing
  forced-mode work. Prior evidence may be context, not substitute coverage.
- If history is unavailable or identity cannot be proven, say so and continue
  under the selected intensity.

Do not report a reused review as newly performed consensus. Disclose what was
reused, what changed, and which new reviewers actually ran.

## Capability Check

Apply Review Intensity, Prior Review Check, and Proportionality first. For work
warranting new subagents, select the eligible reviewer roster using the Model
Diversity Heuristic and available independent contexts. Record the roster and
count (at most three), then derive the execution path below. Dispatch reuses
that selection; excluded providers do not count.

| Capability | Execution path |
| --- | --- |
| Qualifying exact-target reuse under the selected mode and intensity; zero new reviewers | `reused-review` |
| At least two selected reviewers on distinct eligible preferred providers with confirmed model overrides, plus an optional rule 9 reviewer | `multi-model-subagents` |
| At least two selected independent contexts but distinct model control is unavailable or unconfirmed | `parallel-subagents` |
| One selected critique/generic subagent | `single-subagent` |
| No eligible subagent can be selected | `single-agent` |

For `reused-review`, report the accessible prior review in the selected mode
without presenting it as newly performed consensus. The current-run
`Reviewers` launched count is 0; disclose which prior panel or reviewers and
which evidence were reused.

Under `auto`, target three independent reviewer contexts for a substantive
uncovered artifact whenever possible; see Proportionality below for when a
smaller artifact does not warrant three. Under `low`, select at most one new
reviewer. Under `max`, target three fresh contexts. When eligible providers or
independent contexts are insufficient, reduce the selected count and disclose
the downgrade.

**Proportionality.** Three reviewers are for a substantive artifact — a plan, a
design, a diff, a decision with real consequences. For a single function, a
one-line question, or a change you could fully critique yourself in a couple of
steps, `auto` runs `single-agent`, says so, and skips the subagent overhead.
`low` caps new reviewers at one even for a substantive target. `max` is the
user's explicit request to pay for the full fresh panel. Do not spawn reviewers
whose combined cost exceeds the value authorized by the selected intensity.

## Output length

Match length to the findings, not to the section list. Report every section the
mode calls for, but collapse an empty one to a single line instead of padding
it. Lead with the highest-priority finding. Do not restate the artifact back to
the user, and do not repeat the same finding in full in both the
priority-ranked list and the recommended-changes list — cross-reference it.

## Model Diversity Heuristic

The goal is three independent, high-effort reasoning contexts from OpenAI,
Anthropic, and xAI. Select by **provider, tier, and generation, never by version
number.** For xAI, choose the newest exposed frontier general-reasoning Grok
model. Google and Gemini models are not eligible reviewer substitutes.

**Never hardcode a model version — not in this file, and not in your selection
reasoning.** A concrete version is wrong the moment the runtime updates, and a
stale allow-list silently degrades the review by excluding models that did not
exist when it was written. Enumerate what the runtime actually exposes at
request time, then rank it.

Selection rules:

1. **Enumerate, then rank.** Ask the runtime which models it exposes and group
   them by provider. Do not assume any particular provider or model exists. If
   the runtime exposes no model list or no provider metadata, tier selection is
   not possible — do not guess a lineup from memory. Say so, select the
   independent contexts available without claiming model control, and disclose
   `model diversity not confirmed`. Capability Check derives the execution path
   from the selected count.
2. **Use the preferred provider trio.** Assign one reviewer each from OpenAI,
   Anthropic, and xAI. Independence comes from different providers, not from
   three variants of one family. If a preferred provider is not exposed, fill
   that one slot under rule 9; never use Google or Gemini.
3. **Take each provider's frontier general-reasoning tier** — the tier that
   provider positions for its hardest reasoning and agentic work — and the
   newest generation of that tier.
4. **Exclude the small/fast tier.** Skip anything the runtime labels or markets
   as mini, small, flash, lite, nano, turbo, instant, fast, cheap, or
   economical, and any model presented as the lightweight sibling of a larger
   one. Judge by the runtime's own tier description at request time, not by a
   remembered list of names — tier labels change.
5. **Reasoning effort: `xhigh` for every reviewer.** Request `xhigh` for each
   selected model even when it exposes a higher setting. If a model does not
   expose `xhigh`, or effort is not controllable, leave effort unset and
   disclose the limitation rather than silently choosing another level or
   implying that `xhigh` was set.
6. **Code review:** a code-specialized model may hold a reviewer slot only if it
   is that provider's frontier tier; otherwise keep general-reasoning models.
7. **Never fabricate.** If a provider, model, or effort level is not actually
   exposed, do not invent it and do not substitute a small-tier model to fill a
   slot. Fill a missing provider slot under rule 9 when it applies. Otherwise
   run the reviewers you can, reduce the count, and disclose
   `model diversity not confirmed`.
8. **Fewer than three providers is a downgrade to disclose, not a reason to
   lower the tier bar.** Two frontier reviewers beat three where one is a
   small-tier stand-in.
9. **Fill a missing provider slot with a third context, not a third
   provider.** If only two preferred providers are exposed, give the third
   reviewer a different frontier model from one of those two providers. It must
   pass rules 3 and 4, and it must differ from the model that provider already
   uses. The third model is never Google or Gemini and never a small tier.
   Disclose `three contexts, two providers`. If no such model exists, reduce
   the count.
10. **Pass an explicit `model` for every reviewer, then check it.** The runtime
   can replace an omitted model with a configured default, which can put every
   reviewer on one model. After launch, compare each requested model with the
   model that actually started. If they differ, disclose the substitution,
   count providers from the started models, and recalculate the execution path
   from the started models. If the runtime does not accept a model override,
   launch without `model` and disclose `model diversity not confirmed`.

## Degeneration-of-Thought Safeguard

Do not let the same context that produced the artifact be the only critic. Prefer fresh reviewer contexts. If fresh contexts are unavailable, disclose `single-context critique` and lower confidence in the review.

## Premortem Pass

Before listing findings, each Rubber Duck reviewer writes one failure narrative:

> It is 18 months from now and this shipped system failed in the most damaging credible way. What happened, who was affected, what decision caused it, and which current assumption made it possible?

Use the failure narrative as input to the findings list. Trace each credible failure back to a specific current decision, assumption, missing test, missing control, or operational gap.

## Review Constitution

Every Rubber Duck review checks these categories:

- correctness
- security
- reliability
- performance
- maintainability
- test coverage
- observability
- operational failure modes
- data integrity
- dependency and supply-chain risk

For UI work, also check accessibility, empty/loading/error states, and user trust. For AI-agent or LLM work, also check prompt injection, excessive agency, insecure output handling, sensitive information disclosure, and overreliance.

## Adversarial Reviewer Lenses

Reviewer lenses should be distinct. Prefer three of:

- Security/abuse reviewer: attack surface, trust boundaries, authorization, injection, secrets, abuse paths.
- Correctness/data-integrity reviewer: edge cases, invalid input, state transitions, silent wrong results, data loss.
- Reliability/operations reviewer: retries, timeouts, partial failure, deploy/rollback, monitoring, incident response.
- Performance/scale reviewer: load cliffs, concurrency, memory growth, resource leaks, N+1 work, throttling.
- Future maintainer reviewer: confusing abstractions, undocumented invariants, brittle coupling, misleading names.
- Product/user-harm reviewer: confusing UX, broken promises, user trust, accessibility, privacy expectations.

Do not send identical persona instructions to all reviewers unless the user explicitly asks for repeated sampling.

## SPAR Mode

1. State: `Mode: SPAR`.
2. Frame the core tension in one sentence.
3. For `reused-review`, retain and report the accessible prior review's role
   set. For all other paths, pick 3-5 fresh roles with genuinely conflicting
   incentives.
4. For fresh review, assign one primary role per selected independent reviewer
   context, up to the cap of at most three first-pass reviewer contexts, and
   dispatch those roles in parallel with `agent_type: rubber-duck`. Start each
   prompt with the reviewer guard, then the target line. Cover extra fresh roles
   sequentially in the main synthesizer without counting it as another
   reviewer. For `single-subagent`, assign one primary role to that context and
   cover the rest the same way; for `single-agent`, cover all selected roles
   sequentially. For `reused-review`, use the accessible prior role perspectives
   for the retained roles and do not create new role perspectives. Disclose
   simulated roles and reused roles.
5. For each role, give the strongest objection, strongest support, hidden assumption, and failure mode.
6. Synthesize only after every selected or retained role has a perspective.
7. End with the single most important open question. If decision-blocking information is genuinely missing, end with up to three such questions instead — but do not pad to more than one when one suffices.

Use sections: Conflict framing, Roles, Perspective [Role], Synthesis, Open question(s).

## Rubber Duck Mode

1. State: `Mode: Rubber Duck`.
2. Choose the execution path from Capability Check.
3. Launch every reviewer with `agent_type: rubber-duck`. Start each prompt with the reviewer guard, then the target line. If the runtime has no `rubber-duck` agent, use a general critique subagent and disclose `rubber-duck unavailable`.
4. For `multi-model-subagents`, launch the selected reviewer roster in parallel with its chosen models, effort settings, and distinct Adversarial Reviewer Lenses.
5. For `parallel-subagents`, launch the selected number of independent critique subagents in parallel without claiming distinct model coverage.
6. For `single-subagent`, launch one critique subagent and perform synthesis yourself; do not count the synthesizer as a second reviewer.
7. For `single-agent`, perform the critique yourself and disclose that no subagent was launched.
8. For `reused-review`, report the accessible prior findings and do not run or
   launch a new critique. Distinguish reused evidence from current synthesis.
9. Each reviewer must receive the same critique target and must not see other reviewers' findings during the first pass.
10. Each reviewer runs the Premortem Pass, checks the Review Constitution, and returns findings in the Reviewer Output Schema.
11. Focus only on high-signal issues: correctness, security, reliability, missing tests, bad assumptions, and edge cases.
12. Separate accepted findings from rejected or unverified concerns.

Use sections: Critique target, Execution disclosure, Priority-ranked findings,
Single-reviewer findings worth considering, Recommended changes, Rejected or
unverified concerns, Next action. State reviewer support as evidence for each
finding without making it the ranking rule.

## Reviewer Output Schema

Ask each reviewer to return findings in this shape:

```text
- title:
  category:
  severity: critical | high | medium | low
  confidence: high | medium | low
  evidence:
  recommended_change:
  dedupe_key:
```

The `dedupe_key` should be a short normalized label for matching equivalent issues across reviewers, such as `auth-cache-leakage`, `missing-timeout`, or `unchecked-null-input`.

Each reviewer ends with:

```text
Recommendation: <fix | investigate | ship-as-is> because <one-line reason naming the strongest finding>
```

## Severity and Confidence Calibration

- `critical`: likely data loss, security breach, privilege escalation, irreversible user harm, or production outage.
- `high`: plausible major reliability, correctness, auth, privacy, or operational failure.
- `medium`: localized bug, missing test, maintainability risk, or performance issue with bounded impact.
- `low`: minor issue or speculative concern with limited impact.

- `high confidence`: directly evidenced by code, plan text, test output, or reproducible reasoning.
- `medium confidence`: plausible and specific, but not fully proven.
- `low confidence`: speculative, ambiguous, or dependent on unstated assumptions.

Single-reviewer critical or high findings with high-confidence evidence must stay visible even without consensus.

## Evidence Standards

Every finding must cite specific evidence: file path and line, plan section, data flow, threat path, reproduction idea, or concrete assumption. Vague concerns are not actionable findings.

For security findings, include STRIDE category when applicable, affected entry point, trust boundary crossed, exploit path, impact, and mitigation.

## Consensus Aggregation

After reviewers finish:

1. Normalize equivalent findings by `dedupe_key`, title, evidence, and recommended change.
2. Group matching findings across reviewers.
3. Evaluate evidence quality, practical impact, and whether the recommended change is actionable.
4. Cross-examine material disagreement or possible overstatement as required by Review Intensity.
5. Classify the result as confirmed, actionable single-reviewer, narrowed, contested, or rejected.
6. Rank surviving findings by impact, actionability, confidence, and evidence quality. Use independent reviewer count as a prioritization signal and tie-breaker, not proof.
7. Do not discard a serious issue only because one reviewer found it.
8. Do not inflate consensus by counting the main assistant's synthesis as an additional reviewer.
9. Preserve unresolved disagreement and state how to resolve it.

For each priority-ranked finding, show:

```text
Priority:
Found by:
Severity:
Confidence:
Issue:
Evidence:
Recommended change:
```

## Cross-Examination Round

Use cross-examination after independent first-pass reviews to calibrate
overstatement, test decision-relevant claims, expose material disagreement, and
identify shared assumptions before synthesis. The synthesizer may show
reviewers the other findings and ask:

> What did they miss? Which of your original findings should change? Which disagreement is itself a risk?

Challenge fields and outcomes depend on the review mode:

- **Rubber Duck:** Challenge each material finding on existence, scope,
  severity, and recommended action. Ask reviewers to `uphold`, `narrow`,
  `downgrade`, or `withdraw` it and explain the evidence.
- **SPAR:** Challenge material role claims across objections, support,
  assumptions, tradeoffs, and failure modes. Ask reviewers to state whether
  each claim stands, narrows, is rebutted, or exposes an unresolved tradeoff or
  unresolved assumption, and explain the evidence.

Under `auto`, cross-examination is required for material disagreement or
suspected overstatement in either mode. Under `auto`, run a groupthink check
when agreement rests on an unverified shared assumption.

Under `max`, always run cross-examination. Challenge every critical or high
Rubber Duck finding, every material SPAR claim that could change the verdict or
recommendation, and every disagreement. If those sets are empty, challenge the
highest-impact remaining Rubber Duck finding or strongest decision-relevant
SPAR claim so the round cannot be skipped. Under `max`, always run a groupthink
check that identifies a shared assumption that could make the panel wrong,
regardless of how neat the agreement looks.

The synthesizer decides; cross-examination does not add votes. Preserve
unresolved disagreement or assumptions in the synthesis rather than forcing
agreement.

## Reviewer Failure Handling

If one or more reviewers fail:

- Continue with completed reviewers when at least one usable review exists.
- Disclose which reviewer failed and whether its model was requested.
- Rank consensus by completed reviewer count, not the original target of three.
- Do not invent missing reviewer findings.
- If no reviewer returns usable findings, fall back to `single-agent` critique and disclose the fallback.

## Judge/Synthesizer Rules

The final synthesizer is a judge, not a fourth reviewer. It deduplicates,
evaluates evidence, challenges overstatement, preserves disagreements, ranks
the most actionable and impactful findings, and recommends action. Consensus
is a prioritization signal, not proof. The synthesizer does not add votes.

LOC is not a proxy for risk. A tiny auth, permissions, data deletion, billing, or security-boundary change can require full adversarial review.

## Always Disclose

Before any launch, write the `Target:` line (see Identify the Target), the
`Review intensity: <low | auto | max>` line, the `Prior review:` outcome, and
the `Mode:` line once. Then, after the review completes and before the findings,
write these lines. Keep each line to one sentence.

```text
Execution path: <path> (adversarial-review, Updated: <date>)
Reviewers: <launched count>; <agent type>; <model and effort for each, or model not changed / model diversity not confirmed>; three independent contexts <achieved | not achieved>
Consensus ranking: <performed | not performed, with reason>
Premortem: <one sentence that names the most damaging credible failure>
```

Use one of these concise prior-review outcomes:
`not found`, `reused exact target`, `delta baseline found`, `mode-incompatible`,
`bypassed by max`, or `unavailable`.

Pre-launch status reports only whether a qualifying delta baseline was found.
Post-review execution details may say the delta was reviewed only after completion.

Never pretend agents were launched or models were changed. Say an agent was launched only if you personally invoked a tool for it in this conversation and can name the tool or agent. Say a model changed only if the runtime confirmed it or the subagent tool accepted a concrete model override. Otherwise say `model not changed`; retain the actual execution path and launched count.

## Portability Fallbacks

- No slash commands: invoke by name, e.g. "Use adversarial-review on..."
- Unknown CLI or no skill loader: paste or include this `SKILL.md` at conversation start and say, "Use the adversarial-review skill from this file on my next request."
- Skill not loading: if the assistant does not mention `adversarial-review` or choose SPAR/Rubber Duck mode, assume the file was not loaded.
- No model override: run three independent subagents if possible and disclose `model diversity not confirmed`; never substitute a small-tier model to fill a slot.
- No three-subagent support: run the available critique subagent count and disclose the downgrade.
- No `rubber-duck` agent: use generic critique subagents and disclose `rubber-duck unavailable`.
- No subagents: simulate separated perspectives sequentially and disclose that limitation.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Balanced pros/cons | Create roles with incompatible incentives |
| Synthesizing too early | Collect role or reviewer perspectives first |
| Treating critique as automatically true | Verify findings before changing plans |
| Hidden execution details | Disclose mode, execution path, subagents, models, and ranking |
| Style feedback | Prioritize defects, risks, assumptions, evidence, and tests |
| Counting yourself as a reviewer | Consensus counts only independent reviewer contexts |
| Claiming model diversity without model control | Say `model diversity not confirmed` |
| Naming a specific model version | Select by provider tier and generation from what the runtime exposes now |
| Filling a reviewer slot with a small/fast model | Use rule 9 with a frontier model, or reduce the reviewer count and disclose it |
| Dropping single-reviewer critical findings | Keep serious single-reviewer findings separately |
| Letting reviewers influence each other | Give each reviewer the same target but not other reviewers' findings during first pass |
| Treating consensus as proof | Consensus is a prioritization signal, not a guarantee |
| Ignoring disagreement | Preserve contradictions and recommend a resolution path |
| Treating reviewer count as proof | Cross-examine disagreement and rank surviving findings by evidence, impact, and actionability |
| Repeating an unchanged review | Check exact-target history and reuse it unless `max` requests a fresh panel |
| Making users choose mode and rigor | Expose only `low | auto | max`; infer mode unless the user explicitly forces it |
| Using LOC as risk proxy | Small auth, billing, deletion, or security-boundary changes can be critical |

## Example

User: "Use adversarial-review on this plan: cache all GET responses in memory for 10 minutes."

Expected shape: choose Rubber Duck mode; disclose whether three model-diverse
subagents were launched; collect independent findings; normalize equivalent
issues; rank by impact, actionability, confidence, and evidence quality, using
reviewer count only as a tie-breaker.

Example findings:

- Reviewer A found auth leakage, stale authorization, and memory growth.
- Reviewer B found stale authorization and memory growth.
- Reviewer C found memory growth and missing observability.

Final ranking:

1. Auth leakage: critical, high-confidence evidence, found by 1 reviewer; first
   because the impact and evidence dominate the support count.
2. Stale authorization: high impact, found by 2 reviewers.
3. Memory growth: medium impact, found by 3 reviewers.
4. Missing observability: medium impact, found by 1 reviewer.

For the cache example, likely high-priority findings include auth leakage from shared cache keys, invalidation gaps, per-user/per-permission cache keys, stale reads, memory growth, missing observability, and missing tests for authorization boundaries.

Disclosure example:

```text
Adversarial review | Updated: October 7, 2026
Target: plan text "cache all GET responses in memory for 10 minutes"
Review intensity: auto
Prior review: not found
Mode: Rubber Duck
Execution path: multi-model-subagents (adversarial-review, Updated: October 7, 2026)
Reviewers: 3; rubber-duck; one frontier model per preferred provider at xhigh; three independent contexts achieved
Consensus ranking: performed
Premortem: a shared cache key serves one user's authorized response to another user.
```
