import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireRole, verifyToken } from "../middleware/auth";
import { badRequest, conflict, forbidden, idParam, notFound, parseBody, STAFF_ROLES } from "../utils/http";
import { publicUserSelect } from "./auth";

const router = Router();

router.use(verifyToken, requireRole(["ADMIN"]));

const ROLES = ["CUSTOMER", "CASHIER", "CHEF", "BRANCH_MANAGER", "HQ_MANAGER", "ADMIN"] as const;
const isStaffRole = (role: Role) => (STAFF_ROLES as readonly string[]).includes(role);

/**
 * Branch rules: cashiers, chefs and branch managers MUST belong to a branch;
 * customers, HQ managers and admins are global (branchId = null).
 */
async function resolveBranch(role: Role, branchId: number | null | undefined): Promise<number | null> {
  if (!isStaffRole(role)) return null;
  if (!branchId) throw badRequest(`A ${role} must be assigned to a branch (branchId)`);
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw notFound("Branch not found");
  return branchId;
}

// ---------- Branches ----------

// GET /api/admin/branches — all branches, including inactive ones.
router.get("/branches", async (_req, res) => {
  const branches = await prisma.branch.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true, tables: true, menuItems: true, orders: true } } },
  });
  res.json(branches);
});

const branchSchema = z.object({
  name: z.string().trim().min(2, "Branch name is required"),
  address: z.string().trim().min(5, "Address is required"),
  phone: z.string().trim().max(30).optional().nullable(),
  // Optional convenience: create N tables (numbered 1..N) so the branch can take bookings at once.
  tableCount: z.coerce.number().int().min(0).max(100).optional(),
  tableCapacity: z.coerce.number().int().min(1).max(20).optional(),
});

// POST /api/admin/branches — add a new branch.
router.post("/branches", async (req, res) => {
  const { name, address, phone, tableCount = 0, tableCapacity = 4 } = parseBody(branchSchema, req.body);
  if (await prisma.branch.findUnique({ where: { name } })) throw conflict(`A branch named "${name}" already exists`);

  const branch = await prisma.branch.create({
    data: {
      name,
      address,
      phone: phone || null,
      tables: {
        create: Array.from({ length: tableCount }, (_, i) => ({ tableNumber: i + 1, capacity: tableCapacity })),
      },
    },
    include: { _count: { select: { users: true, tables: true, menuItems: true, orders: true } } },
  });
  res.status(201).json(branch);
});

// ---------- Users ----------

// GET /api/admin/users — every user (optional ?role= & ?branchId=).
router.get("/users", async (req, res) => {
  const role = typeof req.query.role === "string" && req.query.role ? req.query.role.toUpperCase() : undefined;
  if (role && !(ROLES as readonly string[]).includes(role)) throw badRequest(`role must be one of ${ROLES.join(", ")}`);
  const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
  if (branchId !== undefined && (!Number.isInteger(branchId) || branchId <= 0)) throw badRequest("Invalid branchId");

  const users = await prisma.user.findMany({
    where: { ...(role ? { role: role as Role } : {}), ...(branchId ? { branchId } : {}) },
    select: publicUserSelect,
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  res.json(users);
});

const createUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(ROLES),
  branchId: z.coerce.number().int().positive().optional().nullable(),
  salary: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
});

// POST /api/admin/users — create a user with any role (staff get a branch at creation).
router.post("/users", async (req, res) => {
  const body = parseBody(createUserSchema, req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict("An account with this email already exists");
  }
  const branchId = await resolveBranch(body.role, body.branchId);

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      password: await bcrypt.hash(body.password, 10),
      role: body.role,
      branchId,
      salary: body.role === "CUSTOMER" ? null : (body.salary ?? null),
    },
    select: publicUserSelect,
  });
  res.status(201).json(user);
});

const roleSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    branchId: z.coerce.number().int().positive().optional().nullable(),
    salary: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  })
  .refine((b) => b.role !== undefined || b.branchId !== undefined || b.salary !== undefined, {
    message: "Provide role, branchId and/or salary",
  });

// PATCH /api/admin/users/:id/role — change role and/or branch (and optionally salary).
router.patch("/users/:id/role", async (req, res) => {
  const id = idParam(req);
  const body = parseBody(roleSchema, req.body);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound("User not found");

  const newRole = body.role ?? user.role;
  if (id === req.user!.id && newRole !== "ADMIN") throw forbidden("You cannot remove your own admin role");

  const requestedBranch = body.branchId !== undefined ? body.branchId : user.branchId;
  const branchId = await resolveBranch(newRole, requestedBranch);

  const updated = await prisma.user.update({
    where: { id },
    data: {
      role: newRole,
      branchId,
      ...(body.salary !== undefined ? { salary: body.salary } : {}),
      ...(newRole === "CUSTOMER" ? { salary: null } : {}),
    },
    select: publicUserSelect,
  });
  res.json(updated);
});

// PATCH /api/admin/users/:id/disable — block login (existing tokens stop working too).
router.patch("/users/:id/disable", async (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw forbidden("You cannot disable your own account");
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound("User not found");
  res.json(await prisma.user.update({ where: { id }, data: { isActive: false }, select: publicUserSelect }));
});

// PATCH /api/admin/users/:id/enable — re-enable a disabled account.
router.patch("/users/:id/enable", async (req, res) => {
  const id = idParam(req);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound("User not found");
  res.json(await prisma.user.update({ where: { id }, data: { isActive: true }, select: publicUserSelect }));
});

// DELETE /api/admin/users/:id — permanently delete a user.
// Their bookings are removed; their past orders stay in the sales history (customer set to null).
router.delete("/users/:id", async (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw forbidden("You cannot delete your own account");
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound("User not found");
  await prisma.user.delete({ where: { id } });
  res.json({ deleted: true, id, message: `${user.name} (${user.email}) was deleted` });
});

export default router;
