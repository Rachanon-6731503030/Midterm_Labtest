# Campus Equipment Booking API

TypeScript/Hono REST API backed by Cloudflare D1 for reserving campus equipment.

## Prerequisites

- Node.js 20.0.0 or later
- npm
- A Cloudflare account for remote D1 use; local development does not need a deployed Worker

## Run locally

```powershell
npm.cmd install
npm.cmd run db:migrate:local
npm.cmd run dev
```

Wrangler serves the API at `http://localhost:8787`. Local migration creates two equipment rows (`eq-1` and `eq-2`) in the local D1 database. It does not change the remote database.

## Remote D1

The `DB` binding in `wrangler.jsonc` points to the `campus-equipment-booking` database. Apply migrations to it and deploy with:

```powershell
npm.cmd run db:migrate:remote
npm.cmd run deploy
```

Remote commands change Cloudflare resources. Run them only when you intend to modify/deploy the remote database and Worker.

Deployed Worker URL: `https://campus-equipment-booking-api.6731503030.workers.dev`
Production API base URL: `https://campus-equipment-booking-api.6731503030.workers.dev/api`

The first deployment was smoke-tested with `GET /api/equipment` and `GET /api/bookings`; both returned HTTP 200. The remote bookings table was empty at that time. Use the local API for repeatable CRUD tests unless you specifically intend to create or change production bookings.

## API contract

Base URL: `http://localhost:8787/api`

| Method | Path | Success | Meaning |
|---|---|---:|---|
| GET | `/equipment` | 200 | List equipment |
| GET | `/bookings` | 200 | List bookings |
| GET | `/bookings/:id` | 200 | Get one booking |
| POST | `/bookings` | 201 | Create a booking |
| PATCH | `/bookings/:id` | 200 | Update provided fields |
| DELETE | `/bookings/:id` | 204 | Delete a booking |

Create and update fields use camelCase:

```json
{
  "equipmentId": "eq-1",
  "borrowerName": "Somchai Jaidee",
  "startAt": "2026-10-20T09:00:00.000Z",
  "endAt": "2026-10-20T11:00:00.000Z",
  "purpose": "Class presentation"
}
```

All errors return JSON in the form `{"error":"..."}`. Invalid or missing fields and unknown equipment return 400; a missing booking returns 404; an overlapping booking for the same equipment returns 409. Time intervals are half-open: a booking ending exactly when another starts does not overlap. Date-times must be ISO 8601 values with a timezone, and are stored normalized to UTC.

`400` means the request data is invalid, `404` means the requested booking does not exist, and `409` means valid booking data conflicts with the current schedule. The overlap rule is `existing.startAt < requested.endAt AND existing.endAt > requested.startAt`; this permits adjacent bookings while rejecting any shared time.

## Data model

```text
equipment(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL
)
       1
       |
       | equipment.id = bookings.equipment_id
       *
bookings(
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id),
  borrower_name TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  purpose TEXT NOT NULL,
  CHECK (start_at < end_at)
)
```

The booking table index supports equipment/time conflict lookups. Create and update use parameterized SQL statements that perform the overlap check as part of the write, avoiding a check-then-write race. Request values are always passed through D1 `.bind(...)`; they are not interpolated into SQL.

## Verify

```powershell
npm.cmd run typecheck
npm.cmd run dev
```

In a second terminal, run the repeatable HTTP cases:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-api.ps1
```

The process-scoped execution-policy bypass in this command does not change the machine's policy. The script uses `curl.exe` and checks equipment listing, booking create/read/update/delete, overlap rejection, invalid time order, and not-found handling.

Basic manual requests:

```powershell
curl.exe -i http://localhost:8787/api/equipment
curl.exe -i http://localhost:8787/api/bookings
```

Use the test payload from the task brief to test create/read/update/delete, then try an invalid equipment ID, an end time before the start, an overlapping booking, and an unknown booking ID. Record the actual responses in the required test evidence.

## Assessment records

- `AI_LOG.md` records AI assistance and verification.
- `TEST_EVIDENCE.md` records the local HTTP test results.
- `QUALITY_GATE_REVIEW.md` should be completed after receiving the instructor's Quality Gate checklist and after the first-version checkpoint, with at least three findings, fixes, and evidence.
