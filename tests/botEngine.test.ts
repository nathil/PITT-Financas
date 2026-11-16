import { beforeEach, describe, expect, it } from 'vitest';
import { botEngine } from '../src/bot/botEngine';
import { prisma } from '../src/db/prisma';
import { clearRuntimeTesters } from '../src/utils/phoneWhitelist';

describe('Fluxos Conversacionais do Chatbot (BotEngine)', () => {
  const testerJid = '5511999991111@s.whatsapp.net';
  const refMonth = '2026-11';

  beforeEach(async () => {
    process.env.STRICT_TESTER_ONLY = 'true';
    process.env.TESTER_PHONES = '5511999991111';
    clearRuntimeTesters();
    await prisma.user.deleteMany({});
  });

  async function send(text: string) {
    return botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text,
      senderName: 'Nathielly Tester',
      referenceMonth: refMonth,
    });
  }

  it('percorre o fluxo completo: 1. Adicionar Gastos (parcelado), 2. Despesas Fixas + Pagamento, 3. Empréstimo + Pagamento e 6. Renda/Saldo', async () => {
    // Saudação inicial
    const welcome = await send('oi');
    expect(welcome.ignored).toBe(false);
    expect(welcome.responses[0].text).toContain('Menu');

    // 6 -> Adicionar Receita (Salário de R$ 5.000)
    await send('6');
    await send('1'); // Adicionar Renda
    await send('1'); // 1. Salário
    const incRes = await send('5000,00');
    expect(incRes.responses[0].text).toContain('Receita registrada com sucesso');

    // 1 -> Adicionar Gasto Parcelado em Lazer e Estilo de Vida (R$ 600 em 3x)
    await send('1');
    await send('7'); // Lazer e Estilo de Vida
    await send('600');
    await send('Viagem Fim de Ano');
    await send('2'); // Sim, parcelado
    const expRes = await send('3'); // 3x
    expect(expRes.responses[0].text).toContain('Gasto parcelado registrado');
    expect(expRes.responses[0].text).toContain('3x de R$ 200,00');
    expect(expRes.responses[0].text).toContain('Novembro/2026 até Janeiro/2027');

    // 2 -> Adicionar Despesa Fixa (Streaming R$ 55,90) + Pagamento
    await send('2');
    await send('1'); // Adicionar Despesa Fixa
    await send('5'); // Streaming
    await send('Netflix + Spotify');
    await send('55,90');
    const fixCreate = await send('1'); // Não parcelada (fixa mensal)
    expect(fixCreate.responses[0].text).toContain('Despesa Fixa cadastrada com sucesso');

    await send('2'); // Menu Despesas Fixas
    await send('2'); // Pagamento
    const fixPay = await send('55,90');
    expect(fixPay.responses[0].text).toContain('Pagamento mensal de Despesas Fixas creditado');

    // 3 -> Empréstimo (Emprestar R$ 250 para Tia Maria e depois receber R$ 100 de pagamento)
    await send('3');
    await send('1'); // Valor do Empréstimo
    await send('250');
    await send('Tia Maria');
    const loanCreate = await send('1'); // À vista
    expect(loanCreate.responses[0].text).toContain('Empréstimo registrado com sucesso');

    await send('3');
    await send('2'); // Pagamento
    await send('Tia Maria');
    const loanPay = await send('100');
    expect(loanPay.responses[0].text).toContain('Pagamento de empréstimo registrado');
    expect(loanPay.responses[0].text).toContain('R$ 150,00');

    // 7 -> Sair / Encerrar atendimento
    const exitRes = await send('7');
    expect(exitRes.responses[0].text).toContain('Atendimento encerrado');
  });
});
