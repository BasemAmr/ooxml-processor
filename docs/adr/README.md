# Architecture Decision Records

Each file records one decision: the context, the choice, and what it costs us.
Decisions made autonomously (while the project owner was away) are marked
**⚠ NEEDS REVIEW** — these are the ones to read first.

| #                                             | Decision                                                | Status                    |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------- |
| [0001](0001-repo-location-and-disk-budget.md) | Repo on `D:`, pnpm store pinned alongside it            | Accepted ⚠ NEEDS REVIEW   |
| [0002](0002-zip-library.md)                   | `fflate` for ZIP read/write                             | Accepted                  |
| [0003](0003-document-model-representation.md) | Model representation                                    | **Open — spike required** |
| [0004](0004-text-shaper.md)                   | `harfbuzzjs` (WASM) for shaping                         | Accepted — owner-approved |
| [0005](0005-worker-boundary.md)               | Main thread for v1, serializable display list           | Accepted                  |
| [0006](0006-xml-parsing-strategy.md)          | `saxes` streaming parser, one reader for both runtimes  | Accepted ⚠ NEEDS REVIEW   |
| [0007](0007-verification-constraints.md)      | No Word or LibreOffice available; what that invalidates | Accepted ⚠ NEEDS REVIEW   |
| [0008](0008-dialect-handling.md)              | Transitional primary, Strict read + preserved           | Accepted ⚠ NEEDS REVIEW   |
| [0009](0009-unknown-content-preservation.md)  | Position-faithful capture of unrecognized content       | Accepted ⚠ NEEDS REVIEW   |
