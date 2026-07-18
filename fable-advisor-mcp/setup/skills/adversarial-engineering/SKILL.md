---
name: adversarial-engineering
description: Challenge assumptions and design the cheapest decisive falsification before expensive execution. Use for scientifically load-bearing ML, training, or evaluation work, irreversible migrations, or operations expected to consume more than about 30 minutes of compute or be costly to undo. Do not trigger for routine edits, ordinary debugging, or low-cost reversible tasks.
---

# Adversarial Engineering

Use evidence to attack the proposed approach before scaling it. Optimize for a decisive domain result, not for accumulating readiness artifacts.

## Workflow

1. **State the claim.** Write the intended outcome, current baseline, and numerical pass/fail criteria. Separate domain-performance claims from correctness, readiness, and process evidence.
2. **Map the causal path.** Identify the inputs, transformations, metrics, decision gate, and output supporting the claim. Mark every unverified assumption.
3. **Try to break it.** Find the cheapest test that could disprove the central hypothesis. Inspect raw code, expressions, configs, and data provenance rather than relying on summaries.
4. **Consult Fable adversarially.** Supply the full context template below. Ask for disconfirmation, not approval.
5. **Run the smallest end-to-end smoke.** Exercise the real input-to-result path before building more infrastructure or starting a large run.
6. **Decide.** Scale only after the smoke supports the claim. After two failed corrective iterations on the same hypothesis, stop patching and choose a redesign or ask the user to decide.

## Mandatory Invariants

- A learning target must be a deterministic function of model inputs. Assert that the same canonical input produces the same target.
- A metric must distinguish a known-good case from a known-bad case before it can gate a run. Reject constant, self-cancelling, vacuous, or unreachable gates.
- An abstraction or feature change must prove nonredundancy with a collision example, state census, or equivalent argument. Show which states will merge or separate and why.
- Freeze evaluation data, thresholds, and selection rules before observing candidate results.
- Treat readiness and governance results as readiness and governance evidence, never as domain-performance evidence.
- Preserve evidence provenance. SELF_ANALYSIS, ADVISOR_REVIEW, CODE_EVIDENCE, and EXTERNAL_AUDIT may be concise labels; forwarded self-analysis and advisor output are never independent confirmation.
- Run a minimal end-to-end domain smoke before expensive execution. Synthetic or unit tests alone are insufficient when the claim concerns real data or gameplay.

## Fable Context Quality Gate

For work covered by this skill, include all six fields. Use N/A rather than omitting a field.

    TASK / DECISION:
    RAW LOAD-BEARING CODE OR EXPRESSION:
    STRONGEST EVIDENCE FOR (paths, commands, measurements, hashes):
    STRONGEST EVIDENCE AGAINST, or "none found — searched ...":
    UNVERIFIED ASSUMPTIONS:
    AUTHORIZATION / SAFETY BOUNDARY:

Then ask at least one:

- What would make this plan wrong?
- Which load-bearing claim remains unverified?
- What is the cheapest decisive falsification?

If Fable conflicts with primary evidence, quote both and request reconciliation. Never silently choose the preferred answer.

## Compact Launch Gate

Keep the launch gate machine-checkable and at most five items:

1. Exact code, config, and data identity match the reviewed inputs.
2. The target-input, metric-variation, and abstraction-nonredundancy invariants pass.
3. The real end-to-end smoke passes its frozen criteria.
4. Resource and safety limits are active and fail closed.
5. The run produces durable progress and a terminal result without relying on manual interpretation.

Do not add approval layers or documents merely to satisfy this checklist. Reuse existing evidence when it directly proves the requirement.

## Stop and Escalate

Stop rather than patch when the central hypothesis is contradicted, required evidence is unavailable, the evaluation is circular, or two corrective iterations fail for the same reason. Report one concrete redesign decision. Do not rename the same patch chain and continue.
