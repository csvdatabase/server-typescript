# Releasing

```bash
bash scripts/upsert-branch.sh v1
bash scripts/release.sh 1.0.0 true # dry run
bash scripts/release.sh 1.0.0
```

Pass `true` as the second argument for a dry run; omit it to release.

Every release requires the matching major branch: all `1.x.x` releases use `v1`, all `2.x.x` releases use `v2`. The working tree must be clean and the tag must not exist. Dry runs validate these rules and print commands without changes. Real releases install dependencies, update the version, run checks, commit, push the branch and tag atomically, and create a GitHub release. The release workflow validates the branch and tag again before publishing.

The central `csdb` checkout runs the same scripts with the following commands; it adds no version restrictions:

```bash
bash scripts/release-all.sh 1.0.0 true # dry run
bash scripts/release-all.sh 1.0.0
```

Upsert switches to an existing branch (fast-forwarding from origin), or creates it from HEAD, and pushes it. It never resets existing history.

## First Release Setup

After the first workflow publishes the package, open its settings in the `csvdatabase` organization and make the container package public. Public GHCR images can be pulled without authentication.

Verify anonymous access and startup from a logged-out Docker client before announcing the release:

```bash
docker pull ghcr.io/csvdatabase/server-typescript:0.1.0
docker compose pull
docker compose up -d --wait
```

Do not move or overwrite exact version tags after publication.
