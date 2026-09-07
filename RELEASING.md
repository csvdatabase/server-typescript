# Releasing the CSDB Server

Run releases from this repository only:

```bash
make release version=1.1.1
```

The target updates `package.json` and `package-lock.json`, runs local Node checks,
commits the version bump, pushes the branch and tag, and creates a GitHub
Release.

Published GitHub Releases trigger `.github/workflows/release-image.yml`, which
verifies the tag, reruns checks, builds multi-architecture images, and publishes
them to `ghcr.io/csvdatabase/server-typescript`.

Major releases use `x.0.0` and must be cut from a matching major branch. For
example, `make release version=1.0.0` must be run from branch `v1`.

Published image tags include:

- `x.y.z` for an immutable release selection
- `x.y` for the newest patch in that minor line
- `latest` for the newest stable release

After the first workflow publishes the package, open its settings in the
`csvdatabase` organization and make the container package public. Public GHCR
images can be pulled without authentication.
