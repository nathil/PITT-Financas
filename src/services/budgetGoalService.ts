import { prisma } from '../db/prisma';
import { getCurrentCompetenceMonth } from '../utils/dateCompetence';

export class BudgetGoalService {
  /**
   * Define o Saldo Atual disponível em contas correntes, carteiras e dinheiro vivo.
   */
  async setCurrentBalance(userId: string, balance: number) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        currentBalance: Math.round(balance * 100) / 100,
      },
    });
  }

  /**
   * Define ou atualiza o orçamento planejado (Orçamento) para uma categoria em um mês de competência.
   */
  async setCategoryBudget(
    userId: string,
    category: string,
    budgetedAmount: number,
    competenceMonth: string = getCurrentCompetenceMonth()
  ) {
    const rounded = Math.round(budgetedAmount * 100) / 100;
    return prisma.categoryBudget.upsert({
      where: {
        userId_category_competenceMonth: {
          userId,
          category,
          competenceMonth,
        },
      },
      update: {
        budgetedAmount: rounded,
      },
      create: {
        userId,
        category,
        competenceMonth,
        budgetedAmount: rounded,
      },
    });
  }

  async getBudgetsForMonths(userId: string, competenceMonths: string[]) {
    return prisma.categoryBudget.findMany({
      where: {
        userId,
        competenceMonth: { in: competenceMonths },
      },
    });
  }
}

export const budgetGoalService = new BudgetGoalService();
