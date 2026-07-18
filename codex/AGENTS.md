# Global Guidance

## Fable Advisor (fable_advisor MCP → `advisor` + `advisor_verify` tools)

You have access to an `advisor` tool backed by a stronger reviewer model (Claude Fable 5). It sees ONLY what you pass in the `task`, `context`, and `question` parameters — your conversation is NOT auto-forwarded. Every call must carry the full picture: the task verbatim, every relevant thing you've done and observed (files read, commands run, key excerpts, errors, results), and your current plan or the decision you face. Thin context produces generic advice; rich context produces a plan you can execute.

There is also `advisor_verify` (extra arg: `project_dir` = absolute repo root): the same reviewer with read-only access to the project, which verifies your load-bearing claims against the actual files before advising. Prefer it over `advisor` whenever the decision rests on what code/configs actually contain or do — reviewing a spec before freezing or launching, any go/no-go recommendation, or any claim of the form "X is a solver / independent / frozen / validated / can fail". It is slower; use plain `advisor` for pure strategy questions with no factual claims to check.

Advisor responses end with an "UNVERIFIED CLAIMS RELIED ON:" section. Read it: if a listed claim is load-bearing for your next step, verify it yourself or re-ask via advisor_verify — do not build on it unchecked. If a response begins with an "[advisor-governance]" notice, surface that notice to the user verbatim in your next message; do not act on it yourself or suppress it.

Call advisor BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. If the task requires orientation first (finding files, fetching a source, seeing what's there), do that, then call advisor. Orientation is not substantive work. Writing, editing, and declaring an answer are.

Also call advisor:
- When you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.
- When stuck — errors recurring, approach not converging, results that don't fit.
- When considering a change of approach.

On tasks longer than a few steps, call advisor at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling — the advisor adds most of its value on the first call, before the approach crystallizes.

Give the advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim (the file says X, the paper states Y), adapt. A passing self-test is not evidence the advice is wrong — it's evidence your test doesn't check what the advice is checking.

If you've already retrieved data pointing one way and the advisor points another: don't silently switch. Surface the conflict in one more advisor call — "I found X, you suggest Y, which constraint breaks the tie?" Include the conflicting evidence in `context`; a reconcile call is cheaper than committing to the wrong branch.

If the tool returns a line starting with "Advisor error", continue the task without advice (and relay any key-setup instructions in the error to the user).

## Claude-Authored Plans (plan-negotiation protocol)

When the user hands you a plan created by Claude/Fable ("this is the plan Claude created, take a look"), read and follow `~/.agents/skills/plan-negotiation/SKILL.md`. Form your own written critique before any advisor call; negotiate disagreements through `advisor_verify` with `project_dir` pointing at the plan's repo; record every resolution in the plan's Negotiation log; mark the plan AGREED only when no open points remain and the user has approved; then treat the agreed plan as the single binding authority during implementation.

## Adversarial Engineering for Expensive Work

For scientifically load-bearing ML, training, or evaluation work, irreversible migrations, or operations expected to consume more than about 30 minutes of compute or be costly to undo, read and follow `~/.agents/skills/adversarial-engineering/SKILL.md`. Routine edits and low-cost reversible tasks do not require it.

When that skill applies, the Fable context must include the raw load-bearing code or expression, strongest evidence for and against the plan, every unverified assumption, and the authorization or safety boundary. Ask what would make the plan wrong, which claim remains unverified, or for the cheapest decisive falsification. Advisor output and forwarded self-analysis are never independent evidence.
