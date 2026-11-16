import express, { Request, Response } from 'express';
import { botEngine } from './bot/botEngine';
import { getEnv } from './config/env';
import { prisma } from './db/prisma';
import { userService } from './services/userService';
import {
  addTesterPhone,
  getConfiguredTesterPhones,
  normalizePhone,
  removeTesterPhone,
  toCanonicalPhone,
} from './utils/phoneWhitelist';
import { evolutionApiProvider } from './whatsapp/evolutionProvider';
import { WhatsAppProvider } from './whatsapp/types';

export function createApp(customProvider?: WhatsAppProvider) {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const provider = customProvider ?? evolutionApiProvider;

  // Healthcheck
  app.get('/health', async (_req: Request, res: Response) => {
    const env = getEnv();
    const configuredTesters = getConfiguredTesterPhones();
    res.json({
      status: 'ok',
      strictTesterOnly: env.STRICT_TESTER_ONLY,
      whatsappProvider: env.WHATSAPP_PROVIDER,
      configuredTestersCount: configuredTesters.length,
    });
  });

  // Middleware simples para proteger rotas de administração de testers
  const requireAdminKey = (req: Request, res: Response, next: () => void) => {
    const env = getEnv();
    const headerKey = req.headers['x-admin-key'];
    if (env.ADMIN_API_KEY && headerKey !== env.ADMIN_API_KEY) {
      res.status(401).json({ error: 'Unauthorized: invalid x-admin-key' });
      return;
    }
    next();
  };

  // Listar números de telefone dos Testers autorizados
  app.get('/admin/testers', requireAdminKey, async (_req: Request, res: Response) => {
    const envAndRuntimeTesters = getConfiguredTesterPhones();
    const dbTesters = await userService.listDatabaseTesters();
    res.json({
      strictTesterOnly: getEnv().STRICT_TESTER_ONLY,
      configuredPhones: envAndRuntimeTesters,
      databaseTesters: dbTesters.map((u) => ({
        id: u.id,
        phone: u.phone,
        name: u.name,
        isTester: u.isTester,
      })),
    });
  });

  // Adicionar um novo Tester pelo número de telefone
  app.post('/admin/testers', requireAdminKey, async (req: Request, res: Response) => {
    const { phone, name } = req.body ?? {};
    const canonical = toCanonicalPhone(String(phone ?? ''));
    if (!canonical) {
      res.status(400).json({ error: 'Número de telefone inválido.' });
      return;
    }

    addTesterPhone(canonical);
    const user = await userService.getOrCreateUser(canonical, name);
    await prisma.user.update({
      where: { id: user.id },
      data: { isTester: true, ...(name ? { name } : {}) },
    });

    res.status(201).json({
      message: 'Tester autorizado com sucesso!',
      phone: canonical,
      userId: user.id,
    });
  });

  // Remover permissão de Tester de um número de telefone
  app.delete('/admin/testers/:phone', requireAdminKey, async (req: Request, res: Response) => {
    const rawPhone = String(req.params.phone ?? '');
    const canonical = toCanonicalPhone(rawPhone);
    removeTesterPhone(rawPhone);

    await prisma.user.updateMany({
      where: { phone: canonical },
      data: { isTester: false },
    });

    res.json({
      message: 'Número removido da lista de testers.',
      phone: canonical,
    });
  });

  /**
   * Webhook de recebimento de mensagens (compatível com Evolution Go, Evolution API v1/v2 e formato direto de simulação).
   * Ignora silenciosamente mensagens de qualquer número que não seja Tester.
   */
  app.post('/webhook/evolution', async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};

      // Captura token da instância enviado pelo Evolution Go
      if (body.instanceToken && typeof body.instanceToken === 'string') {
        evolutionApiProvider.setInstanceToken(body.instanceToken);
      }

      // Se o evento for do Evolution Go ou Evolution API e não for recebimento de mensagem, ignora
      const eventName = String(body.event ?? '');
      if (
        eventName &&
        eventName !== 'Message' &&
        eventName !== 'messages.upsert' &&
        eventName !== 'MESSAGE'
      ) {
        res.status(200).json({ ignored: true, reason: `EVENT_${eventName}` });
        return;
      }

      // Suporta:
      // 1) Evolution Go (whatsmeow): body.data.Info.{Sender, Chat, IsFromMe, IsGroup, PushName} e body.data.Message.{conversation, extendedTextMessage.text}
      // 2) Evolution API v1/v2 (Baileys): body.data.key.{remoteJid, fromMe} e body.data.message.{conversation, extendedTextMessage.text}
      // 3) Payload direto de teste: { from, text, fromMe, pushName }
      const data = body.data ?? body;
      const info = data.Info ?? data.info ?? {};
      const key = data.key ?? {};
      const msgObj = data.Message ?? data.message ?? {};

      const isGroup: boolean = Boolean(
        info.IsGroup ??
          info.isGroup ??
          String(info.Chat ?? key.remoteJid ?? '').endsWith('@g.us')
      );
      if (isGroup) {
        res.status(200).json({ ignored: true, reason: 'GROUP_MESSAGE' });
        return;
      }

      const extractJid = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && (val.User || val.user)) {
          const u = val.User ?? val.user;
          const s = val.Server ?? val.server ?? 's.whatsapp.net';
          return `${u}@${s}`;
        }
        return '';
      };

      const candidateJids = [
        extractJid(info.Sender),
        extractJid(info.SenderAlt),
        extractJid(info.Chat),
        extractJid(key.remoteJid),
        extractJid(key.participant),
        extractJid(data.from),
        extractJid(data.phone),
      ].filter(Boolean);

      // Prioriza JIDs padrão de telefone (@s.whatsapp.net) caso o WhatsApp envie @lid
      const remoteJid: string =
        candidateJids.find((j) => j.includes('@s.whatsapp.net')) ??
        candidateJids[0] ??
        '';

      const fromMe: boolean = Boolean(
        info.IsFromMe ?? info.fromMe ?? key.fromMe ?? data.fromMe ?? false
      );

      const pushName: string | undefined =
        info.PushName ?? info.pushName ?? data.pushName ?? data.name ?? undefined;

      const text: string =
        msgObj.conversation ??
        msgObj.extendedTextMessage?.text ??
        msgObj.imageMessage?.caption ??
        msgObj.documentMessage?.caption ??
        data.text ??
        '';

      console.log(
        `[Webhook] Evento recebido de ${normalizePhone(remoteJid)} (fromMe=${fromMe}): "${text}"`
      );

      const result = await botEngine.handleIncomingMessage({
        senderJidOrPhone: remoteJid,
        text,
        senderName: pushName,
        fromMe,
      });

      if (result.ignored) {
        if (result.reason === 'NOT_A_TESTER') {
          console.log(
            `[TesterGuard] Webhook ignorou mensagem de número não-tester: ${normalizePhone(remoteJid)}`
          );
        }
        res.status(200).json({
          ignored: true,
          reason: result.reason,
        });
        return;
      }

      // Envia respostas se não for chamada apenas de simulação local (dryRun)
      if (!body.dryRun) {
        await provider.sendBotResponses(remoteJid, result.responses);
      }

      res.status(200).json({
        ignored: false,
        responsesCount: result.responses.length,
        responses: result.responses.map((r) => ({
          text: r.text,
          media: r.media?.map((m) => ({
            type: m.type,
            filename: m.filename,
            mimetype: m.mimetype,
            caption: m.caption,
            sizeBytes: m.buffer.length,
          })),
        })),
      });
    } catch (error: any) {
      console.error('Erro no webhook /webhook/evolution:', error);
      res.status(500).json({ error: error?.message ?? 'Internal Server Error' });
    }
  });

  return app;
}
