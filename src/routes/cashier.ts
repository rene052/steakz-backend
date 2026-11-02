import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireBranch, requireRole, verifyToken } from "../middleware/auth";
import { badRequest, dayRange, forbidden, idParam, notFound, ORDER_STATUSES, parseBody } from "../utils/http";
import { orderInclude, orderItemsSchema, priceOrderItems } from "../utils/orders";

const router = Router();

// The cashier also acts as the waiter: takes orders at the table and delivers the food.
router.use(verifyToken, requireRole(["CASHIER"]), requireBranch);

const createSchema = z
  .object({
    tableId: z.coerce.number().int().positive().optional(),
    bookingId: z.coerce.number().int().positive().optional(),
    items: orderItemsSchema,
  })
  .refine((b) => b.tableId || b.bookingId, { message: "Choose a table (walk-in) or a booking" });

// POST /api/cashier/orders — create an order for a table and send it to the kitchen (PENDING).
router.post("/orders", async (req, res) => {
  const { tableId, bookingId, items } = parseBody(createSchema, req.body);
  const branchId = req.branchId!;

  let customerId: number | null = null;
  let finalTableId: number;

  if (bookingId) {
    // Serving a customer who booked: link the order to their booking and account.
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { table: true } });
    if (!booking) throw notFound("Booking not found");
    if (booking.table.branchId !== branchId) throw forbidden("This booking belongs to another branch");
    if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
      throw badRequest(`Cannot order on a ${booking.status.toLowerCase()} booking`);
    }
    if (tableId && tableId !== booking.tableId) throw badRequest("tableId does not match the booking's table");
    customerId = booking.customerId;
    finalTableId = booking.tableId;
  } else {
    // Walk-in customer: just a table in this branch.
    const table = await prisma.table.findUnique({ where: { id: tableId! } });
    if (!table) throw notFound("Table not found");
    if (table.branchId !== branchId) throw forbidden("This table belongs to another branch");
    finalTableId = table.id;
  }

  const { lines, total } = await priceOrderItems(branchId, items);

  const order = await prisma.$transaction(async (tx) => {
    // The guest is now seated, so a pending booking becomes CONFIRMED.
    if (bookingId) {
      await tx.booking.updateMany({ where: { id: bookingId, status: "PENDING" }, data: { status: "CONFIRMED" } });
    }
    return tx.order.create({
      data: { branchId, customerId, bookingId: bookingId ?? null, tableId: finalTableId, total, items: { create: lines } },
      include: orderInclude,
    });
  });
  res.status(201).json(order);
});

// GET /api/cashier/orders — all orders of the cashier's branch (optional ?status=DONE).
router.get("/orders", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  if (status && !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
    throw badRequest(`status must be one of ${ORDER_STATUSES.join(", ")}`);
  }
  const orders = await prisma.order.findMany({
    where: { branchId: req.branchId, ...(status ? { status: status as (typeof ORDER_STATUSES)[number] } : {}) },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(orders);
});

// PATCH /api/cashier/orders/:id/deliver — food served at the table: DONE → DELIVERED.
router.patch("/orders/:id/deliver", async (req, res) => {
  const id = idParam(req);
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound("Order not found");
  if (order.branchId !== req.branchId) throw forbidden("This order belongs to another branch");
  if (order.status !== "DONE") {
    throw badRequest(`Only orders marked DONE by the kitchen can be delivered (this one is ${order.status})`);
  }
  const updated = await prisma.order.update({ where: { id }, data: { status: "DELIVERED" }, include: orderInclude });
  res.json(updated);
});

// GET /api/cashier/bookings — today's active bookings at the branch, so the cashier can
// link an order to a customer who booked. (Helper endpoint added for the cashier screen.)
router.get("/bookings", async (req, res) => {
  const { start, end } = dayRange();
  const bookings = await prisma.booking.findMany({
    where: {
      table: { branchId: req.branchId },
      status: { in: ["PENDING", "CONFIRMED"] },
      date: { gte: start, lt: end },
    },
    include: {
      table: { select: { id: true, tableNumber: true, capacity: true } },
      customer: { select: { id: true, name: true } },
    },
    orderBy: { date: "asc" },
  });
  res.json(bookings);
});

export default router;
