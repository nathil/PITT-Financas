import { getEnv } from '../config/env';
import { BotMediaAttachment, BotResponse } from '../bot/types';
import { normalizePhone } from '../utils/phoneWhitelist';
import { WhatsAppProvider } from './types';

export class EvolutionApiProvider implements WhatsAppProvider {
  private cachedInstanceToken: string | null = null;

  private get baseUrl(): string {
    return getEnv().EVOLUTION_API_URL.replace(/\/+$/, '');
  }

  private get apiKey(): string {
    return getEnv().EVOLUTION_API_KEY;
  }

  private get instance(): string {
    return getEnv().EVOLUTION_INSTANCE;
  }

  /**
   * Permite atualizar dinamicamente o token da instância vindo do webhook do Evolution Go (`instanceToken`).
   */
  public setInstanceToken(token?: string): void {
    if (token && token.trim().length > 0) {
      this.cachedInstanceToken = token.trim();
    }
  }

  /**
   * Resolve o token da instância no Evolution Go (via cache do webhook ou consultando GET /instance/all com a GLOBAL_API_KEY).
   */
  private async resolveInstanceToken(): Promise<string> {
    if (this.cachedInstanceToken) {
      return this.cachedInstanceToken;
    }

    try {
      const res = await fetch(`${this.baseUrl}/instance/all`, {
        method: 'GET',
        headers: {
          apikey: this.apiKey,
        },
      });

      if (res.ok) {
        const json: any = await res.json();
        const instances: any[] = Array.isArray(json?.data) ? json.data : [];
        const targetName = this.instance.toLowerCase();
        const matched =
          instances.find(
            (inst) =>
              String(inst.name ?? '').toLowerCase() === targetName ||
              String(inst.id ?? '').toLowerCase() === targetName
          ) ?? instances[0];

        if (matched?.token) {
          this.cachedInstanceToken = String(matched.token);
          return this.cachedInstanceToken;
        }
      }
    } catch {
      // Ignora erro de rede ao consultar /instance/all e usa EVOLUTION_API_KEY como fallback
    }

    return this.apiKey;
  }

  async sendText(toPhoneOrJid: string, text: string): Promise<void> {
    const number = normalizePhone(toPhoneOrJid);
    const token = await this.resolveInstanceToken();

    // 1. Tenta o endpoint padrão do Evolution Go: POST /send/text
    const evoGoUrl = `${this.baseUrl}/send/text`;
    const evoGoRes = await fetch(evoGoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: token,
      },
      body: JSON.stringify({
        number,
        text,
      }),
    });

    if (evoGoRes.ok) {
      return;
    }

    // 2. Fallback para Evolution API v1/v2 (Node.js): POST /message/sendText/:instance
    if (evoGoRes.status === 404) {
      const legacyUrl = `${this.baseUrl}/message/sendText/${this.instance}`;
      const legacyRes = await fetch(legacyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
        body: JSON.stringify({
          number,
          text,
        }),
      });

      if (legacyRes.ok) {
        return;
      }

      const legacyErr = await legacyRes.text().catch(() => '');
      throw new Error(`Evolution API sendText error (${legacyRes.status}): ${legacyErr}`);
    }

    const errText = await evoGoRes.text().catch(() => '');
    throw new Error(`Evolution Go sendText error (${evoGoRes.status}): ${errText}`);
  }

  async sendMedia(toPhoneOrJid: string, media: BotMediaAttachment): Promise<void> {
    const number = normalizePhone(toPhoneOrJid);
    const token = await this.resolveInstanceToken();

    // 1. Tenta o endpoint padrão do Evolution Go: POST /send/media (JSON com base64 no campo url)
    const evoGoUrl = `${this.baseUrl}/send/media`;
    const evoGoRes = await fetch(evoGoUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: token,
      },
      body: JSON.stringify({
        number,
        type: media.type,
        caption: media.caption ?? '',
        filename: media.filename,
        url: media.buffer.toString('base64'),
      }),
    });

    if (evoGoRes.ok) {
      return;
    }

    // 2. Fallback para Evolution API v1/v2 (Node.js): POST /message/sendMedia/:instance
    if (evoGoRes.status === 404) {
      const legacyUrl = `${this.baseUrl}/message/sendMedia/${this.instance}`;
      const legacyRes = await fetch(legacyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
        body: JSON.stringify({
          number,
          mediatype: media.type,
          mimetype: media.mimetype,
          caption: media.caption ?? '',
          media: media.buffer.toString('base64'),
          fileName: media.filename,
        }),
      });

      if (legacyRes.ok) {
        return;
      }

      const legacyErr = await legacyRes.text().catch(() => '');
      throw new Error(`Evolution API sendMedia error (${legacyRes.status}): ${legacyErr}`);
    }

    const errText = await evoGoRes.text().catch(() => '');
    throw new Error(`Evolution Go sendMedia error (${evoGoRes.status}): ${errText}`);
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

export const evolutionApiProvider = new EvolutionApiProvider();
