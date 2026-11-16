import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { analyticsService } from '../src/services/analyticsService';
import { budgetGoalService } from '../src/services/budgetGoalService';
import { fixedExpenseService } from '../src/services/fixedExpenseService';
import { loanService } from '../src/services/loanService';
import { transactionService } from '../src/services/transactionService';
import { userService } from '../src/services/userService';

describe('Serviços de Domínio (Gastos Parcelados, Despesas Fixas, Empréstimos e Analytics)', () => {
  let userId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({});
    const user = await userService.getOrCreateUser('5511999991111', 'Tester Financeiro');
    userId = user.id;
  });

  it('divide gastos parcelados corretamente para as tabelas dos próximos meses com ajuste de centavos', async () => {
    const res = await transactionService.addExpense({
      userId,
      category: 'Educação',
      amount: 100,
      description: 'Curso Online',
      isInstallment: true,
      totalInstallments: 3,
      startCompetenceMonth: '2026-11',
    });

    expect(res.installmentsCount).toBe(3);
    expect(res.months).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(res.monthlyAmounts).toEqual([33.34, 33.33, 33.33]);

    const txs = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { competenceMonth: 'asc' },
    });
    expect(txs).toHaveLength(3);
    expect(txs[0].competenceMonth).toBe('2026-11');
    expect(txs[1].competenceMonth).toBe('2026-12');
    expect(txs[2].competenceMonth).toBe('2027-01');
  });

  it('calcula total de Despesas Fixas e credita pagamento mensal (incluindo Reserva de Emergência)', async () => {
    await fixedExpenseService.addFixedExpense({
      userId,
      category: 'Alimentação',
      description: 'Vale Feira Fixo',
      amount: 600,
      startMonth: '2026-11',
    });

    await fixedExpenseService.addFixedExpense({
      userId,
      category: 'Reserva de Emergência',
      description: 'Poupança Mensal Reserva',
      amount: 400,
      startMonth: '2026-11',
    });

    const statusBefore = await fixedExpenseService.getMonthlyStatus(userId, '2026-11');
    expect(statusBefore.totalCommitted).toBe(1000);
    expect(statusBefore.totalPaid).toBe(0);
    expect(statusBefore.totalRemaining).toBe(1000);

    // Credita pagamento mensal de R$ 1.000
    const paymentRes = await fixedExpenseService.registerGeneralMonthlyPayment(
      userId,
      1000,
      '2026-11'
    );
    expect(paymentRes.updatedStatus.totalPaid).toBe(1000);
    expect(paymentRes.updatedStatus.totalRemaining).toBe(0);

    // Verifica se o pagamento da Reserva de Emergência incrementou emergencyReserveTotal
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(updatedUser.emergencyReserveTotal).toBe(400);
  });

  it('registra Empréstimo por nome da pessoa e subtrai valor no Pagamento', async () => {
    const created = await loanService.createLoan({
      userId,
      personName: 'Carlos Primo',
      totalAmount: 300,
      isInstallment: true,
      totalInstallments: 3,
      startMonth: '2026-11',
    });

    expect(created.loan.totalAmount).toBe(300);
    expect(created.monthlySchedule).toHaveLength(3);

    // Carlos paga R$ 120
    const payment1 = await loanService.registerPaymentByPerson({
      userId,
      personName: 'Carlos',
      amount: 120,
      competenceMonth: '2026-11',
    });

    expect(payment1).not.toBeNull();
    expect(payment1!.amountPaidNow).toBe(120);
    expect(payment1!.totalRemainingForPerson).toBe(180);

    // Carlos paga os R$ 180 restantes -> status muda para PAID
    const payment2 = await loanService.registerPaymentByPerson({
      userId,
      personName: 'Carlos Primo',
      amount: 180,
      competenceMonth: '2026-11',
    });

    expect(payment2!.totalRemainingForPerson).toBe(0);
    expect(payment2!.updatedLoans[0].status).toBe('PAID');
  });

  it('consolida KPIs, nomes dos meses e séries para 30, 60 e 90 dias', async () => {
    await budgetGoalService.setCurrentBalance(userId, 5000);
    await transactionService.addIncome({
      userId,
      category: 'Salário',
      amount: 4000,
      competenceMonth: '2026-10',
    });
    await transactionService.addIncome({
      userId,
      category: 'Salário',
      amount: 4500,
      competenceMonth: '2026-11',
    });
    await transactionService.addExpense({
      userId,
      category: 'Alimentação',
      amount: 800,
      competenceMonth: '2026-11',
    } as any);

    const a30 = await analyticsService.getPeriodAnalytics(userId, 30, '2026-11');
    expect(a30.monthsLabel).toBe('Novembro/2026');
    expect(a30.kpis.totalIncome).toBe(4500);

    const a60 = await analyticsService.getPeriodAnalytics(userId, 60, '2026-11');
    expect(a60.monthsLabel).toBe('Outubro/2026 e Novembro/2026');
    expect(a60.kpis.totalIncome).toBe(8500);

    const a90 = await analyticsService.getPeriodAnalytics(userId, 90, '2026-11');
    expect(a90.monthsLabel).toBe('Setembro/2026, Outubro/2026 e Novembro/2026');
  });
});
