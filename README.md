# Lexxus Backend

Node.js + Express + MongoDB API for the Lexxus 3D digital products
marketplace.

> Implementation plan, API spec, and data models live in
> [`../memory/`](../memory). Read those before changing anything.

---

## Quick start

```bash
# from repo root
docker-compose up -d              # mongo + redis + mailhog (Phase 15.2)

cd backend
cp .env.example .env              # fill in real values
npm install
npm run seed                      # imports mock data into Mongo
npm run dev                       # http://localhost:5000
```

Verify it's up:

```bash
curl http://localhost:5000/api/health
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start with `nodemon` (auto-reload). |
| `npm start` | Production start (`node src/server.js`). |
| `npm test` | Run all tests once. |
| `npm run test:watch` | Jest watch mode. |
| `npm run test:integration` | Only integration tests. |
| `npm run test:unit` | Only unit tests. |
| `npm run test:coverage` | Run with coverage report. |
| `npm run lint` | ESLint check. |
| `npm run lint:fix` | ESLint auto-fix. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier check. |
| `npm run seed` | Seed DB from `lexx-main/lib/data.ts` + `lexxdadmin-main/lib/mock.ts`. |
| `npm run seed:reset` | Drop DB then seed. |
| `npm run smoke` | Hit `/api/health` and `/api/products` to verify a deploy. |

## Folder layout

```
src/
├── app.js                Express factory
├── server.js             HTTP entry point
├── config/               env, db, redis, b2, logger
├── controllers/          one file per resource
├── middleware/           auth, error, rate-limit, validate, request-id, upload
├── models/               Mongoose schemas
├── routes/               Express routers (mounted at /api/*)
├── services/             auth, product, upload, download, payment (Zoho), mailer, cache, cdn
├── jobs/                 BullMQ workers (email, image processing, sweeper)
├── utils/                AppError, asyncHandler, slug, token helpers
└── validators/           zod schemas (request validation)

tests/
├── unit/                 unit tests (services, utils, validators)
├── integration/          Supertest + mongodb-memory-server
└── fixtures/             sample payloads, ZIPs, JSON
```

## Tech stack

See [`../memory/ARCHITECTURE.md`](../memory/ARCHITECTURE.md) for the
authoritative list.

- Node 20 LTS · Express 4 · Mongoose 8
- Redis (ioredis) — optional in dev, required in prod
- @aws-sdk/client-s3 → Backblaze B2
- jsonwebtoken · bcryptjs · helmet · cors · express-rate-limit · zod
- nodemailer · sharp · bullmq · winston · morgan
- Jest · Supertest · mongodb-memory-server · nock · ioredis-mock

## Environment variables

See [`.env.example`](./.env.example) for the full list with comments.

## Contributing checklist

Before opening a PR:

1. `npm run lint`
2. `npm test` (coverage thresholds in `package.json` → `jest`)
3. Update the relevant memory doc
   ([`../memory/`](../memory)) if API contract or schema changed.
4. Add a `PROGRESS.md` entry.
