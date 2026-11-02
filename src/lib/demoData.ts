/**
 * Demo data for Steakz: 7 branches, every staff role, customers, menus, tables,
 * bookings and 30 days of orders.
 *
 *  - Loaded AUTOMATICALLY the first time the server starts on an empty database
 *    (see src/index.ts), so all roles exist before anyone logs in.
 *  - Can be reloaded at any time with:  npm run seed
 *
 * ⚠ seedDemoData() resets the database: removes every branch, order, booking and
 *   non-admin user. The ADMIN account is kept.
 *
 * Every demo account uses the password:  password123
 */
import bcrypt from "bcryptjs";
import type { OrderStatus, PrismaClient } from "@prisma/client";
import { ensureAdmin } from "./adminSeeder";

export const DEMO_PASSWORD = "password123";

// Deterministic pseudo-random generator so every seed run produces the same numbers.
let state = 20261102;
const rand = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

const BRANCHES = [
  { key: "london", name: "Steakz London", address: "14 Henrietta Street, Covent Garden, London WC2E 8QH", phone: "020 7946 0101" },
  { key: "manchester", name: "Steakz Manchester", address: "52 King Street, Manchester M2 4LY", phone: "0161 496 0102" },
  { key: "birmingham", name: "Steakz Birmingham", address: "8 Colmore Row, Birmingham B3 2QD", phone: "0121 496 0103" },
  { key: "leeds", name: "Steakz Leeds", address: "21 Park Row, Leeds LS1 5JF", phone: "0113 496 0104" },
  { key: "liverpool", name: "Steakz Liverpool", address: "3 Castle Street, Liverpool L2 4SW", phone: "0151 496 0105" },
  { key: "glasgow", name: "Steakz Glasgow", address: "77 Buchanan Street, Glasgow G1 3HL", phone: "0141 496 0106" },
  { key: "edinburgh", name: "Steakz Edinburgh", address: "40 George Street, Edinburgh EH2 2LE", phone: "0131 496 0107" },
];

const MENU: { name: string; description: string; price: number; category: string }[] = [
  { category: "Starters", name: "Beef Carpaccio", description: "Thinly sliced raw fillet, rocket, parmesan, truffle oil", price: 11.5 },
  { category: "Starters", name: "Crispy Calamari", description: "Lemon aioli and chilli salt", price: 9 },
  { category: "Starters", name: "French Onion Soup", description: "Slow-cooked onions, gruyère crouton", price: 7.5 },
  { category: "Steaks", name: "Ribeye 300g", description: "28-day dry-aged, rich marbling", price: 32 },
  { category: "Steaks", name: "Sirloin 250g", description: "Grass-fed, lean with a fat cap", price: 27 },
  { category: "Steaks", name: "Fillet 200g", description: "The most tender cut", price: 36 },
  { category: "Steaks", name: "T-Bone 500g", description: "Sirloin and fillet on the bone, to share", price: 45 },
  { category: "Mains", name: "Steakz Burger", description: "Chuck & brisket patty, cheddar, house pickles, fries", price: 16.5 },
  { category: "Mains", name: "Grilled Salmon", description: "Charred lemon, herb butter, greens", price: 21 },
  { category: "Mains", name: "Wild Mushroom Risotto", description: "Vegetarian — porcini, parmesan, thyme", price: 15 },
  { category: "Sides", name: "Triple-Cooked Chips", description: "Beef-dripping chips", price: 5 },
  { category: "Sides", name: "Creamed Spinach", description: "Nutmeg and garlic", price: 5 },
  { category: "Sides", name: "Mac & Cheese", description: "Three cheeses, crispy crumb", price: 6.5 },
  { category: "Sides", name: "Peppercorn Sauce", description: "Brandy and green peppercorn", price: 3 },
  { category: "Desserts", name: "Sticky Toffee Pudding", description: "Toffee sauce, vanilla ice cream", price: 8 },
  { category: "Desserts", name: "Chocolate Fondant", description: "Molten centre, salted caramel", price: 8.5 },
  { category: "Drinks", name: "House Red (glass)", description: "Malbec, Mendoza", price: 7.5 },
  { category: "Drinks", name: "Craft Lager", description: "Pint", price: 6 },
  { category: "Drinks", name: "Sparkling Water", description: "750ml bottle", price: 3.5 },
];

const CUSTOMERS = [
  { name: "John Smith", email: "customer@steakz.com" },
  { name: "Emma Wilson", email: "emma.wilson@example.com" },
  { name: "Liam Brown", email: "liam.brown@example.com" },
  { name: "Olivia Taylor", email: "olivia.taylor@example.com" },
  { name: "Noah Davies", email: "noah.davies@example.com" },
  { name: "Ava Evans", email: "ava.evans@example.com" },
  { name: "Lucas Martin", email: "lucas.martin@example.com" },
  { name: "Sophie Thomas", email: "sophie.thomas@example.com" },
];

