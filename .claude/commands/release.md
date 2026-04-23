Update all version strings across the project for a new CP Helper release.

## Steps

1. **Read current version** from `package.json` (`"version"` field).

2. **Determine new version**: if the user provided a version as an argument (e.g. `/release 1.2.0`), use it. Otherwise ask the user what the new version should be before proceeding.

3. **Update these files** — replace every occurrence of the old version with the new version:

   | File                    | What to change                                                                                              |
   | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
   | `package.json`          | `"version"` field                                                                                           |
   | `package-lock.json`     | top-level `"version"` and the `""` package entry `"version"` (two occurrences, both at the top of the file) |
   | `README.md`             | `Stable baseline: X.Y.Z` line and `Companion browser extension: OJ Sync X.Y.Z` line                        |
   | `oj-sync/manifest.json` | `"version"` field and the `"default_title"` string (both version numbers in the title)                      |
   | `oj-sync/README.md`     | `**Version X.Y.Z**` and `**CP Helper X.Y.Z**` on the first line                                             |

4. **Add a CHANGELOG entry** at the top of the release list in `CHANGELOG.md`, directly above the previous `## [X.Y.Z]` heading. Use today's date (YYYY-MM-DD). Infer the bullet points yourself from the git log and any changes made in the current session — do not ask the user. The user only provides the new version number.

   Format:

   ```
   ## [NEW_VERSION] - YYYY-MM-DD

   ### Changed
   - <inferred from git log / session changes>

   ```

5. **Confirm** by listing every file changed and the old → new version strings that were replaced.

Do not commit, tag, or push anything — only edit the files.
