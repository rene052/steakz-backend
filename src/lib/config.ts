import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  adminEmail: process.env.ADMIN_EMAIL || "admin@steakz.com",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  adminName: process.env.ADMIN_NAME || "System Admin",
  // Comma-separated list of allowed frontend origins, or "*" for any.
  corsOrigin: process.env.CORS_ORIGIN || "*",
  // Load the demo branches, staff and orders automatically when the database is empty.
  seedDemoData: (process.env.SEED_DEMO_DATA ?? "true").toLowerCase() !== "false",
};
