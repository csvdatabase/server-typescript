# CSDB TypeScript Server

> **Start here:** Project-wide information, planning, and community resources
> live in the [main CSDB repository](https://github.com/csvdatabase/csdb).

## Introduction

This repository contains the Docker-deployable HTTP server for `.csdb` databases.
It exposes the TypeScript library through a JSON command API and atomically saves
successful mutations to disk.

## Use

Docker Engine with Docker Compose v2 is required. Create the configuration and a
writable data directory, then pull and start the published image:

```bash
cp .env.example .env
mkdir -p data
cp examples/payroll.csdb data/payroll.csdb
docker compose pull
docker compose up -d --wait
```

The default address is `http://127.0.0.1:3000`.

```bash
curl http://127.0.0.1:3000/health
```

- `GET /health` checks container health.
- `POST /v1/commands` runs a JSON command against a named database.

Set a long random `CSDB_API_KEY` before exposing the server beyond localhost.

## Updating

Back up the data directory, then pull the configured image tag and recreate the
container:

```bash
tar -czf csdb-data-backup.tgz -C data .
docker compose pull
docker compose up -d --remove-orphans --wait
docker compose ps
```

`CSDB_VERSION=latest` follows stable releases. Use a minor tag such as `0.1` for
patch-only updates, or an exact tag such as `0.1.0` for repeatable deployments.
The bind-mounted data directory remains in place when the container is replaced.

## Rollback

Set `CSDB_VERSION` in `.env` to the previous exact version, then run:

```bash
docker compose pull
docker compose up -d --remove-orphans --wait
```

Restore the pre-update backup if the newer server changed data in a way the older
version cannot read.

## Production Notes

- Keep the default localhost binding unless a trusted reverse proxy provides TLS,
  access control, and request-rate limits.
- Run one server container per writable data directory. Locking is process-local.
- Ensure `CSDB_UID` and `CSDB_GID` can read and write `CSDB_DATA_PATH`.
- Back up `.csdb` files regularly and before every version change.
- Container logs are JSON and rotate according to the values in `.env`.

## Development

Run the local checks with Node.js 20.12 or newer:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Build and run the current source with the Compose override:

```bash
docker compose -f compose.yaml -f compose.build.yaml up --build -d --wait
```

See [RELEASING.md](RELEASING.md) for the image publishing process.
