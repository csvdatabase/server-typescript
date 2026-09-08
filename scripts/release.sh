#!/usr/bin/env bash
# bash scripts/release.sh 1.0.0 true # dry run
# bash scripts/release.sh 1.0.0

set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:-}"
dry="${2:-false}"
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Version must be semver, e.g. 1.0.0" >&2; exit 1; }
[[ "$dry" == true || "$dry" == false ]] || { echo "dry must be true or false" >&2; exit 1; }
expected="v${version%%.*}"
[[ "$(git branch --show-current)" == "$expected" ]] || { echo "Release $version requires branch $expected" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree must be clean" >&2; exit 1; }
if git show-ref --verify --quiet "refs/tags/v$version"; then
  echo "Tag v$version already exists" >&2; exit 1
fi
remote_tags=$(git ls-remote --tags origin "refs/tags/v$version")
[[ -z "$remote_tags" ]] || { echo "Remote tag v$version already exists" >&2; exit 1; }
run() {
  if [[ "$dry" == true ]]; then printf '[dry] '; printf '%q ' "$@"; printf '\n'; else "$@"; fi
}
if [[ "$dry" == false ]]; then command -v gh >/dev/null; gh auth status; fi
run npm ci
run npm version "$version" --no-git-tag-version --ignore-scripts --allow-same-version
run npm run typecheck
run npm test
run npm run build
run npm audit --omit=dev
run docker build -t "csdb-server-check:$version" .
run git add package.json package-lock.json
# A version prepared in advance can already be committed.
if [[ "$dry" == true ]] || ! git diff --cached --quiet; then
  run git commit -m "chore: release v$version"
fi
run git tag -a "v$version" -m "v$version"
run git push --atomic origin "HEAD:refs/heads/$expected" "refs/tags/v$version"
run gh release create "v$version" --verify-tag --target "$expected" --title "v$version" --notes "Release v$version"
