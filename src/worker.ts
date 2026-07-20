import { SupabaseService } from './supabase';
import { TelegramService } from './telegram';
import { BroadcastLog, WorkerState } from './types';

export class BroadcastWorker {
  private supabase: SupabaseService;
  private telegram: TelegramService;
  private state: WorkerState;
  private batchSize: number;
  private requestDelay: number;

  constructor(
    supabase: SupabaseService,
    telegram: TelegramService,
    batchSize: number = 50,
    requestDelay: number = 50
  ) {
    this.supabase = supabase;
    this.telegram = telegram;
    this.state = {
      isRunning: false,
      currentBroadcastId: null,
      processedCount: 0,
      successCount: 0,
      failedCount: 0
    };
    this.batchSize = batchSize;
    this.requestDelay = requestDelay;
  }

  async processLoop(): Promise<void> {
    console.log('Worker started, polling for broadcasts...');
    
    while (true) {
      try {
        if (!this.state.isRunning) {
          await this.checkForNewBroadcast();
        } else {
          await this.processCurrentBroadcast();
        }
      } catch (error) {
        console.error('Error in worker loop:', error);
        if (this.state.isRunning && this.state.currentBroadcastId) {
          await this.handleProcessingError(this.state.currentBroadcastId);
        }
      }
      
      await this.delay(3000);
    }
  }

  private async checkForNewBroadcast(): Promise<void> {
    const broadcast = await this.supabase.getRunningBroadcast();
    
    if (broadcast) {
      console.log(`Found running broadcast ID: ${broadcast.id}`);
      this.state.isRunning = true;
      this.state.currentBroadcastId = broadcast.id;
      this.state.processedCount = broadcast.success_count + broadcast.failed_count;
      this.state.successCount = broadcast.success_count;
      this.state.failedCount = broadcast.failed_count;
    }
  }

  private async processCurrentBroadcast(): Promise<void> {
    if (!this.state.currentBroadcastId) return;

    const totalUsers = await this.supabase.getActiveUsersCount();
    
    if (this.state.processedCount >= totalUsers) {
      await this.completeBroadcast();
      return;
    }

    const remainingUsers = totalUsers - this.state.processedCount;
    const currentBatchSize = Math.min(this.batchSize, remainingUsers);

    console.log(
      `Processing batch for broadcast ${this.state.currentBroadcastId}: ` +
      `${this.state.processedCount}/${totalUsers} users processed ` +
      `(${this.state.successCount} success, ${this.state.failedCount} failed)`
    );

    const users = await this.supabase.getUnprocessedUsers(
      this.state.currentBroadcastId,
      currentBatchSize,
      this.state.processedCount
    );

    if (users.length === 0) {
      console.log('No unprocessed users found, checking completion...');
      if (this.state.processedCount >= totalUsers) {
        await this.completeBroadcast();
      }
      return;
    }

    await this.processBatch(users);
    await this.updateProgress(totalUsers);

    if (this.state.successCount + this.state.failedCount >= totalUsers) {
      await this.completeBroadcast();
    }
  }

  private async processBatch(users: { telegram_id: number }[]): Promise<void> {
    const broadcast = await this.getBroadcastDetails();
    if (!broadcast) return;

    for (const user of users) {
      const success = await this.sendMessageToUser(
        broadcast,
        user.telegram_id
      );

      if (success) {
        await this.supabase.insertBroadcastSent(
          this.state.currentBroadcastId!,
          user.telegram_id
        );
        this.state.successCount++;
      } else {
        this.state.failedCount++;
      }

      this.state.processedCount++;
      await this.delay(this.requestDelay);
    }
  }

  private async sendMessageToUser(
    broadcast: BroadcastLog,
    telegramId: number
  ): Promise<boolean> {
    try {
      const alreadyNotified = await this.supabase.isUserAlreadyNotified(
        broadcast.id,
        telegramId
      );

      if (alreadyNotified) {
        console.log(`User ${telegramId} already notified, skipping...`);
        return true;
      }

      if (broadcast.image_url) {
        return await this.telegram.sendPhoto(
          telegramId,
          broadcast.image_url,
          broadcast.message
        );
      } else {
        return await this.telegram.sendMessage(
          telegramId,
          broadcast.message
        );
      }
    } catch (error) {
      console.error(`Error sending to user ${telegramId}:`, error);
      return false;
    }
  }

  private async getBroadcastDetails(): Promise<BroadcastLog | null> {
    try {
      const broadcast = await this.supabase.getRunningBroadcast();
      return broadcast;
    } catch (error) {
      console.error('Failed to get broadcast details:', error);
      return null;
    }
  }

  private async updateProgress(totalUsers: number): Promise<void> {
    try {
      await this.supabase.updateBroadcastProgress(
        this.state.currentBroadcastId!,
        this.state.successCount,
        this.state.failedCount,
        totalUsers
      );
    } catch (error) {
      console.error('Failed to update broadcast progress:', error);
    }
  }

  private async completeBroadcast(): Promise<void> {
    try {
      console.log(
        `Completing broadcast ${this.state.currentBroadcastId}: ` +
        `${this.state.successCount} success, ${this.state.failedCount} failed`
      );
      
      await this.supabase.markBroadcastCompleted(this.state.currentBroadcastId!);
      this.resetState();
    } catch (error) {
      console.error('Failed to complete broadcast:', error);
    }
  }

  private async handleProcessingError(broadcastId: number): Promise<void> {
    try {
      console.error(`Marking broadcast ${broadcastId} as failed due to processing error`);
      await this.supabase.markBroadcastFailed(broadcastId);
      this.resetState();
    } catch (error) {
      console.error('Failed to mark broadcast as failed:', error);
    }
  }

  private resetState(): void {
    this.state = {
      isRunning: false,
      currentBroadcastId: null,
      processedCount: 0,
      successCount: 0,
      failedCount: 0
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down worker gracefully...');
    
    if (this.state.isRunning && this.state.currentBroadcastId) {
      console.log(
        `Saving progress for broadcast ${this.state.currentBroadcastId} before shutdown`
      );
      
      const totalUsers = await this.supabase.getActiveUsersCount();
      await this.updateProgress(totalUsers);
    }
    
    console.log('Worker shutdown complete');
  }
}
