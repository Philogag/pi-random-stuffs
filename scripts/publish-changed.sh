#!/usr/bin/env bash
# Incrementally publish packages whose version is not yet on the npm registry.
# A package is published only when its package.json version differs from the
# version already published on npm (i.e. version bump happened).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

failures=0

for pkg_json in packages/*/package.json; do
  name=$(node -p "require('./$pkg_json').name")
  version=$(node -p "require('./$pkg_json').version")

  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "skip:   $name@$version (already published)"
  else
    echo "publish: $name@$version"
    if ! (cd "$(dirname "$pkg_json")" && pnpm publish --no-git-checks --access public); then
      echo "error:  failed to publish $name@$version"
      failures=1
    fi
  fi
done

exit "$failures"
