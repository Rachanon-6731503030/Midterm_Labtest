# HTTP Test Evidence

Local test Base API URL: `http://localhost:8787/api`
Environment: local Cloudflare Worker (`wrangler dev`) with local D1 migration `0001_initial_schema.sql` applied.
Command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-api.ps1`

The script uses `curl.exe`. All cases below passed:

| Case | Expected | Actual |
|---|---:|---|
| List seeded equipment | 200 | 200; returned `eq-1` (Projector A) and `eq-2` (Camera A) |
| Create booking | 201 | 201; returned booking ID `e48a6efe-1053-43ae-b23c-50f79342a2eb` |
| List bookings | 200 | 200; response included the newly created booking |
| Create adjacent, non-overlapping booking | 201 | 201 |
| Read booking by ID | 200 | 200; returned the created booking |
| Update booking without changing its interval | 200 | 200; own booking was excluded from overlap detection |
| Create overlapping booking | 409 | 409; `{"error":"The equipment is already booked for an overlapping time"}` |
| Update booking into a conflict | 409 | 409; `{"error":"The equipment is already booked for an overlapping time"}` |
| Submit end time before start time | 400 | 400; `{"error":"startAt must be before endAt"}` |
| Submit an unknown equipment ID | 400 | 400; equipment validation rejected the request |
| Submit malformed JSON | 400 | 400; `{"error":"Request body must contain valid JSON"}` |
| Update booking purpose | 200 | 200; returned updated purpose |
| Delete both test bookings | 204 | 204 for each |
| Read an unknown booking ID | 404 | 404; `{"error":"Booking not found"}` |
| Update an unknown booking ID | 404 | 404; `{"error":"Booking not found"}` |

All 16 HTTP assertions passed, and `npm.cmd run typecheck` passed after the Quality Gate changes. The test script removes the created records on completion. These results are from the local database only and do not demonstrate a remote deployment.

## Cloudflare deployment smoke test

Deployed API base URL: `https://campus-equipment-booking-api.6731503030.workers.dev/api`

| Request | Expected | Actual |
|---|---:|---|
| `GET /equipment` | 200 | 200; returned seeded equipment `eq-1` and `eq-2` |
| `GET /bookings` | 200 | 200; returned `[]` |

The remote D1 migration and Worker deployment completed successfully. A production POST attempt with the sample time range returned 409 because it overlapped an existing booking. The matching test booking was identified with GET, deleted after user confirmation (204), and verified absent with a subsequent GET (200, `[]`). The POST attempt did not create a booking; no remote update was run.
