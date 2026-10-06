import { Hono } from "hono";
import type { Context } from "hono";

interface Bindings {
  DB: D1Database;
}

interface BookingInput {
  equipmentId: string;
  borrowerName: string;
  startAt: string;
  endAt: string;
  purpose: string;
}

interface BookingRow {
  id: string;
  equipment_id: string;
  borrower_name: string;
  start_at: string;
  end_at: string;
  purpose: string;
}

interface EquipmentRow {
  id: string;
  name: string;
  location: string;
}

type ParseResult =
  | { ok: true; value: Partial<BookingInput> }
  | { ok: false; error: string };

type JsonBodyResult = { ok: true; value: unknown } | { ok: false };
type BookingValidationError = {
  status: 400 | 409;
  error: string;
};

type AppContext = Context<{ Bindings: Bindings }>;
type FieldResult = { ok: true; value: string } | { ok: false; error: string };

const app = new Hono<{ Bindings: Bindings }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(
  value: unknown,
  field: string,
  maximumLength: number
): FieldResult {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: `${field} is required` };
  }
  if (trimmed.length > maximumLength) {
    return {
      ok: false,
      error: `${field} must be at most ${maximumLength} characters`
    };
  }
  return { ok: true, value: trimmed };
}

function normalizedDateTime(value: unknown, field: string): FieldResult {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return {
      ok: false,
      error: `${field} must be an ISO 8601 date-time with a timezone`
    };
  }

  const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return { ok: false, error: `${field} must be a valid date-time` };
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, error: `${field} must be a valid date-time` };
  }
  return { ok: true, value: new Date(timestamp).toISOString() };
}

function parseBookingPayload(value: unknown, requireAll: boolean): ParseResult {
  if (!isRecord(value)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const allowedFields = new Set([
    "equipmentId",
    "borrowerName",
    "startAt",
    "endAt",
    "purpose"
  ]);
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      return { ok: false, error: `Unknown field: ${field}` };
    }
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: "Request body must include at least one field" };
  }

  if (requireAll) {
    for (const field of allowedFields) {
      if (!(field in value)) {
        return { ok: false, error: `${field} is required` };
      }
    }
  }

  const parsed: Partial<BookingInput> = {};
  if ("equipmentId" in value) {
    const result = nonEmptyString(value.equipmentId, "equipmentId", 64);
    if (!result.ok) return result;
    parsed.equipmentId = result.value;
  }
  if ("borrowerName" in value) {
    const result = nonEmptyString(value.borrowerName, "borrowerName", 120);
    if (!result.ok) return result;
    parsed.borrowerName = result.value;
  }
  if ("startAt" in value) {
    const result = normalizedDateTime(value.startAt, "startAt");
    if (!result.ok) return result;
    parsed.startAt = result.value;
  }
  if ("endAt" in value) {
    const result = normalizedDateTime(value.endAt, "endAt");
    if (!result.ok) return result;
    parsed.endAt = result.value;
  }
  if ("purpose" in value) {
    const result = nonEmptyString(value.purpose, "purpose", 500);
    if (!result.ok) return result;
    parsed.purpose = result.value;
  }

  return { ok: true, value: parsed };
}

function toBooking(row: BookingRow): BookingInput & { id: string } {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    borrowerName: row.borrower_name,
    startAt: row.start_at,
    endAt: row.end_at,
    purpose: row.purpose
  };
}

async function readJsonBody(c: AppContext): Promise<JsonBodyResult> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

async function equipmentExists(db: D1Database, equipmentId: string): Promise<boolean> {
  const equipment = await db
    .prepare("SELECT id FROM equipment WHERE id = ?")
    .bind(equipmentId)
    .first<{ id: string }>();
  return equipment !== null;
}

async function hasTimeConflict(
  db: D1Database,
  input: BookingInput,
  excludeId?: string
): Promise<boolean> {
  const query = excludeId
    ? db
        .prepare(
          "SELECT id FROM bookings WHERE equipment_id = ? AND start_at < ? AND end_at > ? AND id <> ? LIMIT 1"
        )
        .bind(input.equipmentId, input.endAt, input.startAt, excludeId)
    : db
        .prepare(
          "SELECT id FROM bookings WHERE equipment_id = ? AND start_at < ? AND end_at > ? LIMIT 1"
        )
        .bind(input.equipmentId, input.endAt, input.startAt);
  const conflict = await query.first<{ id: string }>();
  return conflict !== null;
}

async function validateBooking(
  db: D1Database,
  input: BookingInput,
  excludeId?: string
): Promise<BookingValidationError | null> {
  if (Date.parse(input.startAt) >= Date.parse(input.endAt)) {
    return { status: 400, error: "startAt must be before endAt" };
  }
  if (!(await equipmentExists(db, input.equipmentId))) {
    return {
      status: 400,
      error: "equipmentId does not identify existing equipment"
    };
  }
  if (await hasTimeConflict(db, input, excludeId)) {
    return {
      status: 409,
      error: "The equipment is already booked for an overlapping time"
    };
  }
  return null;
}

