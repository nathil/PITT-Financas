import { prisma } from '../db/prisma';
import {
  addMonthsToCompetence,
  getCurrentCompetenceMonth,
  splitInstallmentAmounts,
} from '../utils/dateCompetence';

export interface AddFixedExpenseInput {
  userId: string;
  category: string;
  description: string;
  amount: number; // Se parcelado, pode ser o valor total que será dividido pelos meses ou o valor mensal
  isInstallment?: boolean;
  totalInstallments?: number;
  startMonth?: string;
}

export class FixedExpenseService {
  /**
   * Cadastra uma Despesa Fixa (nas 9 categorias, incluindo Reserva de Emergência).
   * Caso seja indicado que foi parcelado (isInstallment = true), divide o valor total
   * pelos próximos N meses para constar nas tabelas futuras.
   */
  async addFixedExpense(input: AddFixedExpenseInput) {
    const startMonth = input.startMonth ?? getCurrentCompetenceMonth();
    const isInstallment = Boolean(input.isInstallment && (input.totalInstallments ?? 1) > 1);
    const totalInstallments = isInstallment ? Math.max(2, Math.floor(input.totalInstallments!)) : null;

    const monthlyAmount = isInstallment
      ? splitInstallmentAmounts(input.amount, totalInstallments!)[0]
      : Math.round(input.amount * 100) / 100;

    const fixedExpense = await prisma.fixedExpense.create({
      data: {
        userId: input.userId,
        category: input.category,
        description: input.description,
        amount: monthlyAmount,
        isInstallment,
        totalInstallments,
        remainingMonths: totalInstallments,
        startMonth,
        active: true,
      },
    });

    return fixedExpense;
  }

  /**
   * Verifica se uma despesa fixa está ativa/vigente em um determinado mês de competência (YYYY-MM).
   */
  isFixedExpenseApplicableInMonth(
    expense: {
      active: boolean;
      startMonth: string;
      isInstallment: boolean;
      totalInstallments: number | null;
    },
    competenceMonth: string
  ): boolean {
    if (!expense.active) return false;
    if (competenceMonth < expense.startMonth) return false;

    if (expense.isInstallment && expense.totalInstallments && expense.totalInstallments > 0) {
      const endMonth = addMonthsToCompetence(expense.startMonth, expense.totalInstallments - 1);
      return competenceMonth <= endMonth;
    }

    return true;
  }

  /**
   * Retorna todas as despesas fixas do usuário aplicáveis ao mês de competência,
   * com o cálculo total comprometido, total já pago e saldo restante a pagar no mês.
   */
  async getMonthlyStatus(userId: string, competenceMonth: string = getCurrentCompetenceMonth()) {
    const expenses = await prisma.fixedExpense.findMany({
      where: { userId, active: true },
      include: {
        payments: {
          where: { competenceMonth },
        },
      },
      orderBy: { id: 'asc' },
    });

    const applicable = expenses.filter((exp) =>
      this.isFixedExpenseApplicableInMonth(exp, competenceMonth)
    );

    const items = applicable.map((exp) => {
      const paidInMonth = exp.payments.reduce((acc, p) => acc + p.amountPaid, 0);
      const remainingInMonth = Math.max(0, Math.round((exp.amount - paidInMonth) * 100) / 100);
      return {
        ...exp,
        paidInMonth: Math.round(paidInMonth * 100) / 100,
        remainingInMonth,
        isPaid: remainingInMonth <= 0.009,
      };
    });

    const totalCommitted = items.reduce((acc, i) => acc + i.amount, 0);
    const totalPaid = items.reduce((acc, i) => acc + i.paidInMonth, 0);
    const totalRemaining = items.reduce((acc, i) => acc + i.remainingInMonth, 0);

    return {
      competenceMonth,
      items,
      totalCommitted: Math.round(totalCommitted * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalRemaining: Math.round(totalRemaining * 100) / 100,
    };
  }

  /**
   * Registra (credita) o pagamento mensal de uma despesa fixa específica.
   */
  async registerPayment(
    userId: string,
    fixedExpenseId: string,
    amountPaid?: number,
    competenceMonth: string = getCurrentCompetenceMonth()
  ) {
    const expense = await prisma.fixedExpense.findFirst({
      where: { id: fixedExpenseId, userId },
      include: {
        payments: { where: { competenceMonth } },
      },
    });

    if (!expense) {
      throw new Error('Despesa fixa não encontrada.');
    }

    const alreadyPaid = expense.payments.reduce((acc, p) => acc + p.amountPaid, 0);
    const defaultToPay = Math.max(0, expense.amount - alreadyPaid);
    const finalAmount =
      amountPaid !== undefined
        ? Math.round(amountPaid * 100) / 100
        : Math.round((defaultToPay > 0 ? defaultToPay : expense.amount) * 100) / 100;

    const payment = await prisma.fixedExpensePayment.create({
      data: {
        fixedExpenseId: expense.id,
        competenceMonth,
        amountPaid: finalAmount,
      },
    });

    // Atualiza remainingMonths caso seja parcelada
    if (expense.isInstallment && expense.remainingMonths !== null && expense.remainingMonths > 0) {
      const nextRemaining = Math.max(0, expense.remainingMonths - 1);
      await prisma.fixedExpense.update({
        where: { id: expense.id },
        data: {
          remainingMonths: nextRemaining,
        },
      });
    }

    // Desconta do saldo atual e, se for Reserva de Emergência, incrementa a reserva acumulada
    await prisma.user.update({
      where: { id: userId },
      data: {
        currentBalance: { decrement: finalAmount },
        ...(expense.category === 'Reserva de Emergência'
          ? { emergencyReserveTotal: { increment: finalAmount } }
          : {}),
      },
    });

    return {
      expense,
      payment,
    };
  }

  /**
   * Credita um pagamento geral nas despesas fixas pendentes do mês.
   */
  async registerGeneralMonthlyPayment(
    userId: string,
    amount: number,
    competenceMonth: string = getCurrentCompetenceMonth()
  ) {
    const status = await this.getMonthlyStatus(userId, competenceMonth);
    let remainingToAllocate = Math.round(amount * 100) / 100;
    const paymentsCreated = [];

    for (const item of status.items) {
      if (remainingToAllocate <= 0) break;
      if (item.remainingInMonth <= 0) continue;

      const payNow = Math.min(remainingToAllocate, item.remainingInMonth);
      const res = await this.registerPayment(userId, item.id, payNow, competenceMonth);
      paymentsCreated.push(res.payment);
      remainingToAllocate = Math.round((remainingToAllocate - payNow) * 100) / 100;
    }

    // Se ainda sobrou valor e há pelo menos uma despesa fixa cadastrada, credita na primeira
    if (remainingToAllocate > 0 && status.items.length > 0) {
      const res = await this.registerPayment(
        userId,
        status.items[0].id,
        remainingToAllocate,
        competenceMonth
      );
      paymentsCreated.push(res.payment);
    }

    const updatedStatus = await this.getMonthlyStatus(userId, competenceMonth);
    return {
      paymentsCreated,
      updatedStatus,
    };
  }
}

export const fixedExpenseService = new FixedExpenseService();
