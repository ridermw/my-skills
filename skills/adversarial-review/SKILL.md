---
name: adversarial-review
description: 'Pressure-tests an idea, plan, or change by running separated adversarial reviewer perspectives rather than a generic pros/cons list, then synthesizes consensus-ranked findings with severity, confidence and cited evidence. SPAR mode debates a decision through roles with conflicting incentives; Rubber Duck mode runs independent critique reviewers over an artifact and ranks what they agree on. Always discloses the execution path it actually achieved and never claims reviewers or model diversity it did not. Use when the user asks to pressure-test, stress-test, poke holes in, red-team or critique an idea, proposal, strategy, architecture tradeoff, code change, test plan, debugging hypothesis, suspected bug or risky decision. For a bounded pre-coding readiness gate on a concrete implementation plan use plan-exit-review, and for a maximum-rigor audit of a high-risk plan use plan-mega-review; this skill is adversarial critique of any artifact or decision, not a plan-approval workflow.'
---

# Adversarial Review

## Overview

Stress-test thinking before committing. Use separated perspectives first, then synthesize; do not collapse into a generic pros/cons list.

For implementation plans, code changes, tests, debugging hypotheses, or critique requests, prefer independent reviewer contexts and consensus-ranked findings. Consensus is useful only when independence is real.

## Choose the Mode

| User need | Mode |
| --- | --- |
| Idea, proposal, strategy, product bet, architecture tradeoff | SPAR |
| Code change, implementation plan, tests, debugging hypothesis, critique request | Rubber Duck |
| Ambiguous high-stakes decision | SPAR, then Rubber Duck on the favored path |
| Unclear or out-of-scope request | Ask the user to clarify the decision or artifact before selecting a mode |

## Capability Check

Before substantive content, determine this once and reuse it:

| Capability | Execution path |
| --- | --- |
| Three independent subagents available and model override supports three distinct provider families | `multi-model-subagents` |
| Three independent subagents available but distinct model control is unavailable or unconfirmed | `parallel-subagents` |
| One critique/generic subagent available | `single-subagent` |
| No subagent tool available | `single-agent` |

For a substantive artifact, target exactly three independent reviewer contexts whenever possible; see Proportionality below for when a smaller artifact does not warrant three. If three distinct model-backed subagents cannot be launched, degrade gracefully to the best available independent contexts and disclose the downgrade.

**Proportionality.** Three reviewers are for a substantive artifact — a plan, a
design, a diff, a decision with real consequences. For a single function, a
one-line question, or a change you could fully critique yourself in a couple of
steps, run `single-agent`, say so, and skip the subagent overhead. Do not spawn
reviewers whose combined cost exceeds the value of the critique.

## Output length

Match length to the findings, not to the section list. Report every section the
mode calls for, but collapse an empty one to a single line instead of padding
it. Lead with the highest-priority finding. Do not restate the artifact back to
the user, and do not repeat the same finding in full in both the
consensus-ranked list and the recommended-changes list — cross-reference it.

## Model Diversity Heuristic

The goal is three independent, high-effort reasoning contexts from three
*different* model providers. Select by **tier and generation, never by version
number.** This skill deliberately names no model: any name hardcoded here is
wrong the moment the runtime updates, and a stale allow-list silently degrades
the review by excluding models that did not exist when it was written.

**Never hardcode a model version — not in this file, and not in your selection
reasoning.** Enumerate what the runtime actually exposes at request time, then
rank it.

Selection rules:

1. **Enumerate, then rank.** Ask the runtime which models it exposes and group
   them by provider. Do not assume any particular provider or model exists.
2. **One reviewer per provider, three providers.** Independence comes from
   different providers, not from three variants of one family.
3. **Take each provider's frontier general-reasoning tier** — the tier that
   provider positions for its hardest reasoning and agentic work — and the
   newest generation of that tier.
4. **Exclude the small/fast tier.** Skip anything the runtime labels or markets
   as mini, small, flash, lite, nano, turbo, instant, fast, cheap, or
   economical, and any model presented as the lightweight sibling of a larger
   one. Judge by the runtime's own tier description at request time, not by a
   remembered list of names — tier labels change.
5. **Reasoning effort: the highest each reviewer supports.** Read the effort
   levels the runtime offers and take the top rung, whatever it is called. Never
   set a reviewer below the runtime's "high" equivalent. If effort is not
   controllable, say so rather than implying it was set.
6. **Code review:** a code-specialized model may hold a reviewer slot only if it
   is that provider's frontier tier; otherwise keep general-reasoning models.
7. **Never fabricate.** If a provider, model, or effort level is not actually
   exposed, do not invent it and do not substitute a small-tier model to fill a
   slot. Run the reviewers you can, reduce the count, and disclose
   `model diversity not confirmed`.
8. **Fewer than three providers is a downgrade to disclose, not a reason to
   lower the tier bar.** Two frontier reviewers beat three where one is a
   small-tier stand-in.

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
3. Pick 3-5 roles with genuinely conflicting incentives.
4. If execution path is `multi-model-subagents` or `parallel-subagents`, dispatch one role per agent in parallel. Otherwise simulate roles sequentially and say so.
5. For each role, give the strongest objection, strongest support, hidden assumption, and failure mode.
6. Synthesize only after role perspectives.
7. End with the single most important open question. If decision-blocking information is genuinely missing, end with up to three such questions instead — but do not pad to more than one when one suffices.

Use sections: Conflict framing, Roles, Perspective [Role], Synthesis, Open question(s).

## Rubber Duck Mode

