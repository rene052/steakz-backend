import type { Request } from "express";
import { z } from "zod";

/** Error carrying an HTTP status code; turned into a JSON response by errorHandler. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Parse a positive integer route parameter such as :id. */
export function idParam(req: Request, name = "id"): number {
  const raw = req.params[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`Invalid ${name}: ${raw}`);
  return id;
}

/** Validate a request body with a zod schema; throws 400 with readable messages. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw badRequest(msg);
  }
  return result.data;
}

export const money = (n: number) => Math.round(n * 100) / 100;

/** Start and end of a calendar day (server local time). */
export function dayRange(date: Date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Parse "YYYY-MM-DD" from a query string into a day range, or undefined. */
export function dayRangeFromQuery(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw badRequest("date must be in YYYY-MM-DD format");
  return dayRange(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export const STAFF_ROLES = ["CASHIER", "CHEF", "BRANCH_MANAGER"] as const;
export const ORDER_STATUSES = ["PENDING", "PREPARING", "DONE", "DELIVERED", "CANCELLED"] as const;
