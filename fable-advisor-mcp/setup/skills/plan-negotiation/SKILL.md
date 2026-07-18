---
name: plan-negotiation
description: Critique, negotiate, approve, and execute Claude/Fable-authored plans as a single binding authority. Use when a user hands Codex a Claude-authored draft plan for review, negotiation, agreement, implementation, or amendment.
---

# Plan Negotiation — Claude-authored plans, adversarially agreed, then binding

## When this applies

The user hands you a plan authored by Claude (Fable), typically with words like
"this is the plan Claude created, take a look." The plan file says
`Status: DRAFT — awaiting Codex negotiation` (or similar) in its header.
This skill defines the full lifecycle: review → negotiate → agree → implement.

## The contract

1. **One plan is the authority.** Once negotiated and marked agreed, the plan
   file is the single source of truth for scope, sequencing, success criteria,
   and stop rules. Research documents, chat history, and your own preferences
   feed the negotiation; they carry no authority afterward. Do not create
   parallel "non-authoritative" document trees — if knowledge matters, it gets
   adopted into the plan (or listed in the plan's explicit rejections); if it
   doesn't, it stays out.
2. **You must genuinely try to break the plan before accepting it.** A pass-
   through "looks good" review is a protocol violation. Fable wrote it; you are
   the independent check. The failure mode this protocol exists to prevent is
   two agents politely agreeing their way into a flawed design.

## Phase 1 — Independent review (before any advisor call)

Read the ENTIRE plan plus the repos/files it references. Form your own written
critique first, so the advisor cannot anchor you. Check at minimum:

- **Falsifiability:** does every milestone have a numeric success criterion and
  a defined response to failure (including scope-simplification, not just
  retry)? Can every proposed gate/metric actually fail — trace the computation.
- **Targets and data:** are training/eval targets deterministic functions of
  declared inputs? Is dataset disjointness content-based? Are sample sizes
  power-checked against the effect they must detect?
- **Sequencing:** is the riskiest assumption tested by the CHEAPEST early
  experiment, or is hard stuff deferred behind easy stuff (the "pilot the easy
  street" trap)?
- **Feasibility:** compute/timeline claims vs the actual hardware; unbuilt
  components presented as existing; labels that inflate ("solver",
  "independent", "validated") — verify against files.
- **Missing alternatives:** is there a cheaper standard-recipe experiment the
  plan skips? Name it with a cost estimate.

## Phase 2 — Negotiation via fresh advisor calls

Send your critique through a fresh plain `advisor` call. Put the plan's durable
state and already-resolved decisions in `project_state`; put the disputed plan
text, direct file excerpts, command output, your critique, and proposed
amendment in `context`. Do not resume prior advisor sessions: each round must be
self-contained so history growth cannot hide cost or anchor the negotiation.

If Fable identifies missing evidence, read it yourself and make another fresh
plain call with that evidence. Use at most one scoped `advisor_verify` when a
specific factual dispute cannot be packaged credibly or a genuinely
costly-to-undo final sign-off needs independent repository evidence. Name the
exact claims and file:line pointers; do not request a broad repo exploration.

- One disagreement per call where practical; include your evidence and
  proposed amendment text, not just objections.
- Iterate until every point is resolved as: **adopted** (plan amended),
  **rejected with reasons** (recorded), or **escalated to the user** (genuine
  judgment calls — cost/risk appetite, scope changes — are the user's, not
  yours or Fable's).
- Record every round in a `## Negotiation log` section of the plan file:
  date, point raised, evidence, resolution. This is the provenance that makes
  the agreement auditable. Advisor output and your own forwarded self-analysis
  are never counted as independent evidence for each other.

## Phase 3 — Agreement

When no open points remain (or the user has ruled on escalated ones), update
the plan header to `Status: AGREED v<N> — <date> — negotiated by Codex +
Fable, approved by user` and tell the user. Do not start implementation until
the user has seen the agreed version.

## Phase 4 — Implementation under the plan

- The agreed plan is binding. Deviations require a plan amendment negotiated
  the same way (a fresh rich plain round), not silent drift. Small
  mechanical details the plan doesn't specify are yours; anything touching
  scope, sequencing, success criteria, budgets, or stop rules is an amendment.
- Consult the plain advisor at every checkpoint the plan declares, passing
  compact state plus the actual controlling evidence and results.
- If reality falsifies a plan assumption, stop and renegotiate that section;
  the plan's stop rules and simplification ladder apply, never an unplanned
  patch/readiness chain.

## Header template for plan files

```
# <Project> — Plan
Status: DRAFT — awaiting Codex negotiation | UNDER NEGOTIATION | AGREED v<N> — <date>
Authority: this file, once AGREED. Research inputs are listed in §References
and have no independent authority.
Authors: Fable (draft), Codex (negotiation), user (approval)
Checkpoints: <where implementation must pause for advisor review>
Stop rules / simplification ladder: <what happens on milestone failure>
```
