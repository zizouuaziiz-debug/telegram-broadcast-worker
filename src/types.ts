export interface User {
  telegram_id: string;
}

export interface BroadcastLog {
  id: string;
  message: string;
  image_url: string | null;
  /** Statuses used by the Vercel admin panel — do not add new values here. */
  status: "running" | "completed" | "failed";
  total_users: number;
  success_count: number;
  failed_count: number;
  created_at: string;
  /**
   * Worker-only lock field.
   * Non-null while a worker is processing this broadcast.
   * Reset to NULL on completion or failure.
   *
   * Required migration (run once in Supabase):
   *   ALTER TABLE broadcast_logs ADD COLUMN locked_at timestamptz;
   */
  locked_at: string | null;
}

export interface TelegramResult {
  success: boolean;
  /**
   * True for transient errors (429, 500, 502, 503, 504).
   * The worker will retry the message once before skipping.
   */
  temporary?: boolean;
  /**
   * True for permanent errors (400, 403, 404).
   * The worker skips the user immediately and increments failed_count.
   */
  permanent?: boolean;
  /** Seconds to wait before retrying (present on 429 responses). */
  retryAfter?: number;
}
