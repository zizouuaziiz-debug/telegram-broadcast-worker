import { SupabaseService } from './supabase';
import { TelegramService } from './telegram';
import { BroadcastWorker } from './worker';

async function main() {
  console.log('Starting Telegram Broadcast Worker...');

  // Validate environment variables
  const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BOT_TOKEN'];
  
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }

  try {
    // Initialize services
    const supabase = new SupabaseService();
    const telegram = new TelegramService(process.env.BOT_TOKEN!, 50);
    const worker = new BroadcastWorker(supabase, telegram, 50, 50);

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, initiating graceful shutdown...`);
      
      try {
        await worker.shutdown();
        console.log('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      shutdown('uncaughtException').catch(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled rejection at:', promise, 'reason:', reason);
    });

    // Start the worker loop
    console.log('Worker initialized successfully, starting main loop...');
    await worker.processLoop();
    
  } catch (error) {
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
