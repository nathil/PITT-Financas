import { randomUUID } from 'crypto';
import { prisma } from '../db/prisma';
import {
  addMonthsToCompetence,
  getCurrentCompetenceMonth,
  splitInstallmentAmounts,
} from '../utils/dateCompetence';

export interface AddExpenseInput {
  userId: string;
  category: string;
  amount: number;
  description?: string;
  isInstallment?: boolean;
  totalInstallments?: number;
  startCompetenceMonth?: string;
}

export interface AddIncomeInput {
  userId: string;
  category: string;
  amount: number;
  description?: string;
  competenceMonth?: string;
}

export class TransactionService {
  /**
   * Registra um gasto variável.
   * Caso seja parcelado (isInstallment = true e totalInstallments > 1),
   * divide o valor para as tabelas dos próximos N meses (YYYY-MM).
   */
  async addExpense(input: AddExpenseInput) {
    const startMonth = input.startCompetenceMonth ?? getCurrentCompetenceMonth();
    const isInstallment = Boolean(input.isInstallment && (input.totalInstallments ?? 1) > 1);
    const installmentsCount = isInstallment ? Math.max(2, Math.floor(input.totalInstallments!)) : 1;

    if (!isInstallment) {
      const tx = await prisma.transaction.create({
        data: {
          userId: input.userId,
          type: 'EXPENSE',
          category: input.category,
          description: input.description ?? null,
          amount: Math.round(input.amount * 100) / 100,
          isInstallment: false,
          competenceMonth: startMonth,
        },
      });

      // Atualiza saldo disponível descontando o gasto do mês atual
      await prisma.user.update({
        where: { id: input.userId },
        data: {
          currentBalance: {
            decrement: tx.amount,
          },
        },
      });

      return {
        transactions: [tx],
        installmentsCount: 1,
        monthlyAmounts: [tx.amount],
        months: [startMonth],
      };
    }

    const groupId = randomUUID();
    const splitAmounts = splitInstallmentAmounts(input.amount, installmentsCount);
    const createdTransactions = [];
    const months: string[] = [];

    for (let i = 0; i < installmentsCount; i++) {
      const targetMonth = addMonthsToCompetence(startMonth, i);
      months.push(targetMonth);
      const installmentDesc = input.description
        ? `${input.description} (${i + 1}/${installmentsCount})`
        : `Parcela ${i + 1}/${installmentsCount}`;

      const tx = await prisma.transaction.create({
        data: {
          userId: input.userId,
          type: 'EXPENSE',
          category: input.category,
          description: installmentDesc,
          amount: splitAmounts[i],
          isInstallment: true,
          installmentNumber: i + 1,
          totalInstallments: installmentsCount,
          installmentGroupId: groupId,
          competenceMonth: targetMonth,
        },
      });
      createdTransactions.push(tx);
    }

    // Desconta do saldo atual apenas a 1ª parcela (mês corrente)
    await prisma.user.update({
      where: { id: input.userId },
      data: {
        currentBalance: {
          decrement: splitAmounts[0],
        },
      },
    });

    return {
      transactions: createdTransactions,
      installmentsCount,
      monthlyAmounts: splitAmounts,
      months,
    };
  }

  /**
   * Registra uma receita (Salário, Renda Extra, Dividendos, etc.) e soma ao Saldo Atual.
   */
  async addIncome(input: AddIncomeInput) {
    const competenceMonth = input.competenceMonth ?? getCurrentCompetenceMonth();
    const roundedAmount = Math.round(input.amount * 100) / 100;

    const tx = await prisma.transaction.create({
      data: {
        userId: input.userId,
        type: 'INCOME',
        category: input.category,
        description: input.description ?? null,
        amount: roundedAmount,
        isInstallment: false,
        competenceMonth,
      },
    });

    await prisma.user.update({
      where: { id: input.userId },
      data: {
        currentBalance: {
          increment: roundedAmount,
        },
      },
    });

    return tx;
  }
}

export const transactionService = new TransactionService();
