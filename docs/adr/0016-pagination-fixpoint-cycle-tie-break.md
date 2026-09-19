# ADR 0016: Deterministic Pagination Fixpoint Tie-Break

**Status:** Accepted - NEEDS REVIEW  
**Date:** 2026-09-18  
**Deciders:** Layout architecture (P8-06, P8-09)

## Context

Headers, fields, footnotes, and drawing anchors can make page geometry depend on the result of the
same pagination pass. Some ordinary documents therefore oscillate between a small set of quantised
states. A loop with only a maximum iteration count can return a different result depending on where
the loop started or where the cap happened to fall.

## Decision

The shared fixpoint driver compares caller-supplied quantised keys, records the first iteration for
each key, and stops as soon as a key repeats. For a cycle it returns the state associated with the
lexicographically lowest key and reports the cycle through a callback. A hard iteration cap remains
as a second bound and reports a limit event without throwing.

Footnote pagination uses the same driver, but chooses the largest reserve represented by an oscillating
cycle before its final fill. Losing a little body space is preferable to dropping a referenced
footnote, which would violate document preservation.

## Alternatives considered

### Cap only

Rejected because output depends on the entry point and cap position, making repeated layout of the
same document unstable.

### Floating-point equality

Rejected because sub-twip rounding noise can prevent convergence forever. Quantisation belongs to the
caller because different layout loops expose different state shapes.

### Always choose the largest state

Rejected for the general driver: state keys need not be monotonic dimensions. The footnote loop is
the specific consumer where the larger reserve is the preservation-safe tie-break.