const FIRST = ["James", "Amelia", "Harry", "Isla", "Jack", "Mia", "George", "Grace", "Oscar", "Freya", "Charlie", "Lily", "Arthur", "Chloe", "Leo", "Ella", "Henry", "Ruby", "Alfie", "Evie", "Theo"];
const LAST = ["Walker", "Wright", "Hughes", "Green", "Hall", "Wood", "Clarke", "Harris", "Lewis", "Young", "King", "Scott", "Baker", "Hill", "Moore", "Ward", "Turner", "Cooper", "Price", "Bennett", "Mitchell"];

function at(daysFromToday: number, hour: number, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export async function seedDemoData(prisma: PrismaClient, log: (msg: string) => void = console.log) {
  state = 20261102;
  log("Resetting demo data (admin account is kept)…");
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.table.deleteMany();
  await prisma.user.deleteMany({ where: { role: { not: "ADMIN" } } });
  await prisma.branch.deleteMany();
  await ensureAdmin(prisma);

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const now = new Date();

  // HQ manager (global — no branch)
  await prisma.user.create({
    data: { name: "Victoria Hale", email: "hq@steakz.com", password: hash, role: "HQ_MANAGER", salary: 68000 },
  });

  const customers = [];
  for (const c of CUSTOMERS) {
    customers.push(await prisma.user.create({ data: { ...c, password: hash, role: "CUSTOMER" } }));
  }

  let nameIdx = 0;
  const staffName = () => {
    const n = `${FIRST[nameIdx % FIRST.length]} ${LAST[(nameIdx * 7) % LAST.length]}`;
    nameIdx++;
    return n;
  };

  for (const [bIdx, b] of BRANCHES.entries()) {
    const branch = await prisma.branch.create({ data: { name: b.name, address: b.address, phone: b.phone } });
    const cityPay = b.key === "london" ? 1.15 : b.key === "edinburgh" || b.key === "manchester" ? 1.05 : 1;

    // Staff: 1 branch manager, 2 waiters/cashiers, 2 chefs (emails like chef.london@steakz.com)
    const staff = [
      { role: "BRANCH_MANAGER", email: `manager.${b.key}@steakz.com`, salary: 42000 },
      { role: "CASHIER", email: `cashier.${b.key}@steakz.com`, salary: 24000 },
      { role: "CASHIER", email: `waiter.${b.key}@steakz.com`, salary: 23500 }, // cashier = waiter in Steakz
      { role: "CHEF", email: `chef.${b.key}@steakz.com`, salary: 33000 },
      { role: "CHEF", email: `chef2.${b.key}@steakz.com`, salary: 29500 },
    ] as const;
    for (const s of staff) {
      await prisma.user.create({
        data: {
          name: staffName(),
          email: s.email,
          password: hash,
          role: s.role,
          branchId: branch.id,
          salary: Math.round((s.salary * cityPay) / 100) * 100,
        },
      });
    }

    // Tables: 10 per branch, 2- to 8-seaters
    const capacities = [2, 2, 4, 4, 4, 4, 6, 6, 8, 2];
    await prisma.table.createMany({
      data: capacities.map((capacity, i) => ({ tableNumber: i + 1, capacity, branchId: branch.id })),
    });
    const tables = await prisma.table.findMany({ where: { branchId: branch.id }, orderBy: { tableNumber: "asc" } });

    // Menu: same signature menu everywhere, with small regional price differences
    await prisma.menuItem.createMany({
      data: MENU.map((m) => ({
        ...m,
        price: Math.round(m.price * cityPay * 2) / 2,
        branchId: branch.id,
        isAvailable: !(b.key === "leeds" && m.name === "T-Bone 500g"), // one sold-out item for the demo
      })),
    });
    const menu = await prisma.menuItem.findMany({ where: { branchId: branch.id, isAvailable: true } });

    const makeLines = () => {
      const lines = new Map<number, { menuItemId: number; quantity: number; unitPrice: number }>();
      const count = randInt(2, 5);
      for (let i = 0; i < count; i++) {
        const m = pick(menu);
        const line = lines.get(m.id) ?? { menuItemId: m.id, quantity: 0, unitPrice: m.price };
        line.quantity += randInt(1, 2);
        lines.set(m.id, line);
      }
      const items = [...lines.values()];
      const total = Math.round(items.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100;
      return { items, total };
    };

    const createOrder = async (
      status: OrderStatus,
      createdAt: Date,
      opts: { tableId: number; customerId?: number; bookingId?: number },
    ) => {
      const { items, total } = makeLines();
      await prisma.order.create({
        data: {
          branchId: branch.id,
          tableId: opts.tableId,
          customerId: opts.customerId ?? null,
          bookingId: opts.bookingId ?? null,
          status,
          total,
          createdAt,
          // last status change ~25 minutes after ordering (or "now" for live orders)
          updatedAt: new Date(Math.min(createdAt.getTime() + 25 * 60000, Date.now())),
          items: { create: items },
        },
      });
    };

    // 30 days of history (bigger branches are busier)
    const busyness = [9, 7, 6, 5, 5, 6, 5][bIdx];
    for (let day = -30; day <= -1; day++) {
      const weekend = [5, 6, 0].includes(at(day, 12).getDay());
      const ordersToday = randInt(busyness - 2, busyness + 2) + (weekend ? 3 : 0);
      for (let i = 0; i < ordersToday; i++) {
        const createdAt = at(day, randInt(12, 21), randInt(0, 59));
        const table = pick(tables);
        if (rand() < 0.25) {
          // the main demo customer gets a short, readable history
          const customer = rand() < 0.04 ? customers[0] : pick(customers.slice(1));
          const booking = await prisma.booking.create({
            data: {
              customerId: customer.id,
              tableId: table.id,
              guestCount: randInt(1, table.capacity),
              date: createdAt,
              status: "COMPLETED",
              createdAt: new Date(createdAt.getTime() - 3 * 86400000),
              updatedAt: createdAt,
            },
          });
          await createOrder("DELIVERED", createdAt, { tableId: table.id, customerId: customer.id, bookingId: booking.id });
        } else {
          await createOrder(rand() < 0.03 ? "CANCELLED" : "DELIVERED", createdAt, { tableId: table.id });
        }
      }
    }

    // Today: some orders already served, plus a live queue for the kitchen & cashier demo.
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000);
    for (let i = 0; i < randInt(3, 6); i++) {
      await createOrder("DELIVERED", minutesAgo(randInt(90, 240)), { tableId: pick(tables).id });
    }
    await createOrder("DONE", minutesAgo(18), { tableId: tables[2].id });
    await createOrder("PREPARING", minutesAgo(11), { tableId: tables[4].id });
    await createOrder("PENDING", minutesAgo(6), { tableId: tables[6].id });
    await createOrder("PENDING", minutesAgo(2), { tableId: tables[1].id });

    // Today's and upcoming bookings
    for (let i = 0; i < randInt(3, 5); i++) {
      const table = tables[(i * 3 + 1) % tables.length];
      await prisma.booking.create({
        data: {
          customerId: pick(customers.slice(1)).id,
          tableId: table.id,
          guestCount: randInt(1, table.capacity),
          date: at(0, 18 + i, i % 2 ? 30 : 0),
          status: i === 0 ? "CONFIRMED" : "PENDING",
        },
      });
    }
    for (let i = 0; i < 6; i++) {
      const table = pick(tables);
      await prisma.booking.create({
        data: {
          customerId: pick(customers.slice(1)).id,
          tableId: table.id,
          guestCount: randInt(1, table.capacity),
          date: at(randInt(1, 10), randInt(12, 21), pick([0, 30])),
        },
      });
    }

    log(`  ✔ ${b.name}`);
  }

  // The main demo customer (customer@steakz.com): bookings at London, one with a live order.
  const london = await prisma.branch.findUniqueOrThrow({ where: { name: "Steakz London" }, include: { tables: true } });
  const londonMenu = await prisma.menuItem.findMany({ where: { branchId: london.id } });
  const john = customers[0];
  const t9 = london.tables.find((t) => t.tableNumber === 9)!;
  const t4 = london.tables.find((t) => t.tableNumber === 4)!;

  const tonight = await prisma.booking.create({
    data: { customerId: john.id, tableId: t9.id, guestCount: 4, date: at(0, 20, 0), status: "CONFIRMED" },
  });
  const ribeye = londonMenu.find((m) => m.name === "Ribeye 300g")!;
  const chips = londonMenu.find((m) => m.name === "Triple-Cooked Chips")!;
  await prisma.order.create({
    data: {
      branchId: london.id,
      tableId: t9.id,
      customerId: john.id,
      bookingId: tonight.id,
      status: "PREPARING",
      total: Math.round((ribeye.price * 2 + chips.price * 2) * 100) / 100,
      createdAt: new Date(now.getTime() - 4 * 60000),
      items: {
        create: [
          { menuItemId: ribeye.id, quantity: 2, unitPrice: ribeye.price },
          { menuItemId: chips.id, quantity: 2, unitPrice: chips.price },
        ],
      },
    },
  });
  await prisma.booking.create({
    data: { customerId: john.id, tableId: t4.id, guestCount: 2, date: at(5, 19, 30), status: "PENDING" },
  });

  const counts = await Promise.all([
    prisma.branch.count(),
    prisma.user.count(),
    prisma.order.count(),
    prisma.booking.count(),
  ]);
  log(`Done: ${counts[0]} branches, ${counts[1]} users, ${counts[2]} orders, ${counts[3]} bookings.`);
  log(`Demo password for every seeded account: ${DEMO_PASSWORD}`);
}
