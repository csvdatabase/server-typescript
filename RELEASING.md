# Releasing the CSDB Server

Stable GitHub Releases publish multi-architecture images to
`ghcr.io/csvdatabase/server-typescript`.

## Release Process

1. Update `package.json` and `package-lock.json` to the release version.
2. Refresh the vendored CSDB package when the library changes.
3. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`,
   `npm audit --omit=dev`, and a Docker build.
4. Merge the release-ready commit to `main` and confirm CI passes.
5. Create and publish a GitHub Release whose tag exactly matches the package
   version, such as `v0.1.0`.

The release workflow verifies the version, reruns the checks, builds
`linux/amd64` and `linux/arm64`, and publishes these tags:

- `0.1.0` for an immutable release selection
- `0.1` for the newest patch in that minor line
- `latest` for the newest stable release

Published images include OCI source metadata, provenance, and an SBOM.

## First Release Setup

After the first workflow publishes the package, open its settings in the
`csvdatabase` organization and make the container package public. Public GHCR
images can be pulled without authentication.

Verify anonymous access and startup from a logged-out Docker client before
announcing the release:

```bash
docker pull ghcr.io/csvdatabase/server-typescript:0.1.0
docker compose pull
docker compose up -d --wait
```

Do not move or overwrite exact version tags after publication.
