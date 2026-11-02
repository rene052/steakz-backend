import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, verifyToken } from "../middleware/auth";
import { conflict, HttpError, notFound, parseBody } from "../utils/http";

const router = Router();

/** Fields of a user that are safe to send to the client (never the password hash). */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  branchId: true,
  salary: true,
  createdAt: true,
  branch: { select: { id: true, name: true } },
} as const;

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

// POST /api/auth/register — public self-registration; always creates a CUSTOMER.
router.post("/register", async (req, res) => {
  const { name, email, password } = parseBody(registerSchema, req.body);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("An account with this email already exists");

  const user = await prisma.user.create({
    data: { name, email, password: await bcrypt.hash(password, 10), role: "CUSTOMER" },
    select: publicUserSelect,
  });
  res.status(201).json({ token: signToken(user), user });
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

// POST /api/auth/login — returns a JWT carrying { id, role, branchId }.
router.post("/login", async (req, res) => {
  const { email, password } = parseBody(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  // Same message for unknown email and wrong password (don't reveal which accounts exist).
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new HttpError(401, "Invalid email or password");
  }
  if (!user.isActive) throw new HttpError(403, "This account has been disabled — contact an administrator");

  const safeUser = await prisma.user.findUnique({ where: { id: user.id }, select: publicUserSelect });
  res.json({ token: signToken(user), user: safeUser });
});

// GET /api/auth/me — the currently logged-in user.
router.get("/me", verifyToken, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: publicUserSelect });
  if (!user) throw notFound("User not found");
  res.json(user);
});

export default router;
