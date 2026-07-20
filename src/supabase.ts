import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BroadcastLog, BroadcastSent, User } from './types';

export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables');
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  async getRunningBroadcast(): Promise<BroadcastLog | null> {
    const { data, error } = await this.client
      .from('broadcast_logs')
      .select('*')
      .eq('status', 'running')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to fetch running broadcast: ${error.message}`);
    }

    return data as BroadcastLog;
  }

  async getActiveUsersCount(): Promise<number> {
    const { count, error } = await this.client
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    if (error) {
      throw new Error(`Failed to count active users: ${error.message}`);
    }

    return count || 0;
  }

  async getUnprocessedUsers(
    broadcastId: number,
    limit: number,
    offset: number
  ): Promise<User[]> {
    const { data, error } = await this.client
      .from('users')
      .select('telegram_id, status')
      .eq('status', 'active')
      .not('telegram_id', 'in', 
        `(select telegram_id from broadcast_sent where broadcast_id = ${broadcastId})`
      )
      .range(offset, offset + limit - 1)
      .order('telegram_id', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch unprocessed users: ${error.message}`);
    }

    return data as User[];
  }

  async insertBroadcastSent(
    broadcastId: number,
    telegramId: number
  ): Promise<void> {
    const { error } = await this.client
      .from('broadcast_sent')
      .insert({
        broadcast_id: broadcastId,
        telegram_id: telegramId,
        sent_at: new Date().toISOString()
      } as BroadcastSent);

    if (error) {
      throw new Error(`Failed to insert broadcast sent record: ${error.message}`);
    }
  }

  async updateBroadcastProgress(
    broadcastId: number,
    successCount: number,
    failedCount: number,
    totalUsers: number
  ): Promise<void> {
    const { error } = await this.client
      .from('broadcast_logs')
      .update({
        success_count: successCount,
        failed_count: failedCount,
        total_users: totalUsers
      })
      .eq('id', broadcastId);

    if (error) {
      throw new Error(`Failed to update broadcast progress: ${error.message}`);
    }
  }

  async markBroadcastCompleted(broadcastId: number): Promise<void> {
    const { error } = await this.client
      .from('broadcast_logs')
      .update({ status: 'completed' })
      .eq('id', broadcastId);

    if (error) {
      throw new Error(`Failed to mark broadcast as completed: ${error.message}`);
    }
  }

  async markBroadcastFailed(broadcastId: number): Promise<void> {
    const { error } = await this.client
      .from('broadcast_logs')
      .update({ status: 'failed' })
      .eq('id', broadcastId);

    if (error) {
      throw new Error(`Failed to mark broadcast as failed: ${error.message}`);
    }
  }

  async isUserAlreadyNotified(
    broadcastId: number,
    telegramId: number
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from('broadcast_sent')
      .select('broadcast_id')
      .eq('broadcast_id', broadcastId)
      .eq('telegram_id', telegramId)
      .limit(1);

    if (error) {
      throw new Error(`Failed to check user notification status: ${error.message}`);
    }

    return (data && data.length > 0) || false;
  }
}
