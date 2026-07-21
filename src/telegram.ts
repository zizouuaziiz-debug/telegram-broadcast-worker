import TelegramBot from "node-telegram-bot-api";
import { TelegramResult } from "./types";

/** Telegram error codes that are transient — safe to retry (excluding 429, handled separately). */
const TEMPORARY_ERROR_CODES = new Set([500, 502, 503, 504]);

/** Telegram error codes that are permanent — skip the user. */
const PERMANENT_ERROR_CODES = new Set([400, 403, 404]);

export class TelegramService {
  private bot: TelegramBot;

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: false });
  }

  async send(
    telegramId: string,
    message: string,
    imageUrl?: string | null
  ): Promise<TelegramResult> {
    try {
      if (imageUrl) {
        await this.bot.sendPhoto(telegramId, imageUrl, {
          caption: message,
          parse_mode: "HTML",
        });
      } else {
        await this.bot.sendMessage(telegramId, message, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      }

      return { success: true };
    } catch (err: unknown) {
      const body = (
        err as {
          response?: {
            body?: {
              error_code?: number;
              parameters?: { retry_after?: number };
            };
          };
        }
      )?.response?.body;

      const code = body?.error_code;

      // 429 — flood control. Telegram supplies the exact wait time.
      if (code === 429) {
        return {
          success: false,
          temporary: true,
          retryAfter: body?.parameters?.retry_after
            ? Number(body.parameters.retry_after)
            : 5,
        };
      }

      // Other temporary server-side errors — retry without a specific delay.
      if (code !== undefined && TEMPORARY_ERROR_CODES.has(code)) {
        return { success: false, temporary: true };
      }

      // Permanent errors (blocked, bot kicked, bad request, user not found).
      if (code !== undefined && PERMANENT_ERROR_CODES.has(code)) {
        return { success: false, permanent: true };
      }

      // Unknown error — treat as permanent to avoid infinite retries.
      return { success: false, permanent: true };
    }
  }
}
