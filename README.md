# Steakz backend

REST API for the Steakz Restaurant Portal: Express 5, TypeScript, Prisma, PostgreSQL, JWT and bcrypt.

## Live deployment

| What | Link |
| --- | --- |
| Website (frontend, Vercel) | https://steakz-frontend-omega.vercel.app |
| API (backend, Render) | https://steakz-backend-hk3f.onrender.com |
| Health check | https://steakz-backend-hk3f.onrender.com/api/health |
| Backend repository | https://github.com/rene052/steakz-backend |
| Frontend repository | https://github.com/rene052/steakz-frontend |

The backend runs on Render's free plan and sleeps when unused: the first request after a while can take about 50 seconds.

## Setup

```bash
cp .env.example .env     # set DATABASE_URL and JWT_SECRET
npm install
npm run db:push          # create the tables from prisma/schema.prisma
npm run dev              # http://localhost:5000  (first start: creates all roles + demo data)
```

Design documentation (architecture, ER diagram, process, security): [`docs/DESIGN.md`](docs/DESIGN.md).

| Script | Does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled server |
| `npm run db:push` | Sync the database with the Prisma schema |
| `npm run db:studio` | Browse the data in Prisma Studio |
| `npm run seed` | Load the demo data (7 branches, 45 users, ~1,600 orders) |
| `npm run test:api` | Run 324 end-to-end checks against the running server |
| `npm run test:postman` | Run the Postman collection with Newman (92 tests) |

## Postman

`postman/Steakz.postman_collection.json` holds every endpoint, grouped by role, and each request has tests. Import it into Postman together with `postman/Steakz-Local.postman_environment.json` (or the Production environment; check its `baseUrl`). Select the environment, then **Run collection**:

0. Log in as every role (the tokens are saved automatically)
1. Authentication
2. Public
3. Customer books and orders
4. Chef cooks
5. Waiter delivers and takes a walk-in order
6. Branch manager reports and menu
7. HQ
8. Admin users and branches
9. Access control (expected 401 and 403 errors)

## Project structure

```
prisma/schema.prisma     7 models: Branch, User, MenuItem, Table, Booking, Order, OrderItem
prisma/seed.ts           reload demo data (npm run seed)
src/lib/demoData.ts      all roles + demo data (auto-loaded on first start)
postman/                 Postman collection + environments
docs/                    DESIGN.md + diagrams
src/index.ts             starts the server and creates the admin on first start
src/app.ts               Express app: CORS, JSON, routes, error handling
src/middleware/auth.ts   verifyToken, requireRole, requireBranch
src/middleware/error.ts  turns errors into JSON (400/401/403/404/409/500)
src/routes/*.ts          one router per area (auth, public, menu, customer, chef, cashier, branch-manager, hq, admin)
src/utils/               validation helpers, order pricing, sales reports
tests/api.test.ts        access-control matrix plus the business-flow test
```

## Endpoints

✓ = allowed. Every other role gets `403 Forbidden`, and a request without a token gets `401 Unauthorized`.

| Method | URL | Who |
|---|---|---|
| POST | `/api/auth/register` | public (always creates a CUSTOMER) |
| POST | `/api/auth/login` | public (returns `{ token, user }`) |
| GET | `/api/auth/me` | any logged-in user |
| GET | `/api/public/branches` | public |
| GET | `/api/public/branches/:id` (`?at=ISO` marks booked tables) | public |
| GET | `/api/menu/:branchId` | public |
| POST | `/api/menu` | BRANCH_MANAGER (own branch), ADMIN (`branchId` required) |
| PATCH | `/api/menu/:id` | BRANCH_MANAGER (own branch), ADMIN |
| GET / POST | `/api/customer/bookings` | CUSTOMER |
| DELETE | `/api/customer/bookings/:id` | CUSTOMER (own booking; sets it CANCELLED) |
| GET / POST | `/api/customer/orders` | CUSTOMER (orders must be on own booking) |
| GET | `/api/chef/orders` | CHEF (own branch, PENDING and PREPARING) |
| PATCH | `/api/chef/orders/:id/preparing` | CHEF *(added)* |
| PATCH | `/api/chef/orders/:id/done` | CHEF |
| GET | `/api/chef/menu` | CHEF |
| DELETE | `/api/chef/menu/:id` | CHEF (own branch) |
| POST / GET | `/api/cashier/orders` (`?status=`) | CASHIER (own branch) |
| PATCH | `/api/cashier/orders/:id/deliver` | CASHIER (only DONE → DELIVERED) |
| GET | `/api/cashier/bookings` | CASHIER *(added: today's bookings)* |
| GET | `/api/branch-manager/overview \| orders \| staff \| bookings \| sales` | BRANCH_MANAGER |
| GET | `/api/hq/overview \| orders \| staff \| sales` | HQ_MANAGER, ADMIN |
| GET / POST | `/api/admin/branches` | ADMIN |
| GET / POST | `/api/admin/users` | ADMIN |
| PATCH | `/api/admin/users/:id/role \| disable \| enable` | ADMIN |
| DELETE | `/api/admin/users/:id` | ADMIN |
| GET | `/api/health` | public |

### Order status flow

```
PENDING ──(chef: preparing, optional)──> PREPARING ──(chef: done)──> DONE ──(cashier: deliver)──> DELIVERED
   └──(customer cancels the booking)──> CANCELLED
```

### Example requests

```bash
# log in
curl -X POST localhost:5000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"chef.london@steakz.com","password":"password123"}'

# use the token
curl localhost:5000/api/chef/orders -H "Authorization: Bearer <token>"

# cashier creates a walk-in order
curl -X POST localhost:5000/api/cashier/orders -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" -d '{"tableId":1,"items":[{"menuItemId":4,"quantity":2}]}'
```
