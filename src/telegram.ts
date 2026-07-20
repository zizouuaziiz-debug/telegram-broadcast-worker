import TelegramBot from "node-telegram-bot-api";
import { TelegramResult } from "./types";

export class TelegramService {
  private bot: TelegramBot;

  constructor(token: string) {
    this.bot = new TelegramBot(token, {
      polling: false,
    });
  }

  async send(
    chatId: number,
    message: string,
    imageUrl?: string | null
  ): Promise<TelegramResult> {

    try {

      if (imageUrl) {

        await this.bot.sendPhoto(chatId, imageUrl, {
          caption: message || "",
          parse_mode: "HTML",
        });

      } else {

        await this.bot.sendMessage(chatId, message, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });

      }

      return {
        success: true,
      };

    } catch (err: any) {

      const body = err?.response?.body;

      // Telegram Flood Control
      if (
        body?.error_code === 429 &&
        body?.parameters?.retry_after
      ) {

        return {
          success: false,
          retryAfter: Number(body.parameters.retry_after),
        };

      }

      return {
        success: false,
      };
    }
  }
}
