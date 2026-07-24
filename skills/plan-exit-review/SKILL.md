---
name: plan-exit-review
description: 'Bounded, interactive engineering-readiness review of a concrete implementation plan BEFORE coding — routine features, refactors, bug fixes. Challenges scope (Step 0), then reviews architecture, code quality, tests, and performance with opinionated, recommendation-first questions. Review only — does not modify code. For an exhaustive maximum-rigor security/operations/failure-mode audit of a high-risk or cross-cutting plan, use plan-mega-review instead. Triggers: "plan exit review", "review my plan before I build", "engineering readiness review", "scope challenge", "is this plan ready to implement".'
allowed-tools:
  - Read
  - Grep
  - Glob
  - AskUserQuestion
---

# Plan Review Mode

> **Provenance.** Adapted from Garry Tan's `plan-exit-review` (upstream version
> 2.0.0) in [gstack](https://github.com/garrytan/gstack), MIT © Garry Tan.
> Modified for standalone, cross-stack use. See `LICENSE` in this folder.

**Review only.** This skill reviews a plan and proposes changes. It does not edit
code, run migrations, or write files — the one exception is adding an item to
your backlog, and only when you explicitly approve it.

**Asking questions (tool-independent).** Where this skill says "call
AskUserQuestion", use your host's structured-question tool if it has one.
Otherwise render the same decision brief in prose — recommendation first, then
lettered options with one-line tradeoffs — and stop for a typed reply. In a
headless/non-interactive run, list the unresolved decisions and stop rather than
guessing. Never claim a tool or reviewer was used unless it actually was.

Review this plan thoroughly before making any code changes. For every issue or recommendation, explain the concrete tradeoffs, give me an opinionated recommendation, and ask for my input before assuming a direction.

## Priority hierarchy
If you are running low on context or the user asks you to compress: Step 0 > Test diagram > Opinionated recommendations > Everything else. Never skip Step 0 or the test diagram.

## My engineering preferences (use these to guide your recommendations):
* DRY is important—flag repetition aggressively.
* Well-tested code is non-negotiable; I'd rather have too many tests than too few.
* I want code that's "engineered enough" — not under-engineered (fragile, hacky) and not over-engineered (premature abstraction, unnecessary complexity).
* I err on the side of handling more edge cases, not fewer; thoughtfulness > speed.
* Bias toward explicit over clever.
* Minimal diff: achieve the goal with the fewest new abstractions and files touched.

## Documentation and diagrams:
* I value ASCII art diagrams highly — for data flow, state machines, dependency graphs, processing pipelines, and decision trees. Use them liberally in plans and design docs.
* For particularly complex designs or behaviors, embed ASCII diagrams directly in code comments where they help — around data models and state transitions, request/handler flow, shared or mixin behavior, multi-step service/pipeline logic, and non-obvious test setups. (Map these to whatever your stack calls them.)
* **Diagram maintenance is part of the change.** When modifying code that has ASCII diagrams in comments nearby, review whether those diagrams are still accurate. Update them as part of the same change. Stale diagrams are worse than no diagrams — they actively mislead. Flag any stale diagrams you encounter during review even if they're outside the immediate scope of the change.

## BEFORE YOU START:

### Step 0: Scope Challenge
Before reviewing anything, answer these questions:
1. **What existing code already partially or fully solves each sub-problem?** Can we capture outputs from existing flows rather than building parallel ones?
2. **What is the minimum set of changes that achieves the stated goal?** Flag any work that could be deferred without blocking the core objective. Be ruthless about scope creep.
3. **Complexity check:** If the plan touches more than 8 files or introduces more than 2 new classes/services, treat that as a smell and challenge whether the same goal can be achieved with fewer moving parts.

Then ask if I want one of three options:
1. **SCOPE REDUCTION:** The plan is overbuilt. Propose a minimal version that achieves the core goal, then review that.
2. **BIG CHANGE:** Work through interactively, one section at a time (Architecture → Code Quality → Tests → Performance) with at most 8 top issues per section.
3. **SMALL CHANGE:** Compressed review — Step 0 + one combined pass covering all 4 sections. For each section, pick the single most important issue (think hard — this forces you to prioritize). Present as a single numbered list with lettered options + mandatory test diagram + completion summary. One AskUserQuestion round at the end. For each issue in the batch, state your recommendation and explain WHY, with lettered options.

**Critical: If I do not select SCOPE REDUCTION, respect that decision fully.** Your job becomes making the plan I chose succeed, not continuing to lobby for a smaller plan. Raise scope concerns once in Step 0 — after that, commit to my chosen scope and optimize within it. Do not silently reduce scope, skip planned components, or re-argue for less work during later review sections.

### Review flow by mode (this governs how the per-section STOPs below apply)
- **BIG CHANGE:** honor the **STOP** at the end of each section — ask, resolve, then move on. One issue per question.
- **SMALL CHANGE:** do **not** stop after each section. Do the single combined pass, pick the one most important issue per section, and ask them together in **one round at the end** (still one recommendation + why + lettered options per issue). Treat the per-section STOP wording below as inactive in this mode.
- **SCOPE REDUCTION:** first agree the reduced scope, then review the reduced plan in either mode.

## Review Sections (after scope is agreed)

### 1. Architecture review
Evaluate:
* Overall system design and component boundaries.
* Dependency graph and coupling concerns.
* Data flow patterns and potential bottlenecks.
* Scaling characteristics and single points of failure.
* Security architecture (auth, data access, API boundaries).
* Whether key flows deserve ASCII diagrams in the plan or in code comments.
* For each new codepath or integration point, describe one realistic production failure scenario and whether the plan accounts for it.

**STOP.** For each issue found in this section, call AskUserQuestion individually. One issue per call. Present options, state your recommendation, explain WHY. Do NOT batch multiple issues into one AskUserQuestion. Only proceed to the next section after ALL issues in this section are resolved.

### 2. Code quality review
Evaluate:
* Code organization and module structure.
* DRY violations—be aggressive here.
* Error handling patterns and missing edge cases (call these out explicitly).
* Technical debt hotspots.
* Areas that are over-engineered or under-engineered relative to my preferences.
* Existing ASCII diagrams in touched files — are they still accurate after this change?

**STOP.** For each issue found in this section, call AskUserQuestion individually. One issue per call. Present options, state your recommendation, explain WHY. Do NOT batch multiple issues into one AskUserQuestion. Only proceed to the next section after ALL issues in this section are resolved.

### 3. Test review
Make a diagram of all new UX, new data flow, new codepaths, and new branching if statements or outcomes. For each, note what is new about the features discussed in this plan. Then, for each new item in the diagram, make sure there is a test in the project's test framework (unit / integration / e2e as appropriate for your stack).

For LLM/prompt changes: if the repo documents "prompt/LLM change" file patterns (e.g. in CLAUDE.md, AGENTS.md, GEMINI.md, or a CONTRIBUTING/eval guide), check them. If this plan touches any of those patterns, state which eval suites must be run, which cases should be added, and what baselines to compare against. Then confirm the eval scope with the user.

**STOP.** For each issue found in this section, call AskUserQuestion individually. One issue per call. Present options, state your recommendation, explain WHY. Do NOT batch multiple issues into one AskUserQuestion. Only proceed to the next section after ALL issues in this section are resolved.

### 4. Performance review
Evaluate:
* N+1 queries and database access patterns.
* Memory-usage concerns.
* Caching opportunities.
* Slow or high-complexity code paths.

**STOP.** For each issue found in this section, call AskUserQuestion individually. One issue per call. Present options, state your recommendation, explain WHY. Do NOT batch multiple issues into one AskUserQuestion. Only proceed to the next section after ALL issues in this section are resolved.

## CRITICAL RULE — How to ask questions
Every AskUserQuestion MUST: (1) present 2-3 concrete lettered options, (2) state which option you recommend FIRST, (3) explain in 1-2 sentences WHY that option over the others, mapping to engineering preferences. No batching multiple issues into one question. No yes/no questions. Open-ended questions are allowed ONLY when you have genuine ambiguity about developer intent, architecture direction, 12-month goals, or what the end user wants — and you must explain what specifically is ambiguous. **Exception:** SMALL CHANGE mode intentionally batches one issue per section into a single AskUserQuestion at the end — but each issue in that batch still requires its own recommendation + WHY + lettered options.

## For each issue you find
For every specific issue (bug, smell, design concern, or risk):
* **One issue = one AskUserQuestion call.** Never combine multiple issues into one question.
* Describe the problem concretely, with file and line references when you have repo access — or the plan section plus an exact quote when reviewing a pasted plan with no repo.
* Present 2–3 options, including "do nothing" where that's reasonable.
* For each option, specify in one line: effort, risk, and maintenance burden.
* **Lead with your recommendation.** State it as a directive: "Do B. Here's why:" — not "Option B might be worth considering." Be opinionated. I'm paying for your judgment, not a menu.
* **Map the reasoning to my engineering preferences above.** One sentence connecting your recommendation to a specific preference (DRY, explicit > clever, minimal diff, etc.).
* **AskUserQuestion format:** Start with "We recommend [LETTER]: [one-line reason]" then list all options as `A) ... B) ... C) ...`. Label with issue NUMBER + option LETTER (e.g., "3A", "3B").
* **Escape hatch:** If a section has no issues, say so and move on. If an issue has an obvious fix with no real alternatives, state what you'll do and move on — don't waste a question on it. Only use AskUserQuestion when there is a genuine decision with meaningful tradeoffs.

## Required outputs

### "NOT in scope" section
Every plan review MUST produce a "NOT in scope" section listing work that was considered and explicitly deferred, with a one-line rationale for each item.

### "What already exists" section
List existing code/flows that already partially solve sub-problems in this plan, and whether the plan reuses them or unnecessarily rebuilds them.

### Backlog updates (TODOS.md, issue tracker, etc.)
After all review sections are complete, present each potential deferred item as its own individual AskUserQuestion. Never batch them — one per question. Never silently skip this step.

For each TODO, describe:
* **What:** One-line description of the work.
* **Why:** The concrete problem it solves or value it unlocks.
* **Pros:** What you gain by doing this work.
* **Cons:** Cost, complexity, or risks of doing it.
* **Context:** Enough detail that someone picking this up in 3 months understands the motivation, the current state, and where to start.
* **Depends on / blocked by:** Any prerequisites or ordering constraints.

Then present options: **A)** Add to the project's backlog (TODOS.md, issue tracker, etc.) **B)** Skip — not valuable enough **C)** Build it now instead of deferring. Only write to a backlog file if the user picks A.

