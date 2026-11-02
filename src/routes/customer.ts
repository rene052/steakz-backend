import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRole, verifyToken } from "../middleware/auth";
import { badRequest, conflict, forbidden, idParam, notFound, parseBody } from "../utils/http";
import { BOOKING_WINDOW_MS, orderInclude, orderItemsSchema, priceOrderItems } from "../utils/orders";

const router = Router();

// Every customer route: valid token + CUSTOMER role (guests get 401, staff get 403).
router.use(verifyToken, requireRole(["CUSTOMER"]));

const bookingInclude = {
  table: {
    select: {
      id: true,
      tableNumber: true,
      capacity: true,
      branch: { select: { id: true, name: true, address: true } },
    },
  },
  orders: { select: { id: true, status: true, total: true } },
} as const;

// GET /api/customer/bookings — my own bookings, upcoming first.
router.get("/bookings", async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { customerId: req.user!.id },
    include: bookingInclude,
    orderBy: { date: "desc" },
  });
  res.json(bookings);
});

const bookingSchema = z.object({
  tableId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive().optional(),
  guestCount: z.coerce.number().int().min(1, "At least 1 guest").max(20),
  date: z.coerce.date({ error: "date must be a valid date-time" }),
});

// POST /api/customer/bookings — book a table at a branch (status starts as PENDING).
router.post("/bookings", async (req, res) => {
  const { tableId, branchId, guestCount, date } = parseBody(bookingSchema, req.body);

  if (Number.isNaN(date.getTime())) throw badRequest("date must be a valid date-time");
  if (date.getTime() < Date.now() - 5 * 60 * 1000) throw badRequest("You cannot book a table in the past");

  const table = await prisma.table.findUnique({ where: { id: tableId }, include: { branch: true } });
  if (!table || !table.branch.isActive) throw notFound("Table not found");
  if (branchId && table.branchId !== branchId) throw badRequest("This table is not in the selected branch");
  if (!table.isAvailable) throw badRequest(`Table ${table.tableNumber} is not available for booking`);
  if (guestCount > table.capacity) {
    throw badRequest(`Table ${table.tableNumber} seats at most ${table.capacity} guests`);
  }

  const clash = await prisma.booking.findFirst({
    where: {
      tableId,
      status: { in: ["PENDING", "CONFIRMED"] },
      date: {
        gt: new Date(date.getTime() - BOOKING_WINDOW_MS),
        lt: new Date(date.getTime() + BOOKING_WINDOW_MS),
      },
    },
  });
  if (clash) throw conflict(`Table ${table.tableNumber} is already booked around that time`);

  const booking = await prisma.booking.create({
    data: { customerId: req.user!.id, tableId, guestCount, date },
    include: bookingInclude,
  });
  res.status(201).json(booking);
});

// DELETE /api/customer/bookings/:id — cancel MY booking (kept in history as CANCELLED).
router.delete("/bookings/:id", async (req, res) => {
  const id = idParam(req);
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw notFound("Booking not found");
  if (booking.customerId !== req.user!.id) throw forbidden("You can only cancel your own bookings");
  if (booking.status === "CANCELLED") throw badRequest("This booking is already cancelled");
  if (booking.status === "COMPLETED") throw badRequest("A completed booking cannot be cancelled");

  const active = await prisma.order.count({
    where: { bookingId: id, status: { in: ["PREPARING", "DONE", "DELIVERED"] } },
  });
  if (active > 0) throw badRequest("Food for this booking is already being prepared — it can't be cancelled now");

  const updated = await prisma.$transaction(async (tx) => {
    // Orders still waiting in the queue are cancelled together with the booking.
    await tx.order.updateMany({ where: { bookingId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
    return tx.booking.update({ where: { id }, data: { status: "CANCELLED" }, include: bookingInclude });
  });
  res.json(updated);
});

// GET /api/customer/orders — my orders with live status.
router.get("/orders", async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.user!.id },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

const orderSchema = z.object({
  bookingId: z.coerce.number().int().positive({ message: "bookingId is required" }),
  items: orderItemsSchema,
});

// POST /api/customer/orders — place an order linked to one of MY active bookings.
router.post("/orders", async (req, res) => {
  const { bookingId, items } = parseBody(orderSchema, req.body);

  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { table: true } });
  if (!booking) throw notFound("Booking not found");
  if (booking.customerId !== req.user!.id) throw forbidden("You can only order on your own bookings");
  if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
    throw badRequest(`Cannot order on a ${booking.status.toLowerCase()} booking`);
  }

  const branchId = booking.table.branchId;
  const { lines, total } = await priceOrderItems(branchId, items);

  const order = await prisma.order.create({
    data: {
      customerId: req.user!.id,
      bookingId,
      branchId,
      tableId: booking.tableId,
      total,
      items: { create: lines },
    },
    include: orderInclude,
  });
  res.status(201).json(order);
});

export default router;
