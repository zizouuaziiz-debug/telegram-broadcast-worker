import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { BroadcastLog, User } from "./types";

/**
 * Required one-time setup in Supabase SQL Editor
 * ─────────────────────────────────────────────
 *
 * 1. Lock column (worker-only — never shown in admin panel):
 *
 *    ALTER TABLE broadcast_logs ADD COLUMN locked_at timestamptz;
 *
 * 2. UNIQUE constraint on broadcast_sent (duplicate-safe insertSent):
 *
 *    ALTER TABLE broadcast_sent
 *      ADD CONSTRAINT broadcast_sent_unique
 *      UNIQUE (broadcast_id, telegram_id);
 */

export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }

    this.client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /**
   * Release stale locks older than `thresholdMinutes`.
   *
   * Called automatically before every claim attempt so stale locks left behind
   * by a crashed worker are cleared without manual SQL intervention.
   */
  private async releaseStaleLocksIfAny(thresholdMinutes = 10): Promise<void> {
    const cutoff = new Date(
      Date.now() - thresholdMinutes * 60 * 1000
    ).toISOString();

    const { error } = await this.client
      .from("broadcast_logs")
      .update({ locked_at: null })
      .eq("status", "running")
      .not("locked_at", "is", null)
      .lt("locked_at", cutoff);

    if (error) throw error;
  }

  /**
   * Atomically claim the oldest unlocked 'running' broadcast.
   *
   * First releases any stale locks (>10 min old) so a crashed worker never
   * blocks future runs — no manual SQL intervention required.
   *
   * Step 1 — release stale locks.
   * Step 2 — find a candidate row (status='running', locked_at IS NULL).
   * Step 3 — UPDATE that specific row setting locked_at = NOW(),
   *           guarded by locked_at IS NULL.
   *
   * If two workers race on step 3, only one UPDATE succeeds (the other finds
   * locked_at already set and returns null). Status stays 'running' the whole
   * time — the admin panel is never affected.
   */
  async claimBroadcast(): Promise<BroadcastLog | null> {
    // Step 1: release stale locks before attempting a claim
    await this.releaseStaleLocksIfAny();

    // Step 2: find candidate
    const { data: candidate, error: selectError } = await this.client
      .from("broadcast_logs")
      .select("id")
      .eq("status", "running")
      .is("locked_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) throw selectError;
    if (!candidate) return null;

    // Step 3: atomic claim — only succeeds if locked_at is still NULL
    const { data, error } = await this.client
      .from("broadcast_logs")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", (candidate as { id: string }).id)
      .is("locked_at", null)
      .select()
      .maybeSingle();

    if (error) throw error;
    return (data as BroadcastLog) ?? null;
  }

  /** Fetch the full broadcast row by id. */
  async getBroadcast(broadcastId: string): Promise<BroadcastLog | null> {
    const { data, error } = await this.client
      .from("broadcast_logs")
      .select("*")
      .eq("id", broadcastId)
      .maybeSingle();

    if (error) throw error;
    return (data as BroadcastLog) ?? null;
  }

  /**
   * Return up to `limit` users who have NOT yet received this broadcast.
   *
   * Algorithm (no Postgres RPC required):
   * 1. Fetch all active users from public.users.
   * 2. Fetch all broadcast_sent rows for this broadcast.
   * 3. Build a Set of already-sent telegram_id strings.
   * 4. Filter users whose telegram_id is not in the set.
   * 5. Return the first `limit` entries.
   *
   * With ~2 400 users this is fast enough and avoids any RPC dependency.
   */
  async getPendingUsers(broadcastId: string, limit: number): Promise<User[]> {
    // 1. All active users
    const { data: users, error: usersError } = await this.client
      .from("users")
      .select("telegram_id")
      .eq("status", "active");

    if (usersError) throw usersError;
    if (!users || users.length === 0) return [];

    // 2. Already-sent telegram_ids for this broadcast
    const { data: sent, error: sentError } = await this.client
      .from("broadcast_sent")
      .select("telegram_id")
      .eq("broadcast_id", broadcastId);

    if (sentError) throw sentError;

    // 3. Build a lookup Set
    const sentSet = new Set<string>(
      (sent ?? []).map((row: { telegram_id: string }) => row.telegram_id)
    );

    // 4 & 5. Filter and return first `limit` pending users
    }
const pending: User[] = [];

for (const user of users as User[]) {
  if (!sentSet.has(user.telegram_id)) {
    pending.push(user);

    if (pending.length >= limit) {
      break;
    }
  } 
}
            
// أضف هذا
console.log("==================================");
console.log("Active users:", users.length);
console.log("Already sent:", sentSet.size);
console.log("Pending users:", pending.length);

if (pending.length > 0) {
  console.log("First pending:", pending[0].telegram_id);
}
console.log("==================================");

return pending;
  }

  /**
   * Record a successful send.
   *
   * Uses upsert with onConflict so duplicate sends are silently ignored
   * (the DB already has a UNIQUE constraint on broadcast_id, telegram_id).
   */
  async insertSent(broadcastId: string, telegramId: string): Promise<void> {
    const { error } = await this.client.from("broadcast_sent").upsert(
      {
        broadcast_id: broadcastId,
        telegram_id: telegramId,
        sent_at: new Date().toISOString(),
      },
      { onConflict: "broadcast_id,telegram_id" }
    );

    if (error) throw error;
  }

  /** Count of all active users (used for total_users in progress updates). */
  async getActiveUsersCount(): Promise<number> {
    const { count, error } = await this.client
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    if (error) throw error;
    return count ?? 0;
  }

  /** Count of successfully sent messages for this broadcast. */
  async getSentCount(broadcastId: string): Promise<number> {
    const { count, error } = await this.client
      .from("broadcast_sent")
      .select("*", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId);

    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Refresh locked_at to the current time so stale-lock recovery
   * never evicts an actively running worker.
   * Call this after every batch.
   */
  async heartbeat(broadcastId: string): Promise<void> {
    const { error } = await this.client
      .from("broadcast_logs")
      .update({ locked_at: new Date().toISOString() })
      .eq("id", broadcastId);

    if (error) throw error;
  }

  async updateProgress(
    broadcastId: string,
    success: number,
    failed: number,
    total: number
  ): Promise<void> {
    const { error } = await this.client
      .from("broadcast_logs")
      .update({
        success_count: success,
        failed_count: failed,
        total_users: total,
      })
      .eq("id", broadcastId);

    if (error) throw error;
  }

  /** Mark broadcast completed and release the lock. */
  async complete(broadcastId: string): Promise<void> {
    const { error } = await this.client
      .from("broadcast_logs")
      .update({ status: "completed", locked_at: null })
      .eq("id", broadcastId);

    if (error) throw error;
  }

  /** Mark broadcast failed and release the lock. */
  async fail(broadcastId: string): Promise<void> {
    const { error } = await this.client
      .from("broadcast_logs")
      .update({ status: "failed", locked_at: null })
      .eq("id", broadcastId);

    if (error) throw error;
  }
}
