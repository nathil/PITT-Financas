import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import { botEngine } from '../src/bot/botEngine';
import { prisma } from '../src/db/prisma';
import { budgetGoalService } from '../src/services/budgetGoalService';
import { fixedExpenseService } from '../src/services/fixedExpenseService';
import { loanService } from '../src/services/loanService';
import { transactionService } from '../src/services/transactionService';
import { userService } from '../src/services/userService';
import { clearRuntimeTesters } from '../src/utils/phoneWhitelist';

describe('Geração Real de Tabelas (.xlsx / .png) e Dashboards (.png) para 30, 60 e 90 dias', () => {
  const testerJid = '5511999991111@s.whatsapp.net';
  const refMonth = '2026-11';
  const outputDir = path.resolve(process.cwd(), 'generated_reports');

  beforeEach(async () => {
    process.env.STRICT_TESTER_ONLY = 'true';
    process.env.TESTER_PHONES = '5511999991111';
    clearRuntimeTesters();
    await prisma.user.deleteMany({});

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const user = await userService.getOrCreateUser(testerJid, 'Nathielly');

    // Popula dados realistas nos últimos 3 meses (Setembro, Outubro e Novembro de 2026)
    await budgetGoalService.setCurrentBalance(user.id, 7684.0);

    // Orçamentos mensais para Novembro/2026
    await budgetGoalService.setCategoryBudget(user.id, 'Salário', 5500, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Renda Extra', 800, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Outros', 300, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Alimentação', 1200, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Transporte', 500, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Educação', 450, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Saúde e Bem-Estar', 350, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Streaming', 120, '2026-11');
    await budgetGoalService.setCategoryBudget(
      user.id,
      'Dívidas e Compromissos Financeiros',
      600,
      '2026-11'
    );
    await budgetGoalService.setCategoryBudget(user.id, 'Lazer e Estilo de Vida', 500, '2026-11');
    await budgetGoalService.setCategoryBudget(user.id, 'Reserva de Emergência', 600, '2026-11');

    // Receitas e despesas nos últimos 5 meses para o gráfico de Fluxo de Renda
    const historicalMonths = [
      { m: '2026-07', inc: 2000, exp: 400 },
      { m: '2026-08', inc: 5800, exp: 900 },
      { m: '2026-09', inc: 5500, exp: 350 },
      { m: '2026-10', inc: 5500, exp: 1800 },
    ];
    for (const h of historicalMonths) {
      await transactionService.addIncome({
        userId: user.id,
        category: 'Salário',
        amount: h.inc,
        competenceMonth: h.m,
      });
      await transactionService.addExpense({
        userId: user.id,
        category: 'Alimentação',
        amount: h.exp,
        description: 'Gastos do mês',
        startCompetenceMonth: h.m,
      });
    }

    await transactionService.addIncome({
      userId: user.id,
      category: 'Salário',
      amount: 5500,
      competenceMonth: '2026-11',
    });
    await transactionService.addIncome({
      userId: user.id,
      category: 'Renda Extra',
      amount: 650,
      competenceMonth: '2026-11',
    });
    await transactionService.addIncome({
      userId: user.id,
      category: 'Outros',
      amount: 320,
      competenceMonth: '2026-11',
    });

    // Gastos variáveis e parcelados
    await transactionService.addExpense({
      userId: user.id,
      category: 'Alimentação',
      amount: 980.5,
      description: 'Supermercado e Feira',
      startCompetenceMonth: '2026-11',
    });
    await transactionService.addExpense({
      userId: user.id,
      category: 'Transporte',
      amount: 420.0,
      description: 'Combustível e Uber',
      startCompetenceMonth: '2026-11',
    });
    await transactionService.addExpense({
      userId: user.id,
      category: 'Lazer e Estilo de Vida',
      amount: 900.0,
      description: 'Passagem Aérea',
      isInstallment: true,
      totalInstallments: 3,
      startCompetenceMonth: '2026-10',
    });
    await transactionService.addExpense({
      userId: user.id,
      category: 'Saúde e Bem-Estar',
      amount: 280.0,
      description: 'Farmácia e Academia',
      startCompetenceMonth: '2026-11',
    });

    // Despesas fixas
    const fix1 = await fixedExpenseService.addFixedExpense({
      userId: user.id,
      category: 'Dívidas e Compromissos Financeiros',
      description: 'Aluguel / Parcela Imóvel',
      amount: 1100,
      startMonth: '2026-09',
    });
    const fix2 = await fixedExpenseService.addFixedExpense({
      userId: user.id,
      category: 'Reserva de Emergência',
      description: 'Aporte Fixo Reserva',
      amount: 500,
      startMonth: '2026-09',
    });
    await fixedExpenseService.addFixedExpense({
      userId: user.id,
      category: 'Streaming',
      description: 'Assinaturas Digitais',
      amount: 89.9,
      startMonth: '2026-09',
    });
    await fixedExpenseService.registerPayment(user.id, fix1.id, 1100, '2026-11');
    await fixedExpenseService.registerPayment(user.id, fix2.id, 500, '2026-11');

    // Empréstimo e pagamento parcial
    await loanService.createLoan({
      userId: user.id,
      personName: 'João Irmão',
      totalAmount: 800,
      isInstallment: true,
      totalInstallments: 4,
      startMonth: '2026-10',
    });
    await loanService.registerPaymentByPerson({
      userId: user.id,
      personName: 'João Irmão',
      amount: 200,
      competenceMonth: '2026-11',
    });

    // Reajusta saldo atual para valor redondo de demonstração
    await budgetGoalService.setCurrentBalance(user.id, 7684.0);
  });

  it('gera Tabela de Gastos (.png e .xlsx) pelo fluxo 4 do bot para 30 dias', async () => {
    await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text: '4', // Gerar Tabela de Gastos
      referenceMonth: refMonth,
    });

    await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text: '1', // Últimos 30 dias
      referenceMonth: refMonth,
    });

    const res = await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text: '3', // Ambos (.png e .xlsx)
      referenceMonth: refMonth,
    });

    expect(res.ignored).toBe(false);
    expect(res.responses).toHaveLength(1);
    const media = res.responses[0].media!;
    expect(media).toHaveLength(2);

    const pngMedia = media.find((m) => m.type === 'image')!;
    const xlsxMedia = media.find((m) => m.type === 'document')!;

    expect(pngMedia.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(xlsxMedia.buffer.subarray(0, 2).toString('utf-8')).toBe('PK');

    fs.writeFileSync(path.join(outputDir, pngMedia.filename), pngMedia.buffer);
    fs.writeFileSync(path.join(outputDir, xlsxMedia.filename), xlsxMedia.buffer);
  });

  it('gera Dashboard Executivo (.png) pelo fluxo 5 do bot para 30 e 90 dias', async () => {
    // 30 dias
    await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text: '5',
      referenceMonth: refMonth,
    });
    const res30 = await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text: '1', // 30 dias
      referenceMonth: refMonth,
    });

    expect(res30.responses[0].text).toContain('Novembro/2026');
    const dash30 = res30.responses[0].media![0];
    expect(dash30.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
    fs.writeFileSync(path.join(outputDir, dash30.filename), dash30.buffer);

    // 90 dias
    await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text: '5',
      referenceMonth: refMonth,
    });
    const res90 = await botEngine.handleIncomingMessage({
      senderJidOrPhone: testerJid,
      text: '3', // 90 dias
      referenceMonth: refMonth,
    });

    expect(res90.responses[0].text).toContain('Setembro/2026, Outubro/2026 e Novembro/2026');
    const dash90 = res90.responses[0].media![0];
    expect(dash90.buffer.subarray(0, 4).toString('hex')).toBe('89504e47');
    fs.writeFileSync(path.join(outputDir, dash90.filename), dash90.buffer);
  });
});
