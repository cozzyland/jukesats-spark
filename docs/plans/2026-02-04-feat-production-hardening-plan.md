---
title: "feat: Production Hardening for Jukesats Server"
type: feat
date: 2026-02-04
---

# Production Hardening for Jukesats Server

## Overview

Harden the Jukesats reward server (`server/`) for production use. The server currently runs with in-memory state (lost on restart), no test suite, open CORS, verbose error responses, and no concurrency control. This plan addresses all of these through 6 sequential sub-phases: test infrastructure, SQLite persistence, concurrency control, security hardening, Fly.io config tuning, and CI/CD with linting.

## Problem Statement

The server works but has critical production gaps:

1. **No tests** -- zero test coverage; no way to verify changes don't break the reward flow
2. **In-memory state** -- all tap records, rate-limit data, and stats are lost on every deploy or restart (`server/src/tapTracker.ts:20-23`)
3. **No concurrency control** -- concurrent taps for the same user can bypass rate limits and double-spend
4. **Security gaps** -- global CORS (`main.ts:14`), string comparison for admin auth (`main.ts:55`), no body size limit (`main.ts:15`), `/health` leaks balance info (`main.ts:72-88`), `/stats` is unauthenticated (`main.ts:268-272`)
5. **No graceful shutdown** -- background tasks (VTXO maintenance, fund listener) aren't cleaned up on SIGTERM
6. **No CI** -- no linting, no automated test runs, no build verification
7. **Package issues** -- name typo (`jukestats` vs `jukesats`), unpinned TypeScript, lock file excluded from git

## Proposed Solution

Six sequential sub-phases, each ending with `npm test` + `npm run build` green. TDD approach throughout.

## Technical Approach

### Architecture

```
Sub-Phase 4.1: Test Infrastructure
  └── Vitest + Supertest, export app/tapTracker, unit + integration tests

Sub-Phase 4.2: SQLite Persistence
  └── better-sqlite3, WAL mode, TapTracker rewrite with prepared statements

Sub-Phase 4.3: Concurrency Control
  └── Promise-based mutex, pending/completed/failed tap states, idempotency keys

Sub-Phase 4.4: Security Hardening
  └── CORS restriction, timing-safe auth, helmet, body limits, graceful shutdown, non-root Docker

Sub-Phase 4.5: Fly.io Config + Performance
  └── Suspend vs stop, min 1 machine, exponential backoff, remove post-send getBalance

Sub-Phase 4.6: CI/CD + Linting
  └── ESLint flat config, GitHub Actions, package.json fixes, lock file in git
```

### Implementation Phases

---

#### Phase 4.1: Test Infrastructure + First Tests

**Goal:** Get `npm test` running with meaningful coverage before changing any business logic.

**Tasks:**