function completeBooking(value: Partial<BookingInput>): BookingInput | null {
  if (
    !value.equipmentId ||
    !value.borrowerName ||
    !value.startAt ||
    !value.endAt ||
    !value.purpose
  ) {
    return null;
  }
  return {
    equipmentId: value.equipmentId,
    borrowerName: value.borrowerName,
    startAt: value.startAt,
    endAt: value.endAt,
    purpose: value.purpose
  };
}

app.get("/api/equipment", async (c) => {
  const result = await c.env.DB
    .prepare("SELECT id, name, location FROM equipment ORDER BY id")
    .all<EquipmentRow>();
  return c.json(result.results);
});

app.get("/api/bookings", async (c) => {
  const result = await c.env.DB
    .prepare(
      "SELECT id, equipment_id, borrower_name, start_at, end_at, purpose FROM bookings ORDER BY start_at, id"
    )
    .all<BookingRow>();
  return c.json(result.results.map(toBooking));
});

app.get("/api/bookings/:id", async (c) => {
  const row = await c.env.DB
    .prepare(
      "SELECT id, equipment_id, borrower_name, start_at, end_at, purpose FROM bookings WHERE id = ?"
    )
    .bind(c.req.param("id"))
    .first<BookingRow>();
  if (!row) return c.json({ error: "Booking not found" }, 404);
  return c.json(toBooking(row));
});

app.post("/api/bookings", async (c) => {
  const body = await readJsonBody(c);
  if (!body.ok) {
    return c.json({ error: "Request body must contain valid JSON" }, 400);
  }
  const parsed = parseBookingPayload(body.value, true);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const input = completeBooking(parsed.value);
  if (!input) return c.json({ error: "All booking fields are required" }, 400);
  const validationError = await validateBooking(c.env.DB, input);
  if (validationError) {
    return c.json({ error: validationError.error }, validationError.status);
  }

  const id = crypto.randomUUID();
  const result = await c.env.DB
    .prepare(
      "INSERT INTO bookings (id, equipment_id, borrower_name, start_at, end_at, purpose) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM bookings WHERE equipment_id = ? AND start_at < ? AND end_at > ?)"
    )
    .bind(
      id,
      input.equipmentId,
      input.borrowerName,
      input.startAt,
      input.endAt,
      input.purpose,
      input.equipmentId,
      input.endAt,
      input.startAt
    )
    .run();
  if (result.meta.changes === 0) {
    return c.json(
      { error: "The equipment is already booked for an overlapping time" },
      409
    );
  }

  return c.json({ id, ...input }, 201);
});

app.patch("/api/bookings/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB
    .prepare(
      "SELECT id, equipment_id, borrower_name, start_at, end_at, purpose FROM bookings WHERE id = ?"
    )
    .bind(id)
    .first<BookingRow>();
  if (!existing) return c.json({ error: "Booking not found" }, 404);

  const body = await readJsonBody(c);
  if (!body.ok) {
    return c.json({ error: "Request body must contain valid JSON" }, 400);
  }
  const parsed = parseBookingPayload(body.value, false);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const input: BookingInput = {
    equipmentId: parsed.value.equipmentId ?? existing.equipment_id,
    borrowerName: parsed.value.borrowerName ?? existing.borrower_name,
    startAt: parsed.value.startAt ?? existing.start_at,
    endAt: parsed.value.endAt ?? existing.end_at,
    purpose: parsed.value.purpose ?? existing.purpose
  };
  const validationError = await validateBooking(c.env.DB, input, id);
  if (validationError) {
    return c.json({ error: validationError.error }, validationError.status);
  }

  const result = await c.env.DB
    .prepare(
      "UPDATE bookings SET equipment_id = ?, borrower_name = ?, start_at = ?, end_at = ?, purpose = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM bookings WHERE equipment_id = ? AND start_at < ? AND end_at > ? AND id <> ?)"
    )
    .bind(
      input.equipmentId,
      input.borrowerName,
      input.startAt,
      input.endAt,
      input.purpose,
      id,
      input.equipmentId,
      input.endAt,
      input.startAt,
      id
    )
    .run();
  if (result.meta.changes === 0) {
    const stillExists = await c.env.DB
      .prepare("SELECT id FROM bookings WHERE id = ?")
      .bind(id)
      .first<{ id: string }>();
    if (!stillExists) return c.json({ error: "Booking not found" }, 404);
    return c.json(
      { error: "The equipment is already booked for an overlapping time" },
      409
    );
  }

  return c.json({ id, ...input });
});

app.delete("/api/bookings/:id", async (c) => {
  const result = await c.env.DB
    .prepare("DELETE FROM bookings WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  if (result.meta.changes === 0) {
    return c.json({ error: "Booking not found" }, 404);
  }
  return c.body(null, 204);
});

app.notFound((c) => c.json({ error: "Route not found" }, 404));
app.onError((error, c) => {
  console.error("Unhandled API error", error);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
