import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { botEngine } from '../bot/botEngine';
import { BotMediaAttachment, BotResponse } from '../bot/types';
import { normalizePhone } from '../utils/phoneWhitelist';
import { WhatsAppProvider } from './types';

export class BaileysProvider implements WhatsAppProvider {
  private sock: WASocket | null = null;

  private formatJid(phoneOrJid: string): string {
    if (phoneOrJid.includes('@')) return phoneOrJid;
    const digits = normalizePhone(phoneOrJid);
    return `${digits}@s.whatsapp.net`;
  }

  async start(authDir: string = 'auth_info_baileys'): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }) as any,
    });

    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n📱 Escaneie o QR Code abaixo no seu WhatsApp para conectar o bot PITT Finanças:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(
          `Conexão com WhatsApp encerrada (status=${statusCode}). Reconectando=${shouldReconnect}`
        );
        if (shouldReconnect) {
          this.start(authDir).catch((err) =>
            console.error('Erro ao reconectar Baileys:', err)
          );
        }
      } else if (connection === 'open') {
        console.log('✅ Bot WhatsApp (Baileys) conectado e pronto para atender usuários Testers!');
      }
    });

    sock.ev.on('messages.upsert', async (event) => {
      if (event.type !== 'notify') return;

      for (const msg of event.messages) {
        const remoteJid = msg.key.remoteJid ?? '';
        const fromMe = Boolean(msg.key.fromMe);
        const pushName = msg.pushName ?? undefined;

        const textContent =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          '';

        if (!textContent) continue;

        try {
          const result = await botEngine.handleIncomingMessage({
            senderJidOrPhone: remoteJid,
            text: textContent,
            senderName: pushName,
            fromMe,
          });

          if (result.ignored) {
            if (result.reason === 'NOT_A_TESTER') {
              console.log(
                `[TesterGuard] Mensagem ignorada de número não-tester: ${normalizePhone(remoteJid)}`
              );
            }
            continue;
          }

          await this.sendBotResponses(remoteJid, result.responses);
        } catch (err) {
          console.error('Erro ao processar mensagem no Baileys:', err);
        }
      }
    });
  }

  async sendText(toPhoneOrJid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error('Baileys socket não inicializado.');
    const jid = this.formatJid(toPhoneOrJid);
    await this.sock.sendMessage(jid, { text });
  }

  async sendMedia(toPhoneOrJid: string, media: BotMediaAttachment): Promise<void> {
    if (!this.sock) throw new Error('Baileys socket não inicializado.');
    const jid = this.formatJid(toPhoneOrJid);

    if (media.type === 'image') {
      await this.sock.sendMessage(jid, {
        image: media.buffer,
        caption: media.caption,
        mimetype: media.mimetype,
      });
    } else {
      await this.sock.sendMessage(jid, {
        document: media.buffer,
        fileName: media.filename,
        mimetype: media.mimetype,
        caption: media.caption,
      });
    }
  }

  async sendBotResponses(toPhoneOrJid: string, responses: BotResponse[]): Promise<void> {
    for (const resp of responses) {
      if (resp.text) {
        await this.sendText(toPhoneOrJid, resp.text);
      }
      if (resp.media && resp.media.length > 0) {
        for (const item of resp.media) {
          await this.sendMedia(toPhoneOrJid, item);
        }
      }
    }
  }
}

export const baileysProvider = new BaileysProvider();