- [x] **`server/package.json` -- add deps and scripts** (`server/package.json`)
  - Add `devDependencies`: `vitest`, `supertest`, `@types/supertest`
  - Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`

- [x] **Create `server/vitest.config.ts`** (new file)
  - Minimal config: `include: ['src/**/__tests__/**/*.test.ts']`, environment: `node`

- [x] **`server/tsconfig.json` -- exclude tests from build** (`server/tsconfig.json:15`)
  - Change `exclude` from `["node_modules", "dist"]` to `["node_modules", "dist", "src/**/__tests__"]`

- [x] **`server/src/main.ts` -- export app, don't auto-start** (`server/src/main.ts`)
  - Line 11: `const app` -> `export const app`
  - Line 34: `const tapTracker` -> `export const tapTracker`
  - Lines 37-43: Add `export` to config constants (`DEFAULT_REWARD_SATS`, `TAP_COOLDOWN_MS`, `ADMIN_TOKEN`, `ALLOWED_VENUES`, `DAILY_SPEND_CAP_SATS`, `IP_RATE_LIMIT_MAX`, `ENABLE_SIMULATE_TAP`)
  - Line 175: Add `export` to `processTap()`
  - Line 310: Add `export` to `start()`
  - **Delete line 342** (`start()` call) -- bootstrap.ts will call it instead

- [x] **`server/src/bootstrap.ts` -- call start()** (`server/src/bootstrap.ts:12`)
  - Replace `import('./main.js')` with:
    ```typescript
    const { start } = await import('./main.js')
    await start()
    ```

- [x] **Create `server/src/__tests__/tapTracker.test.ts`** (new file)
  - Pure unit tests (no mocks needed):
    - `canTap`: first tap allowed, blocked within cooldown, allowed at different venue, allowed after cooldown (`vi.useFakeTimers`)
    - `canTapFromIp`: first tap allowed, blocked after max taps
    - `getTodaySpend`: 0 with no taps, correct sum after taps
    - `getUserStats`: empty for unknown user, correct aggregation after taps

- [x] **Create `server/src/__tests__/main.test.ts`** (new file)
  - Integration tests with `vi.mock('../hotWallet.js')` (mock the wallet module, not business logic):
    - Set env vars before import: `ADMIN_TOKEN`, `ALLOWED_VENUES`, `ENABLE_SIMULATE_TAP`
    - `GET /health`: returns 200 with status ok
    - `POST /tap`: rejects missing fields (400), rejects invalid address (400), rejects unknown venue (400), processes valid tap (200)
    - Admin endpoints: rejects unauthenticated (401), allows authenticated (200)
    - `POST /simulate-tap`: returns 404 when disabled

- [x] **Run `cd server && npm install && npm test`**

**Success Criteria:**
- `npm test` -- all green
- `npm run build` -- no test files in `dist/`
- `npm run dev` -- server starts normally via bootstrap

---

#### Phase 4.2: SQLite Persistence

**Goal:** Replace in-memory `TapTracker` with SQLite so tap data survives restarts.

**Tasks:**

- [x] **`server/package.json` -- add better-sqlite3** (`server/package.json`)
  - Add dependency: `better-sqlite3` (~11.0)
  - Add devDependency: `@types/better-sqlite3` (~7.6)

- [x] **Create `server/src/db.ts`** (new file)
  - Export `createDb(dbPath?: string): Database.Database`
  - Enable WAL mode, foreign keys
  - Schema: `taps` table with columns:
    - `id` INTEGER PRIMARY KEY AUTOINCREMENT
    - `user_ark_address` TEXT NOT NULL
    - `venue_id` TEXT NOT NULL
    - `nfc_tag_id` TEXT NOT NULL
    - `reward_sats` INTEGER NOT NULL
    - `ip` TEXT NOT NULL
    - `status` TEXT NOT NULL DEFAULT 'completed'
    - `txid` TEXT
    - `idempotency_key` TEXT UNIQUE
    - `created_at` INTEGER NOT NULL (ms timestamp)
  - Indexes on: `user_ark_address`, `venue_id`, `ip`, `created_at`, composite `(user_ark_address, venue_id, created_at)`
  - `DB_PATH` from env var, default `./data/jukesats.db`

- [x] **Rewrite `server/src/tapTracker.ts`** (`server/src/tapTracker.ts`)
  - Constructor: `constructor(db: Database.Database)` -- creates prepared statements
  - Same public API, all methods unchanged from caller's perspective
  - Internals: SQL queries replace arrays/Maps
  - Prepared statements for: insert, lastTapAtVenue, ipTapsLastHour, todaySpend, userStats, venueStats
  - No manual cleanup needed (SQL filters by time range)

- [x] **Update `server/src/main.ts`** (`server/src/main.ts:34`)
  - Import `createDb` from `./db.js`
  - Replace `new TapTracker()` with `const db = createDb(); export const tapTracker = new TapTracker(db)`

- [x] **Update tests** (`server/src/__tests__/tapTracker.test.ts`, `server/src/__tests__/main.test.ts`)
  - `tapTracker.test.ts`: use `createDb(':memory:')`, close db in `afterEach`
  - `main.test.ts`: mock `../db.js` to return `:memory:` db

- [x] **Add `DB_PATH` to `server/fly.toml`** (`server/fly.toml` [env] section)
  - `DB_PATH = "/data/jukesats.db"`

**Success Criteria:**
- All existing tests still pass
- `npm run build` succeeds
- Tap data persists across server restarts (verified by restarting dev server)

---

#### Phase 4.3: Concurrency Control

**Goal:** Prevent double-spend from concurrent taps and support idempotent retries.

**Tasks:**

- [x] **Add Mutex class to `server/src/main.ts`** (`server/src/main.ts`)
  - Simple promise-based mutex (no external package):
    ```typescript
    class Mutex {
      private _lock: Promise<void> = Promise.resolve()
      async acquire(): Promise<() => void> {
        let release: () => void
        const next = new Promise<void>(r => { release = r })
        const prev = this._lock
        this._lock = next
        await prev
        return release!
      }
    }
    const tapMutex = new Mutex()
    ```

- [x] **Add lifecycle methods to `server/src/tapTracker.ts`** (`server/src/tapTracker.ts`)
  - `beginTap(address, venue, tag, sats, ip, idempotencyKey?)`: INSERT with `status='pending'`, return tap id
  - `completeTap(tapId, txid)`: UPDATE `status='completed'`, set txid
  - `failTap(tapId, errorMessage?)`: UPDATE `status='failed'`
  - `findByIdempotencyKey(key)`: SELECT completed tap by key
  - Update rate-limit queries to exclude `status='failed'` taps

- [x] **Refactor `processTap` in `server/src/main.ts`** (`server/src/main.ts:175-233`)
  - New flow:
    ```
    acquire mutex ->
      check venue whitelist
      check IP rate limit
      check per-address rate limit
      check daily spend cap
      beginTap() (INSERT pending)
    release mutex ->
    sendReward() (slow network call, outside mutex)
    completeTap() or failTap()
    ```
  - Idempotency: check `Idempotency-Key` header, return cached result if exists

- [x] **Update POST /tap route** (`server/src/main.ts:238-263`)
  - Pass idempotency key from request header to `processTap`

- [x] **Add concurrency tests** (`server/src/__tests__/main.test.ts`)
  - Fire 2 concurrent taps for same user/venue: one 200, one 429
  - Failed send: tap recorded with `status='failed'`

**Success Criteria:**
- All tests pass
- Concurrent taps properly serialized (only one succeeds per cooldown window)

---

#### Phase 4.4: Security Hardening

**Goal:** Close all known security gaps for production deployment.

All changes to `server/src/main.ts` unless noted.

**Tasks:**

- [x] **CORS restriction** (`server/src/main.ts:14`)
  - `app.use(cors())` -> `app.use(cors({ origin: (env CORS_ORIGIN || 'https://cozzyland.net').split(','), methods: ['GET','POST'] }))`

- [x] **Trust proxy** (`server/src/main.ts:17`)
  - `app.set('trust proxy', true)` -> `app.set('trust proxy', 1)` (trust only Fly.io edge, not arbitrary proxy chain)

- [x] **Timing-safe admin auth** (`server/src/main.ts:48-60`)
  - Import `timingSafeEqual` from `crypto`
  - Replace string `!==` with Buffer comparison + `timingSafeEqual`
  - Handle length mismatch (different-length buffers = reject without timing leak)

- [x] **Simplify /health** (`server/src/main.ts:72-88`)
  - Return only `{ status: 'ok' }` -- remove balance info from public endpoint
  - Catch errors -> `{ status: 'error' }`

- [x] **Protect /stats** (`server/src/main.ts:268-272`)
  - Add `requireAdmin` middleware to `GET /stats/:userArkAddress`

- [x] **Generic error responses** (all public-facing error handlers)
  - Remove `error.message` from all public-facing error responses
  - Log details server-side only
  - Admin-only endpoints can keep detailed errors

- [x] **Body size limit** (`server/src/main.ts:15`)
  - `app.use(express.json())` -> `app.use(express.json({ limit: '16kb' }))`

- [x] **Helmet** (`server/package.json`, `server/src/main.ts`)
  - Add `helmet` to dependencies
  - `app.use(helmet())` before routes

- [x] **Graceful shutdown** (`server/src/main.ts:310-340`, in `start()`)
  ```typescript
  const server = app.listen(PORT, ...)
  const shutdown = async (signal: string) => {
    server.close(() => { db.close(); process.exit(0) })
    setTimeout(() => process.exit(1), 10_000)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  ```

- [x] **Dockerfile non-root user** (`server/Dockerfile`)
  - Use `node` user (built into `node:22-slim`)
  - Add `entrypoint.sh` that fixes `/data` volume permissions then `exec gosu node "$@"`
  - Install `gosu` in Dockerfile

- [x] **Update tests for security changes** (`server/src/__tests__/main.test.ts`)
  - Health returns only `{ status: 'ok' }` (no balance fields)
  - `/stats` returns 401 without auth
  - Error responses contain no `message` field

**Success Criteria:**
- All tests pass
- `npm run build` clean
- No sensitive data leaked in public responses

---

#### Phase 4.5: Fly.io Config + Performance

**Goal:** Prevent cold-start latency and improve resilience.

**Tasks:**

- [x] **`server/fly.toml` -- machine management** (`server/fly.toml:19-21`)
  - `auto_stop_machines = 'suspend'` (was `'stop'`) -- keeps machine in memory, ~1s resume vs ~10s cold boot
  - `min_machines_running = 1` (was `0`) -- always one machine warm

- [x] **`server/src/hotWallet.ts` -- remove post-send getBalance** (`server/src/hotWallet.ts:244-246`)
  - Delete the `const newBalance = await this.wallet.getBalance()` block after successful send
  - This is a redundant network call that slows down every tap response

- [x] **`server/src/hotWallet.ts` -- exponential backoff** (`server/src/hotWallet.ts:129-131`)
  - In `listenForIncomingFunds`, replace fixed 5s retry:
    ```typescript
    let backoffMs = 1000
    // on error: await sleep(backoffMs); backoffMs = Math.min(backoffMs * 2, 60_000)
    // on success: backoffMs = 1000
    ```

**Success Criteria:**
- Server starts and operates correctly
- `fly.toml` changes are valid syntax
- Error recovery uses escalating backoff instead of hammering every 5s

---

#### Phase 4.6: CI/CD + Linting

**Goal:** Automated quality gates on every push.

**Tasks:**

- [x] **Fix `server/package.json`** (`server/package.json:2,24`)
  - Name: `"jukestats-server"` -> `"jukesats-server"` (fix typo)
  - Pin TypeScript: `"^5.4.0"` -> `"5.4.5"` (exact version for reproducibility)

- [x] **`.gitignore` -- remove lock file exclusion** (`.gitignore:48`)
  - Delete `server/package-lock.json` line
  - Run `cd server && npm install` to generate lock file

- [x] **ESLint setup** (`server/package.json`, `server/eslint.config.mjs`)
  - Add devDeps: `eslint`, `@eslint/js`, `typescript-eslint`
  - Create `server/eslint.config.mjs`: flat config with `@typescript-eslint/recommended`
  - Add scripts: `"lint": "eslint src/"`, `"lint:fix": "eslint src/ --fix"`

- [x] **Create `.github/workflows/server-ci.yml`** (new file)
  ```yaml
  name: Server CI
  on:
    push:
      paths: ['server/**']
    pull_request:
      paths: ['server/**']
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 22
        - run: npm ci
          working-directory: server
        - run: npm run lint
          working-directory: server
        - run: npm run build
          working-directory: server
        - run: npm test
          working-directory: server
  ```

- [x] **Fix lint errors** (various files)

**Success Criteria:**
- `npm run lint` passes
- `npm run build` passes
- `npm test` passes
- CI green on push

---

## Files Summary

| File | Action | Sub-Phases |
|------|--------|------------|
| `server/package.json` | Modify | 4.1, 4.2, 4.4, 4.6 |
| `server/tsconfig.json` | Modify | 4.1 |
| `server/vitest.config.ts` | Create | 4.1 |
| `server/src/bootstrap.ts` | Modify | 4.1 |
| `server/src/main.ts` | Modify | 4.1, 4.2, 4.3, 4.4 |
| `server/src/tapTracker.ts` | Rewrite | 4.2, 4.3 |
| `server/src/db.ts` | Create | 4.2 |
| `server/src/hotWallet.ts` | Modify | 4.5 |
| `server/src/__tests__/tapTracker.test.ts` | Create | 4.1, 4.2, 4.3 |
| `server/src/__tests__/main.test.ts` | Create | 4.1, 4.2, 4.3, 4.4 |
| `server/Dockerfile` | Modify | 4.4 |
| `server/entrypoint.sh` | Create | 4.4 |
| `server/fly.toml` | Modify | 4.2, 4.5 |
| `server/eslint.config.mjs` | Create | 4.6 |
| `.github/workflows/server-ci.yml` | Create | 4.6 |
| `.gitignore` | Modify | 4.6 |
| `server/.env.example` | Modify | 4.2, 4.4 |

## Acceptance Criteria

### Functional Requirements

- [x] `npm test` passes with unit tests for TapTracker and integration tests for all endpoints
- [x] Tap data persists across server restarts (SQLite with WAL mode)
- [x] Concurrent taps for same user/venue are serialized (only one succeeds per cooldown)
- [x] Idempotent tap retries return cached result instead of double-spending
- [x] Failed sends are recorded with `status='failed'` and don't count toward rate limits

### Non-Functional Requirements

- [x] CORS restricted to `cozzyland.net` (configurable via `CORS_ORIGIN` env var)
- [x] Admin auth uses timing-safe comparison (no timing side-channel)
- [x] `/health` returns only `{ status: 'ok' }` (no balance leak)
- [x] `/stats` requires admin auth
- [x] Public error responses contain no internal details
- [x] Request body limited to 16kb
- [x] Helmet security headers applied
- [x] Docker container runs as non-root `node` user
- [x] Graceful shutdown closes HTTP server and SQLite connection
- [x] Fly.io machine suspends instead of stopping (faster resume)
- [x] At least 1 machine always running (no cold starts)
- [x] Fund listener uses exponential backoff (1s -> 60s max)

### Quality Gates

- [x] `npm run lint` passes (ESLint with typescript-eslint)
- [x] `npm run build` succeeds (no test files in dist/)
- [x] `npm test` all green
- [x] GitHub Actions CI passes on push to main

## Dependencies & Prerequisites

- `better-sqlite3` -- native SQLite binding for Node.js (requires build tools in Docker)
- `helmet` -- Express security headers middleware
- `gosu` -- privilege de-escalation in Docker entrypoint
- `vitest` + `supertest` -- test framework and HTTP assertion library
- `eslint` + `typescript-eslint` -- linting

No changes to the mobile app (`App.tsx`, `src/wallet.ts`). All changes are server-side.

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| `better-sqlite3` native build fails in Docker | Blocks 4.2 | `node:22-slim` includes build tools; fallback to `node:22` if needed |
| SQLite migration loses in-memory data | Low -- current data is ephemeral anyway | Migration happens on deploy; no data to preserve |
| Mutex deadlock on crash during `processTap` | Stuck taps | Mutex auto-releases when promise resolves; `failTap()` marks orphaned pending taps |
| CORS change breaks mobile app | App uses direct fetch, not browser CORS | Mobile apps don't enforce CORS; only browser requests affected |
| Timing-safe auth breaks admin endpoints | Lost admin access | Test coverage ensures auth works before deploy |

## Execution Order

```
4.1 (tests) -> 4.2 (SQLite) -> 4.3 (concurrency) -> 4.4 (security) -> 4.5 (Fly.io) -> 4.6 (CI/CD)
```

Each sub-phase ends with `npm test` + `npm run build` green. No phase begins until the prior phase is verified.

## References

### Internal References

- Current TapTracker (in-memory): `server/src/tapTracker.ts:20-23`
- Current CORS setup: `server/src/main.ts:14`
- Current admin auth: `server/src/main.ts:48-60`
- Current /health endpoint: `server/src/main.ts:72-88`
- Current /stats endpoint: `server/src/main.ts:268-272`
- Current processTap: `server/src/main.ts:175-233`
- Current start(): `server/src/main.ts:310-342`
- Current bootstrap: `server/src/bootstrap.ts:12`
- Post-send getBalance: `server/src/hotWallet.ts:244-246`
- Fixed 5s retry: `server/src/hotWallet.ts:129-131`
- Package name typo: `server/package.json:2`
- Lock file exclusion: `.gitignore:48`
- Fly.io machine config: `server/fly.toml:19-21`
