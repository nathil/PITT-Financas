import { BotMediaAttachment, BotResponse } from '../bot/types';

export interface WhatsAppProvider {
  sendText(toPhoneOrJid: string, text: string): Promise<void>;
  sendMedia(toPhoneOrJid: string, media: BotMediaAttachment): Promise<void>;
  sendBotResponses(toPhoneOrJid: string, responses: BotResponse[]): Promise<void>;
}
