import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireBranch, requireRole, verifyToken } from "../middleware/auth";
import { badRequest, dayRange, dayRangeFromQuery, money, ORDER_STATUSES, STAFF_ROLES } from "../utils/http";
import { orderInclude } from "../utils/orders";
import { orderStatusCounts, salesReport, staffSelect } from "../utils/reports";

const router = Router();

// Everything here is limited to the manager's own branch (from the token, never from the URL).
router.use(verifyToken, requireRole(["BRANCH_MANAGER"]), requireBranch);

// GET /api/branch-manager/overview — summary counts for the branch dashboard.
router.get("/overview", async (req, res) => {
  const branchId = req.branchId!;
  const { start, end } = dayRange();

  const [branch, tables, menuItems, staffByRole, todaysBookings, ordersToday, revenueToday] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true, address: true, phone: true } }),
    prisma.table.findMany({ where: { branchId }, select: { id: true } }),
    prisma.menuItem.groupBy({ by: ["isAvailable"], where: { branchId }, _count: true }),
    prisma.user.groupBy({ by: ["role"], where: { branchId, role: { in: [...STAFF_ROLES] } }, _count: true }),
    prisma.booking.findMany({
      where: { table: { branchId }, date: { gte: start, lt: end }, status: { not: "CANCELLED" } },
      select: { tableId: true, guestCount: true },
    }),
    orderStatusCounts({ branchId, createdAt: { gte: start } }),
    prisma.order.aggregate({
      where: { branchId, status: "DELIVERED", createdAt: { gte: start } },
      _sum: { total: true },
    }),
  ]);

  const occupiedTables = new Set(todaysBookings.map((b) => b.tableId)).size;
  const staff: Record<string, number> = { CASHIER: 0, CHEF: 0, BRANCH_MANAGER: 0 };
  for (const g of staffByRole) staff[g.role] = g._count;

  res.json({
    branch,
    staff: { ...staff, total: Object.values(staff).reduce((a, b) => a + b, 0) },
    tables: {
      total: tables.length,
      bookedToday: occupiedTables,
      occupancyRate: tables.length ? Math.round((occupiedTables / tables.length) * 100) : 0,
    },
    menu: {
      total: menuItems.reduce((a, g) => a + g._count, 0),
      available: menuItems.find((g) => g.isAvailable)?._count ?? 0,
    },
    bookingsToday: { count: todaysBookings.length, guests: todaysBookings.reduce((a, b) => a + b.guestCount, 0) },
    ordersToday,
    activeOrders: ordersToday.PENDING + ordersToday.PREPARING + ordersToday.DONE,
    revenueToday: money(revenueToday._sum.total ?? 0),
  });
});

// GET /api/branch-manager/orders — every order of the branch (optional ?status=).
router.get("/orders", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
  if (status && !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
    throw badRequest(`status must be one of ${ORDER_STATUSES.join(", ")}`);
  }
  const orders = await prisma.order.findMany({
    where: { branchId: req.branchId, ...(status ? { status: status as (typeof ORDER_STATUSES)[number] } : {}) },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  res.json(orders);
});

// GET /api/branch-manager/staff — staff roster with salaries and the monthly payroll total.
router.get("/staff", async (req, res) => {
  const staff = await prisma.user.findMany({
    where: { branchId: req.branchId, role: { in: [...STAFF_ROLES] } },
    select: staffSelect,
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const payroll = money(staff.filter((s) => s.isActive).reduce((sum, s) => sum + (s.salary ?? 0), 0));
  res.json({ staff, totalSalaries: payroll, headcount: staff.length });
});

// GET /api/branch-manager/bookings — bookings at this branch (optional ?date=YYYY-MM-DD).
router.get("/bookings", async (req, res) => {
  const range = dayRangeFromQuery(req.query.date);
  const bookings = await prisma.booking.findMany({
    where: { table: { branchId: req.branchId }, ...(range ? { date: { gte: range.start, lt: range.end } } : {}) },
    include: {
      table: { select: { id: true, tableNumber: true, capacity: true } },
      customer: { select: { id: true, name: true, email: true } },
      orders: { select: { id: true, status: true, total: true } },
    },
    orderBy: { date: range ? "asc" : "desc" },
    take: 300,
  });
  res.json(bookings);
});

// GET /api/branch-manager/sales — revenue totals for this branch.
router.get("/sales", async (req, res) => {
  res.json(await salesReport(req.branchId));
});

export default router;
