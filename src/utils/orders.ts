import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { badRequest, money } from "./http";

/** A table is considered occupied for 2 hours around a booking time. */
export const BOOKING_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Standard shape returned for an order everywhere in the API. */
export const orderInclude = {
  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      menuItem: { select: { id: true, name: true, category: true } },
    },
  },
  table: { select: { id: true, tableNumber: true } },
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, email: true } },
  booking: { select: { id: true, date: true, guestCount: true } },
} satisfies Prisma.OrderInclude;

export const orderItemsSchema = z
  .array(
    z.object({
      menuItemId: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().min(1, "quantity must be at least 1").max(50),
    }),
  )
  .min(1, "An order needs at least one item");

/**
 * Validates that every menu item exists, belongs to the order's branch and is available,
 * then prices the order on the server (the client never decides the price).
 */
export async function priceOrderItems(branchId: number, items: z.infer<typeof orderItemsSchema>) {
  // Merge duplicate lines (e.g. the same steak added twice).
  const quantities = new Map<number, number>();
  for (const it of items) quantities.set(it.menuItemId, (quantities.get(it.menuItemId) ?? 0) + it.quantity);

  const menuItems = await prisma.menuItem.findMany({ where: { id: { in: [...quantities.keys()] } } });
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  const lines: { menuItemId: number; quantity: number; unitPrice: number }[] = [];
  for (const [menuItemId, quantity] of quantities) {
    const m = byId.get(menuItemId);
    if (!m || m.branchId !== branchId) throw badRequest(`Menu item ${menuItemId} is not on this branch's menu`);
    if (!m.isAvailable) throw badRequest(`"${m.name}" is currently unavailable`);
    lines.push({ menuItemId, quantity, unitPrice: m.price });
  }
  const total = money(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));
  return { lines, total };
}
