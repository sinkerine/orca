# External build inputs and settings

Builds from source archives can set `ORCA_BUILD_COMMIT` to the full 40-character source commit. Without it, builds read the commit from Git. Invalid explicit values fail the build so bundled skills retain a trustworthy source identity.

Set `ORCA_TYPECHECK_COMPILER=native` to use the native TypeScript checker for CLI builds. The default remains the pinned Bun checker. Both paths retain the same TypeScript emitter.

At runtime, `ORCA_SETTINGS_FILE` may point to an administrator-supplied JSON object containing global settings. Orca merges it into each profile at startup: nested objects merge, arrays and scalar values replace existing values, and unspecified settings remain unchanged. Changes are saved through normal profile persistence. Restart Orca to reapply the file after changing it. Removing a key from the file does not undo its previously saved value. The file applies on the host running Orca; it does not configure a paired remote host.

Missing, unreadable, malformed, or non-object configured files fail startup. An unset variable leaves profile settings unchanged. Do not store secrets in a publicly readable settings file.
