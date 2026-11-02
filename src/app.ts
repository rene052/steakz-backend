import express from "express";
import cors from "cors";
import { config } from "./lib/config";
import { prisma } from "./lib/prisma";
import { errorHandler, notFoundHandler } from "./middleware/error";
import authRoutes from "./routes/auth";
import publicRoutes from "./routes/public";
import menuRoutes from "./routes/menu";
import customerRoutes from "./routes/customer";
import chefRoutes from "./routes/chef";
import cashierRoutes from "./routes/cashier";
import branchManagerRoutes from "./routes/branchManager";
import hqRoutes from "./routes/hq";
import adminRoutes from "./routes/admin";

export const app = express();

const origins = config.corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: origins.includes("*") ? true : origins }));
app.use(express.json({ limit: "100kb" }));

app.get("/", (_req, res) => {
  res.json({ name: "Steakz Restaurant Portal API", status: "ok", docs: "See README.md for all endpoints" });
});

// Health check (also verifies the database connection).
app.get("/api/health", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/chef", chefRoutes);
app.use("/api/cashier", cashierRoutes);
app.use("/api/branch-manager", branchManagerRoutes);
app.use("/api/hq", hqRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
