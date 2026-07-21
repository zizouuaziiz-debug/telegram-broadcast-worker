import "dotenv/config";
import { SupabaseService } from "./supabase";
import { TelegramService } from "./telegram";
import { BroadcastWorker } from "./worker";

async function main(): Promise<void> {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) throw new Error("BOT_TOKEN must be set");

  const supabase = new SupabaseService();
  const telegram = new TelegramService(botToken);
  const worker = new BroadcastWorker(supabase, telegram);

  // Start the worker loop. Keep a reference so signal handlers can wait for it.
  const runPromise = worker.run();

  const shutdown = async (): Promise<void> => {
    // Signal the worker to stop after the current batch finishes.
    await worker.shutdown();
    // Wait for run() to exit its loop before exiting the process.
    await runPromise;
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    console.log("Received SIGTERM, shutting down gracefully...");
    shutdown().catch((err) => {
      console.error("Error during shutdown:", err);
      process.exit(1);
    });
  });

  process.on("SIGINT", () => {
    console.log("Received SIGINT, shutting down gracefully...");
    shutdown().catch((err) => {
      console.error("Error during shutdown:", err);
      process.exit(1);
    });
  });

  // Block until the worker exits (only happens on shutdown signal or fatal error).
  await runPromise;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
