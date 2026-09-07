SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help release verify-release-version verify-major-branch verify-clean-tree require-gh

version ?=

help:
	@echo "Release commands"
	@echo ""
	@echo "  make release version=1.1.1"

verify-release-version:
	@test -n "$(version)" || { echo "usage: make release version=1.1.1"; exit 1; }
	@if [[ ! "$(version)" =~ ^[0-9]+\.[0-9]+\.[0-9]+$$ ]]; then \
		echo "version must be semver like 1.1.1"; \
		exit 1; \
	fi

verify-major-branch: verify-release-version
	@if [[ "$(version)" =~ ^([0-9]+)\.0\.0$$ ]]; then \
		expected="v$${BASH_REMATCH[1]}"; \
		current="$$(git branch --show-current)"; \
		if [[ "$$current" != "$$expected" ]]; then \
			echo "major release $(version) must be cut from branch $$expected; current branch is $$current"; \
			exit 1; \
		fi; \
	fi

verify-clean-tree:
	@if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$$(git ls-files --others --exclude-standard)" ]]; then \
		echo "working tree must be clean before running make release"; \
		exit 1; \
	fi

require-gh:
	@command -v gh >/dev/null 2>&1 || { echo "gh is required to create the GitHub release"; exit 1; }

release: verify-release-version verify-major-branch require-gh verify-clean-tree
	npm version "$(version)" --no-git-tag-version
	npm install --package-lock-only --ignore-scripts
	npm run typecheck
	npm test
	npm run build
	npm audit --omit=dev
	git add package.json package-lock.json
	git commit -m "chore: release v$(version)"
	git tag -a "v$(version)" -m "v$(version)"
	git push origin HEAD
	git push origin "v$(version)"
	gh release create "v$(version)" --target "$$(git branch --show-current)" --title "v$(version)" --notes "Release v$(version)"
