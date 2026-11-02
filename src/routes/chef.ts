import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireBranch, requireRole, verifyToken } from "../middleware/auth";
import { badRequest, forbidden, idParam, notFound } from "../utils/http";
import { orderInclude } from "../utils/orders";

const router = Router();

// Chef routes are branch-scoped: the branchId always comes from the logged-in account.
router.use(verifyToken, requireRole(["CHEF"]), requireBranch);

/** Loads an order and checks it belongs to the chef's branch (403 otherwise). */
async function findBranchOrder(id: number, branchId: number) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw notFound("Order not found");
  if (order.branchId !== branchId) throw forbidden("This order belongs to another branch");
  return order;
}

// GET /api/chef/orders — the kitchen queue: PENDING and PREPARING orders, oldest first.
router.get("/orders", async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { branchId: req.branchId, status: { in: ["PENDING", "PREPARING"] } },
    include: orderInclude,
    orderBy: { createdAt: "asc" },
  });
  res.json(orders);
});

// PATCH /api/chef/orders/:id/preparing — (optional step) chef starts cooking.
router.patch("/orders/:id/preparing", async (req, res) => {
  const order = await findBranchOrder(idParam(req), req.branchId!);
  if (order.status !== "PENDING") throw badRequest(`Only PENDING orders can be started (this one is ${order.status})`);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "PREPARING" },
    include: orderInclude,
  });
  res.json(updated);
});

// PATCH /api/chef/orders/:id/done — food is ready; the cashier can now pick it up.
router.patch("/orders/:id/done", async (req, res) => {
  const order = await findBranchOrder(idParam(req), req.branchId!);
  if (order.status !== "PENDING" && order.status !== "PREPARING") {
    throw badRequest(`Only PENDING or PREPARING orders can be marked done (this one is ${order.status})`);
  }
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "DONE" },
    include: orderInclude,
  });
  res.json(updated);
});

// GET /api/chef/menu — the full menu of the chef's own branch.
router.get("/menu", async (req, res) => {
  const items = await prisma.menuItem.findMany({
    where: { branchId: req.branchId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  res.json(items);
});

// DELETE /api/chef/menu/:id — remove an item from the own-branch menu.
// Items that appear in past orders are kept for history and marked unavailable instead.
router.delete("/menu/:id", async (req, res) => {
  const id = idParam(req);
  const item = await prisma.menuItem.findUnique({ where: { id }, include: { _count: { select: { orderItems: true } } } });
  if (!item) throw notFound("Menu item not found");
  if (item.branchId !== req.branchId) throw forbidden("This menu item belongs to another branch");

  if (item._count.orderItems > 0) {
    await prisma.menuItem.update({ where: { id }, data: { isAvailable: false } });
    return res.json({
      deleted: false,
      archived: true,
      message: `"${item.name}" appears in past orders, so it was marked unavailable instead of deleted`,
    });
  }
  await prisma.menuItem.delete({ where: { id } });
  res.json({ deleted: true, message: `"${item.name}" was removed from the menu` });
});

export default router;
