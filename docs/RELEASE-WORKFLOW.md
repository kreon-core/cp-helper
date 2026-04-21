# Release workflow

This project uses GitHub Actions to build and publish release artifacts for CP Helper and OJ Sync.

## What the workflow does

- Validates versions:
  - package.json version must match tag (vX.Y.Z).
  - oj-sync/manifest.json version must match package.json.
- Builds extension output with npm run compile.
- Builds VSIX with npm run vsix.
- Packages OJ Sync as oj-sync-X.Y.Z.zip.
- Generates SHA256SUMS.txt for both artifacts.
- Uploads artifacts to workflow run.
- Optionally publishes a GitHub Release and uploads artifacts.

Workflow file:

- .github/workflows/release.yml

## Trigger modes

1. Push tag (automatic release)

- Trigger: pushing tag vX.Y.Z.
- Behavior: builds and publishes GitHub Release automatically.

2. Manual dispatch

- Trigger: Actions tab -> Release -> Run workflow.
- Inputs:
  - tag: optional (default v<package.json version>)
  - create_tag: create and push the tag from workflow
  - publish_release: publish GitHub Release or build only
  - dry_run: Test mode—validate and build without creating tags or publishing releases

## Recommended release steps

1. Update version in package.json.
2. Update version in oj-sync/manifest.json.
3. Update CHANGELOG.md.
4. Commit and push to release branch.
5. Run workflow manually with:
   - create_tag: true
   - publish_release: true

## Pre-release testing

To test the build and validation without any side effects (no tags, no release), run the workflow manually with:

- dry_run: true

This validates versions, compiles code, builds the VSIX and zip, and uploads artifacts to the workflow run—but does not create tags or publish releases. Use this to catch issues before the actual release.

## Direct tag push

Alternatively, push a tag directly:

- git tag vX.Y.Z
- git push origin vX.Y.Z

## Artifacts

- cp-helper-X.Y.Z.vsix
- oj-sync-X.Y.Z.zip
- SHA256SUMS.txt
