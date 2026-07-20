import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { BroadcastLog, User } from "./types";

export class SupabaseService {
  private client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    this.client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async getRunningBroadcast(): Promise<BroadcastLog | null> {
    const { data, error } = await this.client
      .from("broadcast_logs")
      .select("*")
      .eq("status", "running")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return (data as BroadcastLog) || null;
  }

  async getActiveUsersCount(): Promise<number> {
    const { count, error } = await this.client
      .from("users")
      .select("*", {
        head: true,
        count: "exact",
      })
      .eq("status", "active");

    if (error) throw error;

    return count || 0;
  }

  async getPendingUsers(
    broadcastId: string,
    limit: number
  ): Promise<User[]> {

    const { data: users, error } = await this.client
      .from("users")
      .select("telegram_id")
      .eq("status", "active")
      .limit(5000);

    if (error) throw error;

    const { data: sent } = await this.client
      .from("broadcast_sent")
      .select("telegram_id")
      .eq("broadcast_id", broadcastId);

    const sentIds = new Set(
      (sent || []).map((x) => Number(x.telegram_id))
    );

    return (users || [])
      .filter((u) => !sentIds.has(Number(u.telegram_id)))
      .slice(0, limit) as User[];
  }

  async insertSent(
    broadcastId: string,
    telegramId: number
  ) {
    await this.client
      .from("broadcast_sent")
      .insert({
        broadcast_id: broadcastId,
        telegram_id: telegramId,
      });
  }

  async getSentCount(
    broadcastId: string
  ): Promise<number> {

    const { count } = await this.client
      .from("broadcast_sent")
      .select("*", {
        head: true,
        count: "exact",
      })
      .eq("broadcast_id", broadcastId);

    return count || 0;
  }

  async updateProgress(
    broadcastId: string,
    success: number,
    failed: number,
    total: number
  ) {

    await this.client
      .from("broadcast_logs")
      .update({
        success_count: success,
        failed_count: failed,
        total_users: total,
      })
      .eq("id", broadcastId);
  }

  async complete(
    broadcastId: string
  ) {

    await this.client
      .from("broadcast_logs")
      .update({
        status: "completed",
      })
      .eq("id", broadcastId);
  }

  async fail(
    broadcastId: string
  ) {

    await this.client
      .from("broadcast_logs")
      .update({
        status: "failed",
      })
      .eq("id", broadcastId);
  }
}
