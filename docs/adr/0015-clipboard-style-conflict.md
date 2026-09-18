# ADR 0015: Clipboard Style Conflict Policy

**Status:** Accepted  
**Date:** 2026-09-18  
**Deciders:** Architecture review (P6-15)

## Context

When pasting formatted content into a document, the source fragment may reference styles that already exist in the target document (e.g. `Heading 1`, `Normal`, or custom styles). If the target document's definition of `Heading 1` differs from the source document's definition (e.g. different font or color), a conflict arises.

Overwriting the target document's style definition with the source definition silently alters the formatting of all existing paragraphs in the destination document that use that style. Conversely, blindly stripping the style can destroy the user's intended appearance.

## Options Considered

### Option A: `keepSource` (Keep Source Formatting)
Preserve the exact visual appearance of the source fragment. When a style ID collides with an existing definition having different properties, mint a new unique style ID in the target document (e.g. `Heading 1_0` or `Heading 1_Pasted`) and rebind the pasted elements to it.

### Option B: `mergeFormatting` (Merge Formatting — CHOSEN DEFAULT)
Adopt the destination document's style hierarchy for matching style IDs while preserving direct formatting (runs with explicit bold, italic, color). If an unrecognised custom style is pasted, it is imported. If a matching style ID exists, the destination document's style definition takes precedence, conforming the pasted text to the target document's theme.

### Option C: `plainText` (Keep Text Only)
Strip all styles, character formatting, and XML structures, inserting only raw text and line breaks.

## Decision

Adopt **`mergeFormatting`** as the default clipboard paste policy, with support for `keepSource` and `plainText` options.

When `keepSource` is active and style definitions collide with conflicting rules:
- Collision resolution is handled by **renaming**, NEVER by overwriting. Overwriting silently restyles the entire destination document.

## Consequences

- Pasting content from external Word documents automatically harmonises with the current document's theme while keeping intentional direct emphasis (bold, italic, underline).
- Destructive restyling of existing paragraphs is mathematically prevented.
- The clipboard reader supports multi-mime data transfers: `application/x-ooxml-fragment`, `text/html`, and `text/plain`.
