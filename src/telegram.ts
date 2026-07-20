import TelegramBot from 'node-telegram-bot-api';
import { TelegramError } from './types';

export class TelegramService {
  private bot: TelegramBot;
  private requestDelay: number;

  constructor(botToken: string, requestDelay: number = 50) {
    this.bot = new TelegramBot(botToken, { polling: false });
    this.requestDelay = requestDelay;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendMessage(
    chatId: number,
    text: string,
    retries: number = 3
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.bot.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
        await this.delay(this.requestDelay);
        return true;
      } catch (error: any) {
        const telegramError = this.parseError(error);
        
        if (this.isTemporaryError(telegramError) && attempt < retries) {
          console.warn(
            `Temporary error sending message to ${chatId}, retry ${attempt}/${retries}: ${telegramError.message}`
          );
          await this.delay(1000 * attempt);
          continue;
        }

        if (this.isPermanentError(telegramError)) {
          console.error(
            `Permanent error sending message to ${chatId}: ${telegramError.message}`
          );
          return false;
        }

        if (attempt === retries) {
          console.error(
            `Failed to send message to ${chatId} after ${retries} attempts: ${telegramError.message}`
          );
          return false;
        }
      }
    }
    return false;
  }

  async sendPhoto(
    chatId: number,
    photoUrl: string,
    caption?: string,
    retries: number = 3
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.bot.sendPhoto(chatId, photoUrl, {
          caption: caption || undefined,
          parse_mode: 'HTML'
        });
        await this.delay(this.requestDelay);
        return true;
      } catch (error: any) {
        const telegramError = this.parseError(error);
        
        if (this.isTemporaryError(telegramError) && attempt < retries) {
          console.warn(
            `Temporary error sending photo to ${chatId}, retry ${attempt}/${retries}: ${telegramError.message}`
          );
          await this.delay(1000 * attempt);
          continue;
        }

        if (this.isPermanentError(telegramError)) {
          console.error(
            `Permanent error sending photo to ${chatId}: ${telegramError.message}`
          );
          return false;
        }

        if (attempt === retries) {
          console.error(
            `Failed to send photo to ${chatId} after ${retries} attempts: ${telegramError.message}`
          );
          return false;
        }
      }
    }
    return false;
  }

  private parseError(error: any): TelegramError {
    return {
      message: error?.response?.body?.description || error.message || 'Unknown error',
      code: error?.response?.body?.error_code,
      response: error?.response
    };
  }

  private isTemporaryError(error: TelegramError): boolean {
    if (!error.response?.statusCode) return false;
    
    return [
      429, // Too Many Requests
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504  // Gateway Timeout
    ].includes(error.response.statusCode);
  }

  private isPermanentError(error: TelegramError): boolean {
    return [
      400, // Bad Request: chat not found, user blocked bot, etc.
      403, // Forbidden: bot was blocked by user
      404  // Not Found
    ].includes(error.response?.statusCode || 0);
  }
}
