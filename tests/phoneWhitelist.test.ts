import { beforeEach, describe, expect, it } from 'vitest';
import { botEngine } from '../src/bot/botEngine';
import { prisma } from '../src/db/prisma';
import {
  addTesterPhone,
  clearRuntimeTesters,
  getPhoneVariants,
  isAllowedTester,
  isGroupOrBroadcastJid,
  normalizePhone,
} from '../src/utils/phoneWhitelist';

describe('Controle de Acesso Exclusivo para Testers (phoneWhitelist & BotEngine)', () => {
  beforeEach(async () => {
    process.env.STRICT_TESTER_ONLY = 'true';
    process.env.TESTER_PHONES = '5511999991111,5521988882222';
    clearRuntimeTesters();
    await prisma.user.deleteMany({});
  });

  it('normaliza corretamente JIDs do WhatsApp e números formatados', () => {
    expect(normalizePhone('5511999991111@s.whatsapp.net')).toBe('5511999991111');
    expect(normalizePhone('5511999991111:14@s.whatsapp.net')).toBe('5511999991111');
    expect(normalizePhone('+55 (11) 99999-1111')).toBe('5511999991111');
  });

  it('identifica grupos e broadcasts como inválidos para o bot', () => {
    expect(isGroupOrBroadcastJid('12036304123456@g.us')).toBe(true);
    expect(isGroupOrBroadcastJid('status@broadcast')).toBe(true);
    expect(isGroupOrBroadcastJid('5511999991111@s.whatsapp.net')).toBe(false);
  });

  it('reconhece números testers com ou sem o 9º dígito brasileiro', () => {
    const variants = getPhoneVariants('5511999991111');
    expect(variants).toContain('5511999991111');
    expect(variants).toContain('551199991111');

    // Tester cadastrado com 13 dígitos enviando JID com 12 dígitos (sem o 9 extra)
    expect(isAllowedTester('551199991111@s.whatsapp.net')).toBe(true);
    expect(isAllowedTester('5521988882222@s.whatsapp.net')).toBe(true);
  });

  it('bloqueia qualquer número que não esteja na lista de testers', () => {
    expect(isAllowedTester('5531977776666@s.whatsapp.net')).toBe(false);
    expect(isAllowedTester('12036304123456@g.us')).toBe(false);
  });

  it('permite adicionar tester dinamicamente em runtime', () => {
    expect(isAllowedTester('5541966665555@s.whatsapp.net')).toBe(false);
    addTesterPhone('+55 (41) 96666-5555');
    expect(isAllowedTester('5541966665555@s.whatsapp.net')).toBe(true);
  });

  it('BotEngine ignora silenciosamente mensagens de números não-testers sem criar usuário no banco', async () => {
    const unknownSender = '5585912345678@s.whatsapp.net';
    const result = await botEngine.handleIncomingMessage({
      senderJidOrPhone: unknownSender,
      text: 'oi',
      senderName: 'Intruso',
    });

    expect(result.ignored).toBe(true);
    expect(result.reason).toBe('NOT_A_TESTER');
    expect(result.responses).toHaveLength(0);

    const usersInDb = await prisma.user.findMany();
    expect(usersInDb).toHaveLength(0);
  });

  it('BotEngine responde normalmente quando o número pertence a um Tester autorizado', async () => {
    const testerSender = '5511999991111@s.whatsapp.net';
    const result = await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerSender,
      text: 'oi',
      senderName: 'Tester Oficial',
    });

    expect(result.ignored).toBe(false);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].text).toContain('PITT Finanças — Organização Financeira');
    expect(result.responses[0].text).toContain('1️⃣ *Adicionar Gastos*');
  });
});