1. State: `Mode: Rubber Duck`.
2. Choose the execution path from Capability Check.
3. For `multi-model-subagents`, launch three independent critique subagents in parallel using the Model Diversity Heuristic and distinct Adversarial Reviewer Lenses.
4. For `parallel-subagents`, launch three independent critique subagents in parallel without claiming distinct model coverage.
5. For `single-subagent`, launch one critique subagent and perform synthesis yourself; do not count the synthesizer as a second reviewer.
6. For `single-agent`, perform the critique yourself and disclose that no subagent was launched.
7. Each reviewer must receive the same critique target and must not see other reviewers' findings during the first pass.
8. Each reviewer runs the Premortem Pass, checks the Review Constitution, and returns findings in the Reviewer Output Schema.
9. Focus only on high-signal issues: correctness, security, reliability, missing tests, bad assumptions, and edge cases.
10. Separate accepted findings from rejected or unverified concerns.

Use sections: Critique target, Execution disclosure, Consensus-ranked findings, Single-reviewer findings worth considering, Recommended changes, Rejected or unverified concerns, Next action.

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
3. Rank grouped findings by number of independent reviewers that found the issue.
4. Break ties by severity, then confidence, then evidence quality.
5. Keep single-reviewer findings in a separate section when they are high severity, well-evidenced, or plausibly important.
6. Do not discard a serious issue only because one reviewer found it.
7. Do not inflate consensus by counting the main assistant's synthesis as an additional reviewer.
8. Treat contradictory findings as a signal. Preserve the disagreement and recommend how to resolve it.

For each consensus-ranked finding, show:

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

After independent first-pass reviews, the synthesizer may show reviewers the other findings and ask:

> What did they miss? Which of your original findings should change? Which disagreement is itself a risk?

Do not count this second round as new independent consensus. It is for refinement, conflict discovery, and missed-assumption detection only.

If all reviewers agree too neatly, run a groupthink check: ask one reviewer to identify what shared assumption could make all reviewers wrong.

## Reviewer Failure Handling

If one or more reviewers fail:

- Continue with completed reviewers when at least one usable review exists.
- Disclose which reviewer failed and whether its model was requested.
- Rank consensus by completed reviewer count, not the original target of three.
- Do not invent missing reviewer findings.
- If no reviewer returns usable findings, fall back to `single-agent` critique and disclose the fallback.

## Judge/Synthesizer Rules

The final synthesizer is a judge, not a fourth reviewer. It deduplicates, evaluates evidence, preserves disagreements, ranks findings, and recommends action. It does not add consensus votes.

LOC is not a proxy for risk. A tiny auth, permissions, data deletion, billing, or security-boundary change can require full adversarial review.

## Always Disclose

Before the substantive answer, state:

- selected mode
- execution path
- subagents actually launched, including agent/tool names when available
- model and reasoning-effort requested for each subagent, or `model not changed` / `model diversity not confirmed`
- whether three independent reviewer contexts were achieved
- whether consensus ranking was performed

Never pretend agents were launched or models were changed. Say an agent was launched only if you personally invoked a tool for it in this conversation and can name the tool or agent. Say a model changed only if the runtime confirmed it or the subagent tool accepted a concrete model override. Otherwise say `single-agent review; no subagent launched; model not changed`.

## Portability Fallbacks

- No slash commands: invoke by name, e.g. "Use adversarial-review on..."
- Unknown CLI or no skill loader: paste or include this `SKILL.md` at conversation start and say, "Use the adversarial-review skill from this file on my next request."
- Skill not loading: if the assistant does not mention `adversarial-review` or choose SPAR/Rubber Duck mode, assume the file was not loaded.
- No model override: run three independent subagents if possible and disclose `model diversity not confirmed`; never substitute a small-tier model to fill a slot.
- No three-subagent support: run the available critique subagent count and disclose the downgrade.
- No `rubber-duck` agent: use generic critique subagents.
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
| Filling a reviewer slot with a small/fast model | Reduce the reviewer count instead and disclose it |
| Dropping single-reviewer critical findings | Keep serious single-reviewer findings separately |
| Letting reviewers influence each other | Give each reviewer the same target but not other reviewers' findings during first pass |
| Treating consensus as proof | Consensus is a prioritization signal, not a guarantee |
| Ignoring disagreement | Preserve contradictions and recommend a resolution path |
| Using LOC as risk proxy | Small auth, billing, deletion, or security-boundary changes can be critical |

## Example

User: "Use adversarial-review on this plan: cache all GET responses in memory for 10 minutes."

Expected shape: choose Rubber Duck mode; disclose whether three model-diverse subagents were launched; collect independent findings; normalize equivalent issues; rank by consensus.

Example consensus:

- Reviewer A found issues 1, 2, and 3.
- Reviewer B found issues 2, 3, and 4.
- Reviewer C found issues 1 and 2.

Final ranking:

1. Issue 2: found by 3 reviewers.
2. Issues 1 and 3: found by 2 reviewers.
3. Issue 4: found by 1 reviewer, retained only if severity/evidence justifies it.

For the cache example, likely high-priority findings include auth leakage from shared cache keys, invalidation gaps, per-user/per-permission cache keys, stale reads, memory growth, missing observability, and missing tests for authorization boundaries.

Disclosure example:

```text
Mode: Rubber Duck
Execution path: multi-model-subagents
Subagents launched: three critique agents
Models: provider-family diversity requested; exact model versions not hard-coded
Three independent reviewer contexts: achieved
Consensus ranking: performed
```
