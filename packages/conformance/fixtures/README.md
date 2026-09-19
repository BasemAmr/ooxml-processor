# Malformed package recipes

The malformed-package corpus is generated on demand by
`MALFORMED_PACKAGE_RECIPES` in `src/index.ts`. The repository intentionally
does not contain executable ZIP bombs, entity-expansion payloads, or malformed
central directories: security scanners and source archives should not have to
carry those bytes permanently.

Each recipe has a stable id and expected OPC error code. CI materializes one
recipe at a time, opens it with the OPC reader, and asserts the named code.
The `entity-rejected` recipes are deliberately separate cases that exercise
the same DOCTYPE boundary (DOCTYPE, entity expansion, and external entities).
