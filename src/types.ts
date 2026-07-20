export interface User {
  telegram_id: number;
}

export interface BroadcastLog {
  id: string;
  message: string;
  image_url: string | null;
  status: "running" | "completed" | "failed";
  total_users: number;
  success_count: number;
  failed_count: number;
  created_at: string;
}

export interface WorkerConfig {
  batchSize: number;
  requestDelay: number;
  pollInterval: number;
}

export interface TelegramResult {
  success: boolean;
  retryAfter?: number;
}
