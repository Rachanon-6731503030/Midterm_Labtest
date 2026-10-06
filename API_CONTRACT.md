# API Contract

Base URL: `http://localhost:8787/api`

## Equipment

`GET /equipment` returns `200` and an array of `{ "id", "name", "location" }` objects.

## Bookings

| Method | Path | Success | Response |
|---|---|---:|---|
| GET | `/bookings` | 200 | Array of bookings |
| GET | `/bookings/:id` | 200 | One booking |
| POST | `/bookings` | 201 | Created booking |
| PATCH | `/bookings/:id` | 200 | Updated booking |
| DELETE | `/bookings/:id` | 204 | Empty body |

Booking fields: `id`, `equipmentId`, `borrowerName`, `startAt`, `endAt`, `purpose`. POST requires all fields except generated `id`; PATCH requires at least one mutable field. Unknown fields are rejected.

## Rules and errors

- `equipmentId` must identify existing equipment.
- `startAt` and `endAt` must be ISO 8601 date-times with an explicit timezone; start must precede end.
- Two bookings for the same equipment conflict when `existing.startAt < requested.endAt` and `existing.endAt > requested.startAt`. Adjacent intervals do not conflict.
- `400`: missing/invalid input, malformed JSON, or unknown equipment.
- `404`: booking or route not found.
- `409`: equipment booking time conflict.
- Every error body is `{ "error": "..." }`.
