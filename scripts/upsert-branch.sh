#!/usr/bin/env bash
# bash scripts/upsert-branch.sh v1

set -euo pipefail
cd "$(dirname "$0")/.."
branch="${1:-}"
[[ "$branch" =~ ^v[0-9]+$ ]] || { echo "usage: $0 v<number>" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree must be clean" >&2; exit 1; }
git fetch origin
if git show-ref --verify --quiet "refs/heads/$branch"; then
  git switch "$branch"
elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  git switch --track "origin/$branch"
else
  git switch -c "$branch"
fi
if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  git merge --ff-only "origin/$branch"
fi
git push --set-upstream origin "$branch"
