# Quality Gate Review

Reviewed against the eight areas in `quality_gate.md`. Verification was performed against the local Worker at `http://localhost:8787/api` using local D1 only; no remote migration or deployment was performed.

| Quality Gate area | Finding | Action taken | Evidence |
|---|---|---|---|
| Reliability / Accuracy | Validation selected 400 versus 409 by checking whether an error message began with a particular phrase. A wording change could silently change the HTTP status. | Changed booking validation to return a typed status (`400` or `409`) together with the error text, and handlers now use the explicit status. | `npm.cmd run typecheck` passed. HTTP tests still return 400 for invalid times/unknown equipment and 409 for overlapping create/update requests. |
| Reliability / Execution Value | Malformed JSON was caught and treated like any other non-object body, making the client response less specific and leaving this error path unverified. | Distinguished JSON parsing failure and return the contract's JSON error shape with status 400. Added a `curl.exe` case for malformed JSON. | Test returned `400 {"error":"Request body must contain valid JSON"}`; see `TEST_EVIDENCE.md`. |
| Reliability / Accuracy | Existing tests checked that a conflicting update is rejected, but did not demonstrate that a booking update does not conflict with that booking itself. | Added a PATCH case that updates a booking with its existing start time and expects success. Also added PATCH for an unknown ID. | The self-update returned 200; the missing booking update returned 404; the conflicting update returned 409. All are included in `TEST_EVIDENCE.md`. |
| Reasoning / You Own It | The implementation had status choices and an interval-overlap rule, but the README did not explain the rationale in a way that directly supports an ownership check. | Documented why 400, 404, and 409 differ and the overlap expression `existing.startAt < requested.endAt AND existing.endAt > requested.startAt`. | The rule and adjacent-booking assumption are now in `README.md`; adjacent interval test returns 201 while intersecting intervals return 409. The student must be able to explain this in their own words. |

## Checklist status

- **Purpose / Course Context:** The routes and stack match the brief (TypeScript/Hono with D1); no browser client was added, so CORS is not needed.
- **Reliability / Accuracy:** Create and update check equipment and time ranges; every tested error uses JSON `{ "error": "..." }`; query values use D1 `.bind(...)`.
- **Execution Value / Delivery Quality:** Local setup, contract, schema, AI log, and test evidence are documented. Type-check and all 16 HTTP assertions passed after these changes. The test suite also includes the guide's list-bookings case and verifies the newly created record appears in the collection.
- **You Own It:** The AI assistance is recorded. The student still needs to inspect and explain the route handling, bound SQL, overlap rule, status codes, and test output without relying on this review.

## Explanation notes for review

These notes summarize the implementation and are intended to help the student prepare an explanation. The student should verify them against the code and explain them in their own words before checking any personal-understanding boxes in `quality_gate.md`.

- **400 Bad Request:** The request is malformed or its data is invalid, such as invalid JSON, a missing/invalid field, an unknown equipment ID, or `startAt >= endAt`. The client must correct the request before retrying.
- **404 Not Found:** The requested booking ID does not exist (including GET, PATCH, or DELETE of a missing booking). The request cannot succeed for that resource.
- **409 Conflict:** The request is valid by itself, but its requested time conflicts with another booking for the same equipment.
- **Overlap rule:** Two half-open intervals overlap when `existing.startAt < requested.endAt AND existing.endAt > requested.startAt`. The strict comparisons mean that a booking ending at 11:00 and another starting at 11:00 are adjacent, not overlapping. For PATCH, the booking being updated is excluded from the conflict check so it does not conflict with itself. The write statement also includes the overlap condition to reduce the check-then-write race window.
- **SQL binding:** Request values are passed through D1 `.bind(...)` placeholders. They are not inserted into SQL text, which helps prevent SQL injection.
- **Scope and limitations:** The brief requires a REST API and curl/HTTP testing; it does not require a browser client, so CORS was not added. The deployed Worker has no authentication, so its write endpoints are publicly reachable. The booking conflict rule is enforced by API write statements, not by a standalone database exclusion constraint. Production GET/POST/PATCH/DELETE affect the Cloudflare D1 database.
- **Checkpoint evidence:** No pre-30-minute commit or screenshot was found in the project folder. The current review and current screenshots cannot be represented as that historical checkpoint. The instructor should be told this honestly, and any snapshot found elsewhere should be submitted with its actual provenance.

## Quality Gate Checklist

Working copy of the checklist from `quality_gate.md`. Evidence-based items are checked where verified. Personal understanding and ownership items remain unchecked for the student to confirm honestly.

### 1. Purpose

- [x] My API solves the stated equipment-booking problem.
- [x] My routes, request bodies, responses, and status codes match the common API contract.
- [ ] I have met the required deliverables and submission instructions.
- [x] I have not added unrelated features that reduce the time available for required work.

### 2. Reliability

- [x] My equipment data and booking data are saved and retrieved consistently.
- [x] Creating or updating a booking cannot create an overlap for the same equipment.
- [x] `equipmentId` is checked against existing equipment.
- [x] The API handles invalid requests without crashing.

### 3. Course Context

- [x] My work follows the instructor's task, the API contract, and the permitted technology stack.
- [ ] I understand which parts I implemented myself and which parts were assisted by AI or other permitted resources.
- [x] I used only permitted sources and recorded significant AI assistance in `AI_LOG.md`.
- [ ] I can identify the important files, routes, schema, and commands needed to run my work.

### 4. Reasoning

- [x] I can explain why I selected each important status code, especially `400`, `404`, and `409`.
- [x] I can explain how my overlap check works for both create and update operations.
- [ ] I can distinguish required behaviour from optional design choices.
- [x] I can explain any limitations or assumptions in my implementation.

### 5. Execution Value

- [x] The API can be run by following the instructions in `README.md`.
- [x] The equipment endpoint and all required booking CRUD endpoints work.
- [x] I tested the API with `curl` or another HTTP client and recorded the results.
- [x] I have focused effort on the required API, validation, testing, and documentation.

### 6. Accuracy

- [x] Booking fields, dates, IDs, and responses contain the correct values.
- [x] I validate that `startAt` is before `endAt`.
- [x] Every error response uses JSON in the required `{ "error": "..." }` format.
- [x] I use SQL/D1 parameter binding and do not concatenate request data into SQL statements.

### 7. Delivery Quality

- [x] My source code is runnable and my README includes clear run instructions.
- [x] My API contract and brief schema/ERD are included.
- [x] I have included any CORS configuration only if I chose to use a browser-based client.
- [x] I have evidence for at least five test cases, including successful requests and error cases.
- [ ] My files are named clearly and are complete enough for marking.

### 8. You Own It

- [ ] I can explain every important route, validation rule, database query, and test result in my own words.
- [x] My `AI_LOG.md` truthfully records important prompts, what I used, and how I checked it.
- [ ] I can explain what I changed after the Quality Gate review and why.
- [ ] I am ready to answer follow-up questions about my design and implementation.
