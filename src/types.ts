export interface User {
  telegram_id: number;
  status: string;
}

export interface BroadcastLog {
  id: number;
  message: string;
  image_url: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_users: number;
  success_count: number;
  failed_count: number;
  created_at: string;
}

export interface BroadcastSent {
  broadcast_id: number;
  telegram_id: number;
  sent_at: string;
}

export interface TelegramError {
  message: string;
  code?: number;
  response?: {
    statusCode?: number;
    body?: any;
  };
}

export interface SendMessageParams {
  chatId: number;
  text: string;
}

export interface SendPhotoParams {
  chatId: number;
  photo: string;
  caption?: string;
}

export interface WorkerState {
  isRunning: boolean;
  currentBroadcastId: number | null;
  processedCount: number;
  successCount: number;
  failedCount: number;
}
