#!/usr/bin/env bash
# One-command release for pi-ultra-messenger.
#
# 1. standard-version bumps the version, updates the CHANGELOG, commits, and
#    tags (conventional commits → correct bump level).
# 2. Push main + the new tag.
# 3. The GitHub Actions `Release` workflow builds, tests, and publishes to
#    npm automatically (using the NPM_TOKEN secret). The `Sync master`
#    workflow mirrors main to master.
#
# Requires: a clean working tree on main, and NPM_TOKEN configured as a
# repo secret (for the publish step, which runs in CI).

set -euo pipefail

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  exit 1
fi

echo "Running standard-version (bump version + CHANGELOG + commit + tag)..."
npm run release

echo "Pushing main with tags..."
git push --follow-tags origin main

echo ""
echo "Done. The Release workflow will build, test, and publish to npm."
echo "The Sync master workflow will mirror main to master."
echo "Watch: https://github.com/$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/]+)(\.git)?#\1#')/actions"