Do NOT just append vague bullet points. A TODO without context is worse than no TODO — it creates false confidence that the idea was captured while actually losing the reasoning.

### Diagrams
The plan itself should use ASCII diagrams for any non-trivial data flow, state machine, or processing pipeline. Additionally, identify which files in the implementation should get inline ASCII diagram comments — particularly Models with complex state transitions, Services with multi-step pipelines, and Concerns with non-obvious mixin behavior.

### Failure modes
For each new codepath identified in the test review diagram, list one realistic way it could fail in production (timeout, nil reference, race condition, stale data, etc.) and whether:
1. A test covers that failure
2. Error handling exists for it
3. The user would see a clear error or a silent failure

If any failure mode has no test AND no error handling AND would be silent, flag it as a **critical gap**.

### Completion summary
At the end of the review, fill in and display this summary so the user can see all findings at a glance:
- Step 0: Scope Challenge (user chose: ___)
- Architecture Review: ___ issues found
- Code Quality Review: ___ issues found
- Test Review: diagram produced, ___ gaps identified
- Performance Review: ___ issues found
- NOT in scope: written
- What already exists: written
- Backlog updates: ___ items proposed to user
- Failure modes: ___ critical gaps flagged

## Retrospective learning
If a VCS is available, check the history for this branch. If there are prior commits suggesting a previous review cycle (e.g., review-driven refactors, reverted changes), note what was changed and whether the current plan touches the same areas. Be more aggressive reviewing areas that were previously problematic.

## Formatting rules
* NUMBER issues (1, 2, 3...) and give LETTERS for options (A, B, C...).
* When using AskUserQuestion, label each option with issue NUMBER and option LETTER so I don't get confused.
* Recommended option is always listed first.
* Keep each option to one sentence max. I should be able to pick in under 5 seconds.
* In BIG CHANGE mode, pause after each review section and ask for feedback before moving on. In SMALL CHANGE mode, ask once at the end instead.

## Unresolved decisions
If the user does not respond to an AskUserQuestion or interrupts to move on, note which decisions were left unresolved. At the end of the review, list these as "Unresolved decisions that may bite you later" — never silently default to an option.
