/**
 * End-to-end API test for the Steakz backend.
 *
 *   1. npm run seed        (fresh demo data)
 *   2. npm run dev         (server on http://localhost:5000)
 *   3. npm run test:api    (in a second terminal)
 *
 * Checks the full access-control matrix from the presentation (every endpoint × every role)
 * and the complete business flow: book → order → kitchen → deliver.
 */
const BASE = process.env.API_URL || "http://localhost:5000";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Res = { status: number; body: any };
async function api(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}

async function login(email: string, password = "password123") {
  const r = await api("POST", "/api/auth/login", undefined, { email, password });
  if (r.status !== 200) throw new Error(`Login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

function expectStatus(name: string, r: Res, status: number) {
  check(name, r.status === status, `expected ${status}, got ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
}

async function main() {
  console.log(`Testing ${BASE}\n`);

  // ---------- Public ----------
  const branches = await api("GET", "/api/public/branches");
  expectStatus("public branches", branches, 200);
  check("at least the 7 seeded branches", branches.body.length >= 7, `got ${branches.body.length}`);
  const london = branches.body.find((b: any) => b.name === "Steakz London");
  const manchester = branches.body.find((b: any) => b.name === "Steakz Manchester");

  const detail = await api("GET", `/api/public/branches/${london.id}`);
  expectStatus("public branch detail", detail, 200);
  check("branch detail has tables + menu", detail.body.tables.length === 10 && detail.body.menuItems.length > 10);
  expectStatus("public branch 404", await api("GET", "/api/public/branches/999999"), 404);
  expectStatus("public branch bad id", await api("GET", "/api/public/branches/abc"), 400);
  expectStatus("public menu", await api("GET", `/api/menu/${london.id}`), 200);

  // ---------- Auth ----------
  const email = `test.${Date.now()}@example.com`;
  const reg = await api("POST", "/api/auth/register", undefined, { name: "Test Customer", email, password: "secret12" });
  expectStatus("register", reg, 201);
  check("register creates CUSTOMER", reg.body.user?.role === "CUSTOMER");
  check("register never returns password", reg.body.user && !("password" in reg.body.user));
  expectStatus("register duplicate email", await api("POST", "/api/auth/register", undefined, { name: "Another Name", email, password: "secret12" }), 409);
  expectStatus("register validation", await api("POST", "/api/auth/register", undefined, { name: "X", email: "bad", password: "1" }), 400);
  expectStatus("login wrong password", await api("POST", "/api/auth/login", undefined, { email, password: "nope" }), 401);
  expectStatus("me without token", await api("GET", "/api/auth/me"), 401);
  expectStatus("me with garbage token", await api("GET", "/api/auth/me", "garbage"), 401);

  const tokens = {
    CUSTOMER: await login("customer@steakz.com"),
    CASHIER: await login("cashier.london@steakz.com"),
    CHEF: await login("chef.london@steakz.com"),
    BRANCH_MANAGER: await login("manager.london@steakz.com"),
    HQ_MANAGER: await login("hq@steakz.com"),
    ADMIN: await login("admin@steakz.com", "admin123"),
  };
  const me = await api("GET", "/api/auth/me", tokens.CHEF);
  expectStatus("me", me, 200);
  check("chef token scoped to London", me.body.branchId === london.id);

  // ---------- Access-control matrix (from the presentation tables) ----------
  type R = keyof typeof tokens;
  const ALL: R[] = ["CUSTOMER", "CASHIER", "CHEF", "BRANCH_MANAGER", "HQ_MANAGER", "ADMIN"];
  const matrix: { method: string; path: string; allowed: R[] }[] = [
    { method: "GET", path: "/api/auth/me", allowed: ALL },
    { method: "POST", path: "/api/menu", allowed: ["BRANCH_MANAGER", "ADMIN"] },
    { method: "PATCH", path: "/api/menu/1", allowed: ["BRANCH_MANAGER", "ADMIN"] },
    { method: "GET", path: "/api/customer/bookings", allowed: ["CUSTOMER"] },
    { method: "POST", path: "/api/customer/bookings", allowed: ["CUSTOMER"] },
    { method: "DELETE", path: "/api/customer/bookings/1", allowed: ["CUSTOMER"] },
    { method: "GET", path: "/api/customer/orders", allowed: ["CUSTOMER"] },
    { method: "POST", path: "/api/customer/orders", allowed: ["CUSTOMER"] },
    { method: "GET", path: "/api/chef/orders", allowed: ["CHEF"] },
    { method: "PATCH", path: "/api/chef/orders/1/done", allowed: ["CHEF"] },
    { method: "GET", path: "/api/chef/menu", allowed: ["CHEF"] },
    { method: "DELETE", path: "/api/chef/menu/1", allowed: ["CHEF"] },
    { method: "POST", path: "/api/cashier/orders", allowed: ["CASHIER"] },
    { method: "GET", path: "/api/cashier/orders", allowed: ["CASHIER"] },
    { method: "PATCH", path: "/api/cashier/orders/1/deliver", allowed: ["CASHIER"] },
    { method: "GET", path: "/api/branch-manager/overview", allowed: ["BRANCH_MANAGER"] },
    { method: "GET", path: "/api/branch-manager/orders", allowed: ["BRANCH_MANAGER"] },
    { method: "GET", path: "/api/branch-manager/staff", allowed: ["BRANCH_MANAGER"] },
    { method: "GET", path: "/api/branch-manager/bookings", allowed: ["BRANCH_MANAGER"] },
    { method: "GET", path: "/api/branch-manager/sales", allowed: ["BRANCH_MANAGER"] },
    { method: "GET", path: "/api/hq/overview", allowed: ["HQ_MANAGER", "ADMIN"] },
    { method: "GET", path: "/api/hq/orders", allowed: ["HQ_MANAGER", "ADMIN"] },
    { method: "GET", path: "/api/hq/staff", allowed: ["HQ_MANAGER", "ADMIN"] },
    { method: "GET", path: "/api/hq/sales", allowed: ["HQ_MANAGER", "ADMIN"] },
    { method: "GET", path: "/api/admin/branches", allowed: ["ADMIN"] },
    { method: "POST", path: "/api/admin/branches", allowed: ["ADMIN"] },
    { method: "GET", path: "/api/admin/users", allowed: ["ADMIN"] },
    { method: "POST", path: "/api/admin/users", allowed: ["ADMIN"] },
    { method: "PATCH", path: "/api/admin/users/1/role", allowed: ["ADMIN"] },
    { method: "PATCH", path: "/api/admin/users/1/disable", allowed: ["ADMIN"] },
    { method: "PATCH", path: "/api/admin/users/1/enable", allowed: ["ADMIN"] },
    { method: "DELETE", path: "/api/admin/users/1", allowed: ["ADMIN"] },
  ];
  let matrixChecks = 0;
  for (const ep of matrix) {
    const label = `${ep.method} ${ep.path}`;
    if (ep.path !== "/api/auth/me") {
      expectStatus(`${label} without token → 401`, await api(ep.method, ep.path, undefined, ep.method === "GET" ? undefined : {}), 401);
      matrixChecks++;
    }
    for (const role of ALL) {
      const allowed = ep.allowed.includes(role);
      if (allowed && ep.method !== "GET") continue; // mutating calls are exercised in the flow below
      const r = await api(ep.method, ep.path, tokens[role], ep.method === "GET" ? undefined : {});
      matrixChecks++;
      if (allowed) check(`${label} as ${role} allowed`, r.status === 200, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      else expectStatus(`${label} as ${role} → 403`, r, 403);
    }
  }
  console.log(`Access matrix: ${matrixChecks} checks`);

  // ---------- Customer: book a table ----------
  const C = tokens.CUSTOMER;
  const future = new Date();
  future.setDate(future.getDate() + 14);
  future.setHours(19, 0, 0, 0);
  const avail = await api("GET", `/api/public/branches/${london.id}?at=${encodeURIComponent(future.toISOString())}`);
  const freeTable = avail.body.tables.find((t: any) => !t.isBooked && t.capacity >= 4);
  check("availability returns a free 4-seat table", !!freeTable);

  expectStatus("booking in the past rejected", await api("POST", "/api/customer/bookings", C, { tableId: freeTable.id, guestCount: 2, date: "2020-01-01T19:00:00Z" }), 400);
  expectStatus("booking too many guests rejected", await api("POST", "/api/customer/bookings", C, { tableId: freeTable.id, guestCount: 20, date: future }), 400);
  const booking = await api("POST", "/api/customer/bookings", C, { branchId: london.id, tableId: freeTable.id, guestCount: 3, date: future });
  expectStatus("customer books a table", booking, 201);
  check("new booking is PENDING", booking.body.status === "PENDING");
  const clash = new Date(future.getTime() + 60 * 60 * 1000);
  expectStatus("double booking same table → 409", await api("POST", "/api/customer/bookings", C, { tableId: freeTable.id, guestCount: 2, date: clash }), 409);
  const avail2 = await api("GET", `/api/public/branches/${london.id}?at=${encodeURIComponent(future.toISOString())}`);
  check("table shows as booked afterwards", avail2.body.tables.find((t: any) => t.id === freeTable.id).isBooked === true);

  // ---------- Customer: order on the booking ----------
  const menu = (await api("GET", `/api/menu/${london.id}`)).body;
  const steak = menu.find((m: any) => m.name === "Ribeye 300g");
  const chips = menu.find((m: any) => m.name === "Triple-Cooked Chips");
  const manMenu = (await api("GET", `/api/menu/${manchester.id}`)).body;

  expectStatus("order with another branch's item rejected", await api("POST", "/api/customer/orders", C, { bookingId: booking.body.id, items: [{ menuItemId: manMenu[0].id, quantity: 1 }] }), 400);
  expectStatus("order with no items rejected", await api("POST", "/api/customer/orders", C, { bookingId: booking.body.id, items: [] }), 400);
  const order = await api("POST", "/api/customer/orders", C, {
    bookingId: booking.body.id,
    items: [
      { menuItemId: steak.id, quantity: 2 },
      { menuItemId: chips.id, quantity: 1 },
      { menuItemId: chips.id, quantity: 1 },
    ],
  });
  expectStatus("customer places order", order, 201);
  check("order is PENDING", order.body.status === "PENDING");
  check("server computes the total", Math.abs(order.body.total - (steak.price * 2 + chips.price * 2)) < 0.001, `total=${order.body.total}`);
  check("duplicate lines merged", order.body.items.length === 2);

  // Someone else's booking
  const other = await api("POST", "/api/auth/login", undefined, { email: "emma.wilson@example.com", password: "password123" });
  expectStatus("customer cannot order on someone else's booking", await api("POST", "/api/customer/orders", other.body.token, { bookingId: booking.body.id, items: [{ menuItemId: steak.id, quantity: 1 }] }), 403);
  expectStatus("customer cannot cancel someone else's booking", await api("DELETE", `/api/customer/bookings/${booking.body.id}`, other.body.token), 403);

  // ---------- Chef: branch isolation + kitchen flow ----------
  const queue = await api("GET", "/api/chef/orders", tokens.CHEF);
  check("London chef sees the new order", queue.body.some((o: any) => o.id === order.body.id));
  check("chef queue only has PENDING/PREPARING", queue.body.every((o: any) => ["PENDING", "PREPARING"].includes(o.status)));
  check("chef queue only has own branch", queue.body.every((o: any) => o.branchId === london.id));

  const chefMan = await login("chef.manchester@steakz.com");
  const manQueue = await api("GET", "/api/chef/orders", chefMan);
  check("Manchester chef does NOT see the London order", !manQueue.body.some((o: any) => o.id === order.body.id));
  expectStatus("Manchester chef cannot mark London order done → 403", await api("PATCH", `/api/chef/orders/${order.body.id}/done`, chefMan), 403);

  expectStatus("cashier cannot deliver before kitchen is done", await api("PATCH", `/api/cashier/orders/${order.body.id}/deliver`, tokens.CASHIER), 400);
  const prep = await api("PATCH", `/api/chef/orders/${order.body.id}/preparing`, tokens.CHEF);
  expectStatus("chef marks PREPARING", prep, 200);
  expectStatus("booking can't be cancelled while food is being prepared", await api("DELETE", `/api/customer/bookings/${booking.body.id}`, C), 400);
  const done = await api("PATCH", `/api/chef/orders/${order.body.id}/done`, tokens.CHEF);
  expectStatus("chef marks DONE", done, 200);
  check("status DONE", done.body.status === "DONE");
  expectStatus("chef cannot mark DONE twice", await api("PATCH", `/api/chef/orders/${order.body.id}/done`, tokens.CHEF), 400);
  check("order left the kitchen queue", !(await api("GET", "/api/chef/orders", tokens.CHEF)).body.some((o: any) => o.id === order.body.id));

  // ---------- Cashier ----------
  const cashierMan = await login("cashier.manchester@steakz.com");
  expectStatus("Manchester cashier cannot deliver London order", await api("PATCH", `/api/cashier/orders/${order.body.id}/deliver`, cashierMan), 403);
  const delivered = await api("PATCH", `/api/cashier/orders/${order.body.id}/deliver`, tokens.CASHIER);
  expectStatus("cashier delivers", delivered, 200);
  check("status DELIVERED", delivered.body.status === "DELIVERED");
  const myOrders = await api("GET", "/api/customer/orders", C);
  check("customer sees live status DELIVERED", myOrders.body.find((o: any) => o.id === order.body.id)?.status === "DELIVERED");

  const lTables = detail.body.tables;
  const walkIn = await api("POST", "/api/cashier/orders", tokens.CASHIER, { tableId: lTables[0].id, items: [{ menuItemId: steak.id, quantity: 1 }] });
  expectStatus("cashier walk-in order", walkIn, 201);
  check("walk-in order PENDING, sent to kitchen", walkIn.body.status === "PENDING" && walkIn.body.table.tableNumber === 1);
  const manTables = (await api("GET", `/api/public/branches/${manchester.id}`)).body.tables;
  expectStatus("cashier cannot use another branch's table", await api("POST", "/api/cashier/orders", tokens.CASHIER, { tableId: manTables[0].id, items: [{ menuItemId: steak.id, quantity: 1 }] }), 403);
  expectStatus("cashier order needs table or booking", await api("POST", "/api/cashier/orders", tokens.CASHIER, { items: [{ menuItemId: steak.id, quantity: 1 }] }), 400);
  const doneFilter = await api("GET", "/api/cashier/orders?status=DONE", tokens.CASHIER);
  check("cashier ?status filter", doneFilter.status === 200 && doneFilter.body.every((o: any) => o.status === "DONE"));
  expectStatus("cashier today's bookings", await api("GET", "/api/cashier/bookings", tokens.CASHIER), 200);

  const todayBookings = (await api("GET", "/api/cashier/bookings", tokens.CASHIER)).body;
  if (todayBookings.length) {
    const bOrder = await api("POST", "/api/cashier/orders", tokens.CASHIER, { bookingId: todayBookings[0].id, items: [{ menuItemId: chips.id, quantity: 2 }] });
    expectStatus("cashier serves a booked customer", bOrder, 201);
    check("order linked to the booking's customer", bOrder.body.customer?.id === todayBookings[0].customer.id);
  }

  // ---------- Cancel a booking ----------
  const b2 = await api("POST", "/api/customer/bookings", C, { tableId: freeTable.id, guestCount: 2, date: new Date(future.getTime() + 5 * 3600 * 1000) });
  expectStatus("second booking", b2, 201);
  const pendingOrder = await api("POST", "/api/customer/orders", C, { bookingId: b2.body.id, items: [{ menuItemId: steak.id, quantity: 1 }] });
  const cancel = await api("DELETE", `/api/customer/bookings/${b2.body.id}`, C);
  expectStatus("customer cancels own booking", cancel, 200);
  check("booking CANCELLED", cancel.body.status === "CANCELLED");
  const afterCancel = (await api("GET", "/api/customer/orders", C)).body.find((o: any) => o.id === pendingOrder.body.id);
  check("its pending order is cancelled too", afterCancel?.status === "CANCELLED");
  expectStatus("cannot order on cancelled booking", await api("POST", "/api/customer/orders", C, { bookingId: b2.body.id, items: [{ menuItemId: steak.id, quantity: 1 }] }), 400);

  // ---------- Menu management ----------
  const BM = tokens.BRANCH_MANAGER;
  const newItem = await api("POST", "/api/menu", BM, { name: "Wagyu Special", description: "A5 wagyu", price: 79, category: "Steaks" });
  expectStatus("branch manager adds menu item", newItem, 201);
  check("item added to manager's own branch", newItem.body.branchId === london.id);
  expectStatus("branch manager cannot add to another branch", await api("POST", "/api/menu", BM, { name: "X item", price: 5, category: "Sides", branchId: manchester.id }), 403);
  expectStatus("menu validation", await api("POST", "/api/menu", BM, { name: "Y", price: -1 }), 400);
  const patched = await api("PATCH", `/api/menu/${newItem.body.id}`, BM, { price: 85, isAvailable: false });
  expectStatus("branch manager updates item", patched, 200);
  check("price & availability updated", patched.body.price === 85 && patched.body.isAvailable === false);
  expectStatus("unavailable item cannot be ordered", await api("POST", "/api/cashier/orders", tokens.CASHIER, { tableId: lTables[0].id, items: [{ menuItemId: newItem.body.id, quantity: 1 }] }), 400);
  expectStatus("branch manager cannot edit another branch's item", await api("PATCH", `/api/menu/${manMenu[0].id}`, BM, { price: 1 }), 403);
  expectStatus("admin must give branchId", await api("POST", "/api/menu", tokens.ADMIN, { name: "Admin item", price: 5, category: "Sides" }), 400);
  const adminItem = await api("POST", "/api/menu", tokens.ADMIN, { name: "Admin item", price: 5, category: "Sides", branchId: manchester.id });
  expectStatus("admin adds item to any branch", adminItem, 201);
  expectStatus("admin edits any item", await api("PATCH", `/api/menu/${adminItem.body.id}`, tokens.ADMIN, { price: 6 }), 200);

  const chefMenu = await api("GET", "/api/chef/menu", tokens.CHEF);
  check("chef menu = own branch", chefMenu.body.every((m: any) => m.branchId === london.id));
  expectStatus("chef cannot delete another branch's item", await api("DELETE", `/api/chef/menu/${adminItem.body.id}`, tokens.CHEF), 403);
  const del = await api("DELETE", `/api/chef/menu/${newItem.body.id}`, tokens.CHEF);
  expectStatus("chef deletes unused item", del, 200);
  check("unused item really deleted", del.body.deleted === true);
  const arch = await api("DELETE", `/api/chef/menu/${steak.id}`, tokens.CHEF);
  check("item with order history is archived instead", arch.status === 200 && arch.body.archived === true);
  await api("PATCH", `/api/menu/${steak.id}`, BM, { isAvailable: true }); // restore for the demo

  // ---------- Branch manager reports ----------
  const ov = await api("GET", "/api/branch-manager/overview", BM);
  check("overview has counts", ov.body.tables.total === 10 && ov.body.staff.total === 5 && typeof ov.body.revenueToday === "number");
  const staff = await api("GET", "/api/branch-manager/staff", BM);
  check("staff roster own branch with salaries", staff.body.staff.length === 5 && staff.body.totalSalaries > 0 && staff.body.staff.every((s: any) => s.branch.id === london.id));
  const bmb = await api("GET", `/api/branch-manager/bookings?date=${new Date().toISOString().slice(0, 10)}`, BM);
  check("today's bookings own branch", bmb.status === 200 && Array.isArray(bmb.body));
  expectStatus("bookings bad date", await api("GET", "/api/branch-manager/bookings?date=31-12-2026", BM), 400);
  const sales = await api("GET", "/api/branch-manager/sales", BM);
  check("branch sales", sales.body.allTime.revenue > 0 && sales.body.daily.length === 14 && sales.body.topItems.length === 5);
  const bmo = await api("GET", "/api/branch-manager/orders", BM);
  check("branch orders only own branch", bmo.body.every((o: any) => o.branchId === london.id));

  // ---------- HQ ----------
  const HQ = tokens.HQ_MANAGER;
  const hqo = await api("GET", "/api/hq/overview", HQ);
  check("HQ overview: all branches", hqo.body.branches.length >= 7 && hqo.body.totals.revenue > 0);
  const hqs = await api("GET", "/api/hq/sales", HQ);
  check("HQ revenue grouped by branch", hqs.body.byBranch.length === hqo.body.branches.length);
  const sumBranches = hqs.body.byBranch.reduce((a: number, b: any) => a + b.revenue, 0);
  check("branch revenues add up to total", Math.abs(sumBranches - hqs.body.totalRevenue) < 0.05, `${sumBranches} vs ${hqs.body.totalRevenue}`);
  const hqStaff = await api("GET", "/api/hq/staff", HQ);
  check("HQ staff global (35 branch staff + HQ)", hqStaff.body.headcount >= 36);
  const hqOrders = await api("GET", `/api/hq/orders?branchId=${manchester.id}&status=DELIVERED`, HQ);
  check("HQ orders filters", hqOrders.body.length > 0 && hqOrders.body.every((o: any) => o.branchId === manchester.id && o.status === "DELIVERED"));
  const hqAll = await api("GET", "/api/hq/orders", HQ);
  check("HQ sees orders from several branches", new Set(hqAll.body.map((o: any) => o.branchId)).size > 1);

  // ---------- Admin ----------
  const A = tokens.ADMIN;
  const bName = `Steakz Test ${Date.now()}`;
  const nb = await api("POST", "/api/admin/branches", A, { name: bName, address: "1 Test Road, Testville", tableCount: 6 });
  expectStatus("admin adds branch", nb, 201);
  check("new branch has 6 tables", nb.body._count.tables === 6);
  expectStatus("duplicate branch name", await api("POST", "/api/admin/branches", A, { name: bName, address: "1 Test Road, Testville" }), 409);
  expectStatus("admin lists branches", await api("GET", "/api/admin/branches", A), 200);

  expectStatus("staff without branch rejected", await api("POST", "/api/admin/users", A, { name: "No Branch", email: `nb.${Date.now()}@steakz.com`, password: "secret12", role: "CHEF" }), 400);
  const uEmail = `new.cashier.${Date.now()}@steakz.com`;
  const nu = await api("POST", "/api/admin/users", A, { name: "New Cashier", email: uEmail, password: "secret12", role: "CASHIER", branchId: nb.body.id, salary: 22000 });
  expectStatus("admin creates cashier", nu, 201);
  check("cashier assigned to branch", nu.body.branchId === nb.body.id);
  const hqUser = await api("POST", "/api/admin/users", A, { name: "HQ Two", email: `hq2.${Date.now()}@steakz.com`, password: "secret12", role: "HQ_MANAGER", branchId: nb.body.id });
  check("HQ manager has no branch even if one is sent", hqUser.status === 201 && hqUser.body.branchId === null);

  const nuToken = await login(uEmail, "secret12");
  expectStatus("new cashier can work", await api("GET", "/api/cashier/orders", nuToken), 200);

  const promoted = await api("PATCH", `/api/admin/users/${nu.body.id}/role`, A, { role: "BRANCH_MANAGER" });
  expectStatus("admin changes role", promoted, 200);
  check("role changed, branch kept", promoted.body.role === "BRANCH_MANAGER" && promoted.body.branchId === nb.body.id);
  expectStatus("role change takes effect immediately (old token → 403 on cashier route)", await api("GET", "/api/cashier/orders", nuToken), 403);
  expectStatus("…and grants the new role's access", await api("GET", "/api/branch-manager/overview", nuToken), 200);
  const moved = await api("PATCH", `/api/admin/users/${nu.body.id}/role`, A, { branchId: london.id });
  check("admin moves user to another branch", moved.body.branchId === london.id);

  expectStatus("admin disables user", await api("PATCH", `/api/admin/users/${nu.body.id}/disable`, A), 200);
  expectStatus("disabled user cannot log in", await api("POST", "/api/auth/login", undefined, { email: uEmail, password: "secret12" }), 403);
  expectStatus("disabled user's token stops working", await api("GET", "/api/auth/me", nuToken), 403);
  expectStatus("admin enables user", await api("PATCH", `/api/admin/users/${nu.body.id}/enable`, A), 200);
  expectStatus("re-enabled user can log in", await api("POST", "/api/auth/login", undefined, { email: uEmail, password: "secret12" }), 200);

  const adminMe = (await api("GET", "/api/auth/me", A)).body;
  expectStatus("admin cannot disable self", await api("PATCH", `/api/admin/users/${adminMe.id}/disable`, A), 403);
  expectStatus("admin cannot delete self", await api("DELETE", `/api/admin/users/${adminMe.id}`, A), 403);
  expectStatus("admin cannot demote self", await api("PATCH", `/api/admin/users/${adminMe.id}/role`, A, { role: "CUSTOMER" }), 403);

  const users = await api("GET", "/api/admin/users?role=CHEF", A);
  check("admin user filter by role", users.body.length >= 14 && users.body.every((u: any) => u.role === "CHEF" && !("password" in u)));

  expectStatus("admin deletes user", await api("DELETE", `/api/admin/users/${nu.body.id}`, A), 200);
  expectStatus("deleted user's token → 401", await api("GET", "/api/auth/me", nuToken), 401);
  expectStatus("delete missing user → 404", await api("DELETE", `/api/admin/users/${nu.body.id}`, A), 404);
  await api("DELETE", `/api/admin/users/${hqUser.body.id}`, A);
  // delete the test customer (and their bookings) too
  const testCustomer = (await api("GET", "/api/admin/users?role=CUSTOMER", A)).body.find((u: any) => u.email === email);
  expectStatus("admin deletes customer with history", await api("DELETE", `/api/admin/users/${testCustomer.id}`, A), 200);

  // ---------- Misc ----------
  expectStatus("unknown route → 404", await api("GET", "/api/nope"), 404);
  const bad = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad json" });
  check("malformed JSON → 400", bad.status === 400, `got ${bad.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  ✗ " + f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
