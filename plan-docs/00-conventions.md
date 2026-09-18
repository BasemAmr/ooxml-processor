# Ticket conventions

## Ticket format

Every ticket uses exactly these fields, in this order. Anything else is prose in the Design section.

```
### P<phase>-<nn> — <imperative title>

**Size** S|M|L|XL · **Depends** <ticket ids, or "—"> · **Escalate** yes|no · **Owns** <files/dirs>

**Goal.** One sentence. What exists after this ticket that did not before.

**Trap.** The specific way this ticket gets implemented wrongly, and why the wrong version looks
right. Omit only if there genuinely is no trap.

**Design.** Pseudo-code and prose. Data shapes, algorithm, ordering constraints.

**Done when.** Checkable statements. Each one must be verifiable by running something or reading a
specific output — never "works correctly".
```

## Sizing

Sizes describe **design risk**, not typing volume. A 600-line mechanical emitter is S. A 40-line
fixpoint driver is L.

| Size   | Meaning                                                                                      |
| ------ | -------------------------------------------------------------------------------------------- |
| **S**  | The approach is obvious. Failure is loud (a type error, a red test). One sitting.            |
| **M**  | The approach is known but has ordering or edge-case subtlety. Needs its own tests.           |
| **L**  | The approach must be chosen before it can be implemented. Get the data shape reviewed first. |
| **XL** | Contains a decision that constrains later phases. Must produce an ADR. Always **Escalate**.  |

## Escalate

`Escalate: yes` means: a wrong answer here is either **invisible** (silent document corruption, a
broken guarantee, a subtly wrong cascade) or **structural** (forecloses a later phase). These are
worth a stronger model and a careful review.

`Escalate: no` means the failure mode is **loud** — a failing test, a type error, a red CI gate.
This codebase is deliberately built so most mistakes are loud. Those are the cheap ones.

## Definition of done — applies to every ticket

1. `npx tsc -p <touched package> --noEmit` exits 0.
2. `pnpm vitest run <touched package>/src` is green, and the ticket added tests for its own behaviour.
3. If the ticket touched `packages/codegen`: `pnpm gen && git diff --exit-code packages/schema/src/generated`
   exits 0. The determinism gate is not optional.
4. The **Done when** clause is literally true, demonstrated by pasted terminal output — not asserted.
5. No invariant in `01-invariants.md` is violated.
6. Committed. Never leave the tree in a knowingly-broken intermediate state overnight.

## Labels used in ticket text

| Label               | Meaning                                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEC-GAP`          | The standard does not settle this. The implementation is a calibrated approximation and the code must say so in a comment.                                           |
| `UNVERIFIABLE-HERE` | Correctness depends on comparing against Word or LibreOffice, neither of which exists on this machine (ADR 0007). Ship it, mark it unverified, never claim fidelity. |
| `FIXPOINT`          | Participates in an iterative convergence loop. Must be idempotent and must not allocate identity per iteration.                                                      |
| `HOT-PATH`          | Runs per glyph, per line, or per frame. Allocation and megamorphic dispatch matter here.                                                                             |
| `ROUND-TRIP`        | Touches what gets written back to the file. A bug here corrupts documents silently.                                                                                  |

## Estimation is deliberately absent

No story points, no day estimates. The phases have wildly different uncertainty and a number would be
false precision. Size + dependency order is what sequences the work.

## Ticket IDs are permanent

Never renumber. A withdrawn ticket keeps its ID and gains a `**WITHDRAWN** — reason` line. Cross-phase
references (`P9-04 depends on P5-01`) break silently otherwise.

## When a ticket needs a decision the plan does not cover

Per the standing autonomy policy: pick the most defensible option, write an ADR in `docs/adr/` with
`Status: Accepted — ⚠ NEEDS REVIEW`, reference it from the ticket, and keep going. Do not stall.

An ADR records **a decision and the alternatives that were rejected, with reasons**. It is not a
summary of what the code does. Most bad ideas die while writing the "Alternatives considered" section,
which is the main reason the policy exists.
