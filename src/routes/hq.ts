import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRole, verifyToken } from "../middleware/auth";
import { badRequest, dayRange, money, ORDER_STATUSES, STAFF_ROLES } from "../utils/http";
import { orderInclude } from "../utils/orders";
import { orderStatusCounts, salesReport, staffSelect } from "../utils/reports";

const router = Router();

// HQ is global — not tied to any branch. Admins can also see these reports.
router.use(verifyToken, requireRole(["HQ_MANAGER", "ADMIN"]));

const optionalBranchId = (value: unknown) => {
  if (value === undefined || value === "") return undefined;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("branchId must be a positive integer");
  return id;
};

// GET /api/hq/overview — every branch with its counts, plus chain-wide totals.
router.get("/overview", async (_req, res) => {
  const { start } = dayRange();
  const [branches, revenue, revenueToday, activeOrders, customers, ordersToday] = await Promise.all([
    prisma.branch.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        isActive: true,
        _count: { select: { users: true, tables: true, menuItems: true, orders: true } },
      },
    }),
    prisma.order.groupBy({ by: ["branchId"], where: { status: "DELIVERED" }, _sum: { total: true } }),
    prisma.order.groupBy({
      by: ["branchId"],
      where: { status: "DELIVERED", createdAt: { gte: start } },
      _sum: { total: true },
    }),
    prisma.order.groupBy({
      by: ["branchId"],
      where: { status: { in: ["PENDING", "PREPARING", "DONE"] } },
      _count: true,
    }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    orderStatusCounts({ createdAt: { gte: start } }),
  ]);

  const rev = new Map(revenue.map((r) => [r.branchId, r._sum.total ?? 0]));
  const revToday = new Map(revenueToday.map((r) => [r.branchId, r._sum.total ?? 0]));
  const active = new Map(activeOrders.map((r) => [r.branchId, r._count]));

  const rows = branches.map((b) => ({
    id: b.id,
    name: b.name,
    address: b.address,
    isActive: b.isActive,
    staff: b._count.users,
    tables: b._count.tables,
    menuItems: b._count.menuItems,
    orders: b._count.orders,
    activeOrders: active.get(b.id) ?? 0,
    revenue: money(rev.get(b.id) ?? 0),
    revenueToday: money(revToday.get(b.id) ?? 0),
  }));

  res.json({
    totals: {
      branches: branches.length,
      activeBranches: branches.filter((b) => b.isActive).length,
      staff: rows.reduce((a, r) => a + r.staff, 0),
      customers,
      orders: rows.reduce((a, r) => a + r.orders, 0),
      activeOrders: rows.reduce((a, r) => a + r.activeOrders, 0),
      revenue: money(rows.reduce((a, r) => a + r.revenue, 0)),
      revenueToday: money(rows.reduce((a, r) => a + r.revenueToday, 0)),
    },
    ordersToday,
    branches: rows,
  });
});

// GET /api/hq/orders — all orders across every branch (optional ?branchId= & ?status=).
router.get("/orders", async (req, res) => {
  const branchId = optionalBranchId(req.query.branchId);
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status.toUpperCase() : undefined;
  if (status && !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
    throw badRequest(`status must be one of ${ORDER_STATUSES.join(", ")}`);
  }
  const orders = await prisma.order.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(status ? { status: status as (typeof ORDER_STATUSES)[number] } : {}),
    },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json(orders);
});

// GET /api/hq/staff — all staff and salaries at every location (optional ?branchId=).
router.get("/staff", async (req, res) => {
  const branchId = optionalBranchId(req.query.branchId);
  const staff = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES, "HQ_MANAGER"] }, ...(branchId ? { branchId } : {}) },
    select: staffSelect,
    orderBy: [{ branchId: "asc" }, { role: "asc" }, { name: "asc" }],
  });

  const perBranch = new Map<string, { branch: string; headcount: number; totalSalaries: number }>();
  for (const s of staff) {
    const key = s.branch?.name ?? "Head Office";
    const row = perBranch.get(key) ?? { branch: key, headcount: 0, totalSalaries: 0 };
    row.headcount += 1;
    if (s.isActive) row.totalSalaries += s.salary ?? 0;
    perBranch.set(key, row);
  }
  const byBranch = [...perBranch.values()].map((r) => ({ ...r, totalSalaries: money(r.totalSalaries) }));

  res.json({
    staff,
    byBranch,
    headcount: staff.length,
    totalSalaries: money(byBranch.reduce((a, r) => a + r.totalSalaries, 0)),
  });
});

// GET /api/hq/sales — revenue grouped by branch, plus chain-wide trends.
router.get("/sales", async (_req, res) => {
  const [branches, grouped, chain] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.order.groupBy({
      by: ["branchId"],
      where: { status: "DELIVERED" },
      _sum: { total: true },
      _count: true,
    }),
    salesReport(),
  ]);
  const byId = new Map(grouped.map((g) => [g.branchId, g]));
  const byBranch = branches
    .map((b) => {
      const g = byId.get(b.id);
      const revenue = money(g?._sum.total ?? 0);
      const orders = g?._count ?? 0;
      return { branchId: b.id, branch: b.name, revenue, orders, averageOrderValue: orders ? money(revenue / orders) : 0 };
    })
    .sort((a, b) => b.revenue - a.revenue);

  res.json({ totalRevenue: chain.allTime.revenue, byBranch, ...chain });
});

export default router;
