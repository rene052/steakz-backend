import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { config } from "../lib/config";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  branchId: number | null;
}

export interface TokenPayload {
  id: number;
  role: Role;
  branchId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Set by requireBranch: the branch the logged-in staff member belongs to. */
      branchId?: number;
    }
  }
}

export function signToken(user: { id: number; role: Role; branchId: number | null }): string {
  const payload: TokenPayload = { id: user.id, role: user.role, branchId: user.branchId };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

/**
 * verifyToken — requires a valid "Authorization: Bearer <JWT>" header.
 * The user is re-loaded from the database on every request, so a disabled,
 * deleted or re-assigned account loses access immediately (not only when the token expires).
 * Responds 401 when the token is missing/invalid, 403 when the account is disabled.
 */
export async function verifyToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required — please log in" });
  }

  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret) as TokenPayload;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token — please log in again" });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { id: true, name: true, email: true, role: true, branchId: true, isActive: true },
  });
  if (!user) return res.status(401).json({ error: "Account no longer exists" });
  if (!user.isActive) return res.status(403).json({ error: "This account has been disabled" });

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId };
  next();
}

/** requireRole(['CHEF']) — 403 Forbidden unless the logged-in user has one of the roles. */
export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `Forbidden — this action requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

/**
 * requireBranch — for branch-scoped staff (cashier, chef, branch manager).
 * Reads the user's branchId and exposes it as req.branchId; every query in the
 * branch routes filters with `where: { branchId: req.branchId }`.
 */
export function requireBranch(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (req.user.branchId == null) {
    return res.status(403).json({ error: "Your account is not assigned to a branch" });
  }
  req.branchId = req.user.branchId;
  next();
}
