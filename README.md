# Telegram Broadcast Worker v6

A production-ready Node.js + TypeScript worker for handling Telegram broadcasts.  
Designed to run 24/7 on Railway alongside a Next.js application hosted on Vercel.

## Features

- ✅ TypeScript with strict type checking — compiles with `npm run build`
- 📦 Supabase integration (no Postgres RPC functions required)
- 🤖 Telegram Bot API integration
- 🔄 Automatic broadcast processing with configurable batch size
- 🛡️ Duplicate prevention via upsert with `onConflict: "broadcast_id,telegram_id"`
- ⏱️ Per-request delay to stay within Telegram rate limits
- 🔁 Flood-limit handling: waits `retry_after` seconds then retries once (429)
- 🔁 Temporary error retry: 500/502/503/504 are retried once after a short delay
- ⛔ Permanent error handling: 400/403/404 skip the user and increment failed_count
- 📊 Real-time progress tracking (success_count, failed_count, total_users)
- 🔒 Atomic lock claim using `locked_at` — safe for multiple workers
- 💓 Heartbeat after every batch — prevents stale-lock eviction on long broadcasts
- 🔓 Automatic stale lock recovery — locks older than 10 min are released automatically
- 🛑 Graceful shutdown: waits for the current batch to finish before exiting

## Database Schema

The worker uses these tables. All IDs are **text** — no UUID, no bigint, no number.

### `users`
| Column      | Type   | Notes           |
|-------------|--------|-----------------|
| telegram_id | text   | Primary key     |
| status      | text   | `'active'` etc. |

### `broadcast_logs`
| Column        | Type        | Notes                                      |
|---------------|-------------|--------------------------------------------|
| id            | text        | Primary key                                |
| message       | text        |                                            |
| image_url     | text        | Nullable                                   |
| status        | text        | `'running'` \| `'completed'` \| `'failed'` |
| total_users   | int4        |                                            |
| success_count | int4        |                                            |
| failed_count  | int4        |                                            |
| created_at    | timestamptz |                                            |
| locked_at     | timestamptz | Worker lock — add with migration below     |

**One-time migration** (run in Supabase SQL Editor if not already present):
```sql
ALTER TABLE broadcast_logs ADD COLUMN locked_at timestamptz;
```

### `broadcast_sent`
| Column       | Type        | Notes                                      |
|--------------|-------------|--------------------------------------------|
| broadcast_id | text        |                                            |
| telegram_id  | text        |                                            |
| sent_at      | timestamptz |                                            |

> The database already has a `UNIQUE (broadcast_id, telegram_id)` constraint on  
> `broadcast_sent`. No additional SQL is needed.

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable                    | Description                          |
|-----------------------------|--------------------------------------|
| `SUPABASE_URL`              | Your Supabase project URL            |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key            |
| `BOT_TOKEN`                 | Telegram Bot API token               |

## Usage

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (production)
npm start

# Type-check only
npm run type-check
```

## How It Works

1. **Claim** — worker atomically claims the oldest `running` broadcast with no lock
2. **Pending users** — loads all active users, fetches already-sent ids, filters in memory
3. **Send batch** — sends to each pending user with a 50 ms delay between messages
4. **Flood limit (429)** — waits the `retry_after` seconds supplied by Telegram, then retries once
5. **Temporary errors (5xx)** — waits 1 s then retries once; counts as failed if retry also fails
6. **Permanent errors (400/403/404)** — skips the user immediately, increments failed_count
7. **Counter accuracy** — reloads the broadcast row from DB before updating failed_count to avoid stale-read race conditions
8. **Heartbeat** — refreshes `locked_at` after each batch so long broadcasts aren't evicted
9. **Complete** — when no pending users remain, marks broadcast `completed` and releases lock
10. **Stale recovery** — any lock older than 10 min is automatically released before next claim
11. **Graceful shutdown** — SIGTERM/SIGINT waits for the current batch to finish before exiting
