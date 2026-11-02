import { prisma } from "../lib/prisma";
import { dayRange, money } from "./http";

/**
 * Revenue rule: Steakz is "serve then pay", so an order counts as revenue once it is
 * DELIVERED (served at the table and paid on departure).
 */
const REVENUE_STATUS = "DELIVERED" as const;

/** Sales report for one branch, or for the whole chain when branchId is undefined. */
export async function salesReport(branchId?: number) {
  const scope = branchId ? { branchId } : {};
  const { start: todayStart } = dayRange();
  // Local midnight `days - 1` days ago (setDate keeps it correct across daylight-saving changes).
  const since = (days: number) => {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - (days - 1));
    return d;
  };

  const sum = async (from?: Date) => {
    const agg = await prisma.order.aggregate({
      where: { ...scope, status: REVENUE_STATUS, ...(from ? { createdAt: { gte: from } } : {}) },
      _sum: { total: true },
      _count: true,
    });
    return { revenue: money(agg._sum.total ?? 0), orders: agg._count };
  };

  const [today, last7Days, last30Days, allTime] = await Promise.all([
    sum(todayStart),
    sum(since(7)),
    sum(since(30)),
    sum(),
  ]);

  // Daily revenue for the last 14 days (oldest → newest), for the chart.
  const recent = await prisma.order.findMany({
    where: { ...scope, status: REVENUE_STATUS, createdAt: { gte: since(14) } },
    select: { total: true, createdAt: true },
  });
  const daily = Array.from({ length: 14 }, (_, i) => {
    const d = since(14 - i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { date, key: d.toDateString(), revenue: 0, orders: 0 };
  });
  const byKey = new Map(daily.map((d) => [d.key, d]));
  for (const o of recent) {
    const bucket = byKey.get(o.createdAt.toDateString());
    if (bucket) {
      bucket.revenue += o.total;
      bucket.orders += 1;
    }
  }

  // Best-selling dishes over the last 30 days.
  const lines = await prisma.orderItem.findMany({
    where: { order: { ...scope, status: REVENUE_STATUS, createdAt: { gte: since(30) } } },
    select: { quantity: true, unitPrice: true, menuItem: { select: { name: true } } },
  });
  const items = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const l of lines) {
    const row = items.get(l.menuItem.name) ?? { name: l.menuItem.name, quantity: 0, revenue: 0 };
    row.quantity += l.quantity;
    row.revenue += l.quantity * l.unitPrice;
    items.set(row.name, row);
  }
  const topItems = [...items.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((r) => ({ ...r, revenue: money(r.revenue) }));

  return {
    today,
    last7Days,
    last30Days,
    allTime,
    averageOrderValue: allTime.orders ? money(allTime.revenue / allTime.orders) : 0,
    daily: daily.map(({ date, revenue, orders }) => ({ date, revenue: money(revenue), orders })),
    topItems,
  };
}

/** Orders per status, e.g. { PENDING: 3, PREPARING: 1, ... } (all statuses present). */
export async function orderStatusCounts(where: { branchId?: number; createdAt?: { gte: Date } }) {
  const groups = await prisma.order.groupBy({ by: ["status"], where, _count: true });
  const counts: Record<string, number> = { PENDING: 0, PREPARING: 0, DONE: 0, DELIVERED: 0, CANCELLED: 0 };
  for (const g of groups) counts[g.status] = g._count;
  return counts;
}

export const staffSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  salary: true,
  isActive: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
} as const;
