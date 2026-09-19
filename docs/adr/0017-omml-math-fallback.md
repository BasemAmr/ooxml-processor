# ADR 0017: OMML MATH-table Fallback

**Status:** Accepted - NEEDS REVIEW  
**Date:** 2026-09-19  
**Deciders:** Layout architecture (P10-12a)

## Context

OMML layout needs OpenType MATH constants and glyph-variant/assembly tables for exact axis placement,
stretchy delimiters, radicals, fractions, and superscript shifts. The current text package exposes
shaping and metrics, but no MATH-table reader or assembly API. There is no Word or LibreOffice in this
environment to calibrate a substitute.

## Decision

Ship a bottom-up nested-box layout engine for all 19 OMML object kinds. It uses deterministic font-size
ratios when MATH constants are unavailable, records `math-math-table-unavailable`, and marks the result
as unverified. The engine preserves object structure and produces a visible placeholder diagnostic at
the integration boundary when a caller requires exact stretchy glyph construction.

## Alternatives considered

### Treat math as an unlabelled blank

Rejected because it violates G3 and makes unsupported content indistinguishable from a paint bug.

### Add a second font/shaping implementation

Rejected because it duplicates the text engine and still cannot be calibrated against Word here.

### Vendor a proprietary Cambria Math table

Rejected because it is not redistributable and would not solve fallback-font behavior.
