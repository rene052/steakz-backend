import { Router } from "express";
import { prisma } from "../lib/prisma";
import { badRequest, idParam, notFound } from "../utils/http";
import { BOOKING_WINDOW_MS } from "../utils/orders";

const router = Router();

// GET /api/public/branches — all active branches (no login required).
router.get("/branches", async (_req, res) => {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      _count: { select: { tables: true, menuItems: true } },
    },
  });
  res.json(branches);
});

/**
 * GET /api/public/branches/:id — one branch with its tables and menu.
 * Optional ?at=<ISO date-time>: each table gets `isBooked` for a reservation at that time,
 * so the booking form can show which tables are free (no customer data is exposed).
 */
router.get("/branches/:id", async (req, res) => {
  const id = idParam(req);
  const branch = await prisma.branch.findFirst({
    where: { id, isActive: true },
    include: {
      tables: { orderBy: { tableNumber: "asc" } },
      menuItems: { orderBy: [{ category: "asc" }, { name: "asc" }] },
    },
  });
  if (!branch) throw notFound("Branch not found");

  let bookedTableIds = new Set<number>();
  if (typeof req.query.at === "string" && req.query.at) {
    const at = new Date(req.query.at);
    if (Number.isNaN(at.getTime())) throw badRequest("at must be a valid date-time");
    const clashes = await prisma.booking.findMany({
      where: {
        tableId: { in: branch.tables.map((t) => t.id) },
        status: { in: ["PENDING", "CONFIRMED"] },
        date: {
          gt: new Date(at.getTime() - BOOKING_WINDOW_MS),
          lt: new Date(at.getTime() + BOOKING_WINDOW_MS),
        },
      },
      select: { tableId: true },
    });
    bookedTableIds = new Set(clashes.map((c) => c.tableId));
  }

  res.json({
    ...branch,
    tables: branch.tables.map((t) => ({ ...t, isBooked: bookedTableIds.has(t.id) })),
  });
});

export default router;
