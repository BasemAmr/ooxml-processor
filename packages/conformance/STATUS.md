# Conformance gate status

The conformance runners and their unit tests run in this repository. Coverage,
equivalence, round-trip, golden serialization, fuzz, malformed-package recipe,
and determinism checks are locally executable through the injected interfaces.

Visual comparison against Word or LibreOffice, and the manual Word reopen
check, remain blocked here: **unverified — no Word/LibreOffice available in
this environment.** The visual runner reports its reference source and carries
that caveat in every result. Browser performance gates are authored as CI
interfaces and require the Phase 11 Playwright environment and corpus.
