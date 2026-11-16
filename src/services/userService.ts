import { prisma } from '../db/prisma';
import { toCanonicalPhone, getPhoneVariants, isAllowedTester } from '../utils/phoneWhitelist';

export class UserService {
  /**
   * Verifica se o número está autorizado como tester (via .env/runtime ou cadastrado com isTester=true no banco).
   */
  async isAuthorizedTesterPhone(jidOrPhone: string): Promise<boolean> {
    if (isAllowedTester(jidOrPhone)) {
      return true;
    }

    const variants = getPhoneVariants(jidOrPhone);
    if (variants.length === 0) return false;

    const dbTester = await prisma.user.findFirst({
      where: {
        phone: { in: variants },
        isTester: true,
      },
    });

    return Boolean(dbTester);
  }

  /**
   * Busca ou cria um usuário para o telefone informado (usando formato canônico).
   */
  async getOrCreateUser(jidOrPhone: string, name?: string) {
    const canonical = toCanonicalPhone(jidOrPhone);
    const variants = getPhoneVariants(jidOrPhone);

    const existing = await prisma.user.findFirst({
      where: {
        phone: { in: variants.length > 0 ? variants : [canonical] },
      },
      include: { session: true },
    });

    if (existing) {
      if (!existing.session) {
        await prisma.conversationSession.create({
          data: {
            userId: existing.id,
            state: 'MAIN_MENU',
            payload: '{}',
          },
        });
        return prisma.user.findUniqueOrThrow({
          where: { id: existing.id },
          include: { session: true },
        });
      }
      return existing;
    }

    return prisma.user.create({
      data: {
        phone: canonical,
        name: name ?? null,
        isTester: true,
        session: {
          create: {
            state: 'MAIN_MENU',
            payload: '{}',
          },
        },
      },
      include: { session: true },
    });
  }

  async updateSession(userId: string, state: string, payloadObj: Record<string, unknown> = {}) {
    return prisma.conversationSession.upsert({
      where: { userId },
      update: {
        state,
        payload: JSON.stringify(payloadObj),
      },
      create: {
        userId,
        state,
        payload: JSON.stringify(payloadObj),
      },
    });
  }

  async listDatabaseTesters() {
    return prisma.user.findMany({
      where: { isTester: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const userService = new UserService();
