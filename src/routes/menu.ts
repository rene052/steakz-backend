import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRole, verifyToken } from "../middleware/auth";
import { badRequest, forbidden, idParam, notFound, parseBody } from "../utils/http";

const router = Router();

// GET /api/menu/:branchId — public menu of a branch (unavailable items are flagged, not hidden).
router.get("/:branchId", async (req, res) => {
  const branchId = idParam(req, "branchId");
  const branch = await prisma.branch.findFirst({ where: { id: branchId, isActive: true } });
  if (!branch) throw notFound("Branch not found");
  const items = await prisma.menuItem.findMany({
    where: { branchId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  res.json(items);
});

const createSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  description: z.string().trim().max(500).optional().nullable(),
  price: z.coerce.number().positive("Price must be greater than 0").max(10000),
  category: z.string().trim().min(2, "Category is required"),
  isAvailable: z.boolean().optional(),
  branchId: z.coerce.number().int().positive().optional(),
});

// POST /api/menu — BRANCH_MANAGER (own branch only) or ADMIN (any branch, branchId required).
router.post("/", verifyToken, requireRole(["BRANCH_MANAGER", "ADMIN"]), async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const user = req.user!;

  let branchId: number;
  if (user.role === "BRANCH_MANAGER") {
    if (user.branchId == null) throw forbidden("Your account is not assigned to a branch");
    if (body.branchId && body.branchId !== user.branchId) {
      throw forbidden("Branch managers can only add items to their own branch");
    }
    branchId = user.branchId;
  } else {
    if (!body.branchId) throw badRequest("branchId is required");
    branchId = body.branchId;
  }

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw notFound("Branch not found");

  const item = await prisma.menuItem.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      price: body.price,
      category: body.category,
      isAvailable: body.isAvailable ?? true,
      branchId,
    },
  });
  res.status(201).json(item);
});

const updateSchema = createSchema.omit({ branchId: true }).partial();

// PATCH /api/menu/:id — update name/description/price/category/availability.
router.patch("/:id", verifyToken, requireRole(["BRANCH_MANAGER", "ADMIN"]), async (req, res) => {
  const id = idParam(req);
  const body = parseBody(updateSchema, req.body);
  if (Object.keys(body).length === 0) throw badRequest("Nothing to update");

  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item) throw notFound("Menu item not found");
  if (req.user!.role === "BRANCH_MANAGER" && item.branchId !== req.user!.branchId) {
    throw forbidden("This menu item belongs to another branch");
  }

  const updated = await prisma.menuItem.update({ where: { id }, data: body });
  res.json(updated);
});

export default router;
