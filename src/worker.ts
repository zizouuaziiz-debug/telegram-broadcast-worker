import { SupabaseService } from "./supabase";
import { TelegramService } from "./telegram";
import { BroadcastLog } from "./types";

const REQUEST_DELAY_MS = 50;
const POLL_INTERVAL_MS = 3000;
const TEMP_ERROR_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BroadcastWorker {
  private supabase: SupabaseService;
  private telegram: TelegramService;
  private batchSize: number;
  private shuttingDown = false;

  constructor(
    supabase: SupabaseService,
    telegram: TelegramService,
    batchSize = 50
  ) {
    this.supabase = supabase;
    this.telegram = telegram;
    this.batchSize = batchSize;
  }

  /**
   * Signal the worker to stop after the current batch finishes.
   * Returns a promise that resolves once run() has exited its loop.
   * Call this from signal handlers and await it before process.exit().
   */
  async shutdown(): Promise<void> {
    console.log("Shutdown requested — waiting for current batch to finish...");
    this.shuttingDown = true;
  }

  async run(): Promise<void> {
    console.log("Worker started, polling for broadcasts...");

    // Track the broadcast this worker claimed so we don't re-claim on every
    // batch iteration. Reset to null after completion or failure.
    let currentBroadcastId: string | null = null;

    while (!this.shuttingDown) {
      try {
        let broadcast: BroadcastLog | null;

        if (currentBroadcastId !== null) {
          // Refresh the row we already own (get latest counts from DB).
          broadcast = await this.supabase.getBroadcast(currentBroadcastId);

          // Guard against a row that disappeared or finished externally.
          if (!broadcast || broadcast.status !== "running") {
            console.log(
              `Broadcast ${currentBroadcastId} is no longer running, resetting.`
            );
            currentBroadcastId = null;
            await sleep(POLL_INTERVAL_MS);
            continue;
          }
        } else {
          // Atomically claim the next available broadcast via locked_at.
          // Only one worker wins the race; the other gets null.
          broadcast = await this.supabase.claimBroadcast();

          if (!broadcast) {
            await sleep(POLL_INTERVAL_MS);
            continue;
          }

          currentBroadcastId = broadcast.id;
          console.log(`Claimed broadcast ${broadcast.id}`);
        }

        // Get next batch of users who haven't received this broadcast yet.
        // Implemented in-memory inside SupabaseService — no Postgres RPC needed.
        const users = await this.supabase.getPendingUsers(
          broadcast.id,
          this.batchSize
        );

        if (users.length === 0) {
          // No pending users → broadcast is done.
          const total = await this.supabase.getActiveUsersCount();
          const sentCount = await this.supabase.getSentCount(broadcast.id);
          // Reload the latest broadcast to get the accurate failed_count,
          // since it may have been updated during earlier batches.
          const latest = await this.supabase.getBroadcast(broadcast.id);
          const failedCount = latest?.failed_count ?? broadcast.failed_count;
          await this.supabase.updateProgress(
            broadcast.id,
            sentCount,
            failedCount,
            total
          );
          await this.supabase.complete(broadcast.id); // status='completed', locked_at=NULL
          console.log(
            `Broadcast ${broadcast.id} completed. Sent: ${sentCount}/${total}`
          );
          currentBroadcastId = null;
          continue;
        }

        // Send the batch.
        let batchSuccess = 0;
        let batchFailed = 0;

        for (const user of users) {
          const ok = await this.sendWithRetry(broadcast, user.telegram_id);

if (ok) {
  await this.supabase.insertSent(broadcast.id, user.telegram_id);
  batchSuccess++;
} else {
  batchFailed++;
}

await sleep(REQUEST_DELAY_MS);
        }

        // Reload the latest broadcast row to get the accurate failed_count
        // before adding this batch's failures. This prevents stale-read race
        // conditions when updating cumulative counters.
        const latestForUpdate = await this.supabase.getBroadcast(broadcast.id);
        const baseFailed =
          latestForUpdate?.failed_count ?? broadcast.failed_count;
        const cumulativeFailed = baseFailed + batchFailed;

        const total = await this.supabase.getActiveUsersCount();
        const sentCount = await this.supabase.getSentCount(broadcast.id);
        await this.supabase.updateProgress(
          broadcast.id,
          sentCount,
          cumulativeFailed,
          total
        );

        // Refresh the lock timestamp so stale-lock recovery never evicts
        // an actively running worker (heartbeat).
        await this.supabase.heartbeat(broadcast.id);

        console.log(
          `Broadcast ${broadcast.id} — batch done: ` +
            `+${batchSuccess} success, +${batchFailed} failed, ` +
            `total sent ${sentCount}/${total}`
        );
      } catch (err) {
        console.error("Worker loop error:", err);
        await sleep(POLL_INTERVAL_MS);
      }
    }

    console.log("Worker stopped gracefully.");
  }

  /**
   * Send a message to one user, with proper error classification.
   *
   * - Temporary errors (429, 5xx): wait then retry once.
   *   - 429 uses the retry_after value supplied by Telegram.
   *   - Other 5xx errors wait a fixed 1 s before retrying.
   * - Permanent errors (400, 403, 404): skip immediately.
   */
  private async sendWithRetry(
  broadcast: BroadcastLog,
  telegramId: string
): Promise<{
  success: boolean;
  permanent: boolean;
}> {
    const result = await this.telegram.send(
  telegramId,
  broadcast.message,
  broadcast.image_url
);

if (result.success) {
  return {
    success: true,
    permanent: false,
  };
}

// Temporary error → retry once
if (result.temporary) {
  const waitMs =
    result.retryAfter !== undefined
      ? result.retryAfter * 1000
      : TEMP_ERROR_RETRY_DELAY_MS;

  if (result.retryAfter !== undefined) {
    console.log(`Rate limited. Retrying after ${result.retryAfter}s...`);
  } else {
    console.log(`Temporary error. Retrying after ${waitMs}ms...`);
  }

  await sleep(waitMs);

  const retry = await this.telegram.send(
    telegramId,
    broadcast.message,
    broadcast.image_url
  );

  return {
    success: retry.success,
    permanent: !!retry.permanent,
  };
}

// Permanent error
return {
  success: false,
  permanent: true,
};
    return {
  success: false,
  permanent: true,
};
  }
    }
