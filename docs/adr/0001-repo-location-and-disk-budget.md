# 0001 — Repository on `D:`, pnpm store pinned alongside it

**Status:** Accepted ⚠ NEEDS REVIEW
**Date:** 2026-09-16

## Context

The project owner directed that work happen on `D:` in a new `workspace` folder, because
`C:` had ~9 GB free. Measured at setup time:

```
C:   196G total, 186G used,  9.5G free  (96%)
D:   242G total, 232G used,   11G free  (96%)
```

Both drives are effectively full. This is a hard constraint on the project, not a
preference — a careless `pnpm install` can consume several GB.

The default pnpm store was on `C:` (`C:\Users\smart\AppData\Local\pnpm\store\v11`), as was
the npm cache. A stale, unused `D:\.pnpm-store` existed from some earlier setup.

## Decision

- Repository lives at `D:\workspace\ooxml-editor`.
- `pnpm-workspace.yaml` pins `storeDir: D:/.pnpm-store`.
- `onlyBuiltDependencies` is an explicit allowlist (currently just `esbuild`), so no
  dependency can run an arbitrary postinstall — which is both the security posture and
  the disk guard. Playwright downloads its ~1 GB of browsers from a postinstall script,
  so the allowlist already prevents that; Phase 11 will invoke `playwright install`
  deliberately. There is **no `.npmrc`**: a `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` entry there
  was redundant with the allowlist and made npm warn on every `npx` invocation.
- Art-border PNGs (~30 MB) are not vendored until Phase 10. See `assets/schema/PROVENANCE.md`.

### A trap worth recording

The store pin was first written to `.npmrc` as `store-dir=...`. **pnpm 10+ reads its own
settings from `pnpm-workspace.yaml` and silently ignores them in `.npmrc`** — no warning, no
error. The install happened to land on `D:` regardless, because pnpm defaults the store to
the drive it is installing on when that differs from the home drive. So the misconfiguration
produced a correct result for an unrelated reason, and would have kept doing so right up
until it didn't.

Verify the store location from install output (`Content-addressable store is at: ...`), not
from config files. `pnpm config get store-dir` returns `undefined` here even when the setting
is active.

## Why the store location matters more than it looks

pnpm populates `node_modules` by **hardlinking** from its content-addressed store.
Hardlinks cannot cross volumes. Store on `C:` + repo on `D:` silently degrades to copying
every file of every dependency — turning a ~200 MB shared store into gigabytes of
duplicated `node_modules` across workspace packages. With 11 GB free that is not
survivable. Pinning the store to `D:` is both a correctness and a space decision.

## Consequences

- Dependency additions must stay deliberate. Prefer small, focused libraries; justify
  anything that pulls a large transitive tree.
- CI (when it exists) will not share this layout and must set its own store path.
- If the owner later frees space on `C:` or prefers a different location, only
  `pnpm-workspace.yaml` and the clone path change — nothing in the source tree encodes
  the drive letter.
