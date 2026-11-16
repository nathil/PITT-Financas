import { prisma } from '../db/prisma';
import {
  FIXED_AND_DASHBOARD_CATEGORIES,
  INCOME_CATEGORIES,
} from '../config/categories';
import {
  PeriodDays,
  addMonthsToCompetence,
  formatCompetenceMonthPt,
  formatCompetenceMonthShortPt,
  getCompetenceMonthsForPeriod,
  getCurrentCompetenceMonth,
  getPeriodMonthsLabel,
} from '../utils/dateCompetence';
import { fixedExpenseService } from './fixedExpenseService';
import { loanService } from './loanService';

export interface BudgetComparisonRow {
  label: string;
  budgeted: number;
  actual: number;
  difference: number;
}

export interface LoanSummaryRow {
  id: string;
  personName: string;
  totalAmount: number;
  periodSliceAmount: number;
  paidAmount: number;
  remainingBalance: number;
  isInstallment: boolean;
  totalInstallments: number | null;
  status: string;
}

export interface FixedExpenseSummaryRow {
  id: string;
  category: string;
  description: string;
  monthlyAmount: number;
  periodCommitted: number;
  periodPaid: number;
  periodRemaining: number;
  isInstallment: boolean;
  totalInstallments: number | null;
}

export interface MonthlyChartPoint {
  competenceMonth: string;
  monthLabel: string;
  shortLabel: string;
  income: number;
  expenses: number;
}

export interface PeriodAnalytics {
  userId: string;
  userName: string | null;
  periodDays: PeriodDays;
  referenceMonth: string;
  competenceMonths: string[];
  monthsLabel: string;

  // 1. KPIs / Cards de Resumo
  kpis: {
    currentBalance: number; // Saldo Atual em contas, carteiras, dinheiro
    totalIncome: number; // Renda Total (Receitas)
    totalExpenses: number; // Despesas Totais (Variáveis + Fixas no período)
    variableExpensesTotal: number;
    fixedExpensesCommittedTotal: number;
    fixedExpensesPaidTotal: number;
    accountsReceivable: number; // Total a receber de Empréstimos em aberto
    accountsPayable: number; // Despesas fixas pendentes + parcelas do período
  };

  // Tabelas estilo Pág. 3 do PDF
  incomeRows: BudgetComparisonRow[];
  budgetSummaryRows: {
    totalIncome: BudgetComparisonRow;
    totalExpenses: BudgetComparisonRow;
  };
  categoryExpenseRows: BudgetComparisonRow[];
  fixedExpenseRows: FixedExpenseSummaryRow[];
  loanRows: LoanSummaryRow[];

  // 2. Séries para Gráficos do Dashboard
  charts: {
    monthlySeries: MonthlyChartPoint[];
    expensesByCategory: Array<{
      category: string;
      variableAmount: number;
      fixedAmount: number;
      totalAmount: number;
      percentageOfExpenses: number;
    }>;
  };
}

export class AnalyticsService {
  /**
   * Consolida todas as informações financeiras do usuário para 30, 60 ou 90 dias.
   */
  async getPeriodAnalytics(
    userId: string,
    periodDays: PeriodDays,
    referenceMonth: string = getCurrentCompetenceMonth()
  ): Promise<PeriodAnalytics> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const competenceMonths = getCompetenceMonthsForPeriod(periodDays, referenceMonth);
    const monthsLabel = getPeriodMonthsLabel(periodDays, referenceMonth);
    const monthsCount = competenceMonths.length;

    const allTransactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { competenceMonth: 'asc' },
    });

    const periodTransactions = allTransactions.filter((t) =>
      competenceMonths.includes(t.competenceMonth)
    );

    const allFixedExpenses = await prisma.fixedExpense.findMany({
      where: { userId, active: true },
      include: { payments: true },
    });

    const allLoans = await loanService.listLoans(userId, false);

    const budgets = await prisma.categoryBudget.findMany({
      where: {
        userId,
        competenceMonth: { in: competenceMonths },
      },
    });

    const getBudgetForCategory = (category: string, defaultMonthly: number = 0): number => {
      const matching = budgets.filter(
        (b) => b.category.toLowerCase() === category.toLowerCase()
      );
      if (matching.length > 0) {
        return round2(matching.reduce((acc, b) => acc + b.budgetedAmount, 0));
      }
      return round2(defaultMonthly * monthsCount);
    };

    // 1. Consolidação de RENDA (Receitas)
    const incomeTransactions = periodTransactions.filter((t) => t.type === 'INCOME');
    const incomeRows: BudgetComparisonRow[] = INCOME_CATEGORIES.map((incCat) => {
      const actual = round2(
        incomeTransactions
          .filter((t) => t.category.toLowerCase() === incCat.toLowerCase())
          .reduce((acc, t) => acc + t.amount, 0)
      );
      const budgeted = getBudgetForCategory(incCat, actual);
      return {
        label: incCat,
        budgeted,
        actual,
        difference: round2(actual - budgeted),
      };
    });

    const knownIncomeCats = new Set(INCOME_CATEGORIES.map((c) => c.toLowerCase()));
    const extraIncome = round2(
      incomeTransactions
        .filter((t) => !knownIncomeCats.has(t.category.toLowerCase()))
        .reduce((acc, t) => acc + t.amount, 0)
    );
    if (extraIncome > 0) {
      const outrosRow = incomeRows.find((r) => r.label === 'Outros');
      if (outrosRow) {
        outrosRow.actual = round2(outrosRow.actual + extraIncome);
        outrosRow.difference = round2(outrosRow.actual - outrosRow.budgeted);
      }
    }

    const totalIncomeActual = round2(incomeRows.reduce((acc, r) => acc + r.actual, 0));
    const totalIncomeBudgeted = round2(
      incomeRows.reduce((acc, r) => acc + r.budgeted, 0) || totalIncomeActual
    );

    // 2. Consolidação de DESPESAS FIXAS no período
    const fixedExpenseRows: FixedExpenseSummaryRow[] = [];
    for (const fe of allFixedExpenses) {
      let periodCommitted = 0;
      let periodPaid = 0;

      for (const m of competenceMonths) {
        if (fixedExpenseService.isFixedExpenseApplicableInMonth(fe, m)) {
          periodCommitted += fe.amount;
        }
        const paidInM = fe.payments
          .filter((p) => p.competenceMonth === m)
          .reduce((acc, p) => acc + p.amountPaid, 0);
        periodPaid += paidInM;
      }

      periodCommitted = round2(periodCommitted);
      periodPaid = round2(periodPaid);

      if (periodCommitted > 0 || periodPaid > 0) {
        fixedExpenseRows.push({
          id: fe.id,
          category: fe.category,
          description: fe.description,
          monthlyAmount: fe.amount,
          periodCommitted,
          periodPaid,
          periodRemaining: Math.max(0, round2(periodCommitted - periodPaid)),
          isInstallment: fe.isInstallment,
          totalInstallments: fe.totalInstallments,
        });
      }
    }

    const fixedExpensesCommittedTotal = round2(
      fixedExpenseRows.reduce((acc, r) => acc + r.periodCommitted, 0)
    );
    const fixedExpensesPaidTotal = round2(
      fixedExpenseRows.reduce((acc, r) => acc + r.periodPaid, 0)
    );

    // 3. Consolidação de GASTOS VARIÁVEIS e DESPESAS POR CATEGORIA (9 categorias)
    const expenseTransactions = periodTransactions.filter((t) => t.type === 'EXPENSE');
    const variableExpensesTotal = round2(
      expenseTransactions.reduce((acc, t) => acc + t.amount, 0)
    );

    const expensesByCategory: PeriodAnalytics['charts']['expensesByCategory'] = [];
    const categoryExpenseRows: BudgetComparisonRow[] = [];

    const totalCombinedExpenses = round2(variableExpensesTotal + fixedExpensesCommittedTotal);

    for (const cat of FIXED_AND_DASHBOARD_CATEGORIES) {
      const varAmt = round2(
        expenseTransactions
          .filter((t) => t.category.toLowerCase() === cat.toLowerCase())
          .reduce((acc, t) => acc + t.amount, 0)
      );

      const fixAmt = round2(
        fixedExpenseRows
          .filter((f) => f.category.toLowerCase() === cat.toLowerCase())
          .reduce((acc, f) => acc + f.periodCommitted, 0)
      );

      const totalCat = round2(varAmt + fixAmt);
      const budgeted = getBudgetForCategory(cat, totalCat);

      categoryExpenseRows.push({
        label: cat,
        budgeted,
        actual: totalCat,
        difference: round2(budgeted - totalCat),
      });

      expensesByCategory.push({
        category: cat,
        variableAmount: varAmt,
        fixedAmount: fixAmt,
        totalAmount: totalCat,
        percentageOfExpenses:
          totalCombinedExpenses > 0
            ? round2((totalCat / totalCombinedExpenses) * 100)
            : 0,
      });
    }

    const totalExpensesActual = round2(
      categoryExpenseRows.reduce((acc, r) => acc + r.actual, 0)
    );
    const totalExpensesBudgeted = round2(
      categoryExpenseRows.reduce((acc, r) => acc + r.budgeted, 0) || totalExpensesActual
    );

    // 4. Consolidação de EMPRÉSTIMOS
    const loanRows: LoanSummaryRow[] = allLoans.map((l) => {
      let periodSlice = 0;
      for (const m of competenceMonths) {
        periodSlice += loanService.getLoanMonthSlice(l, m);
      }
      return {
        id: l.id,
        personName: l.personName,
        totalAmount: l.totalAmount,
        periodSliceAmount: round2(periodSlice),
        paidAmount: l.paidAmount,
        remainingBalance: l.remainingBalance,
        isInstallment: l.isInstallment,
        totalInstallments: l.totalInstallments,
        status: l.status,
      };
    });

    const accountsReceivable = round2(
      loanRows
        .filter((l) => l.status === 'OPEN')
        .reduce((acc, l) => acc + l.remainingBalance, 0)
    );

    const pendingFixedExpenses = round2(
      fixedExpenseRows.reduce((acc, f) => acc + f.periodRemaining, 0)
    );
    const periodInstallmentExpenses = round2(
      expenseTransactions
        .filter((t) => t.isInstallment)
        .reduce((acc, t) => acc + t.amount, 0)
    );
    const accountsPayable = round2(pendingFixedExpenses + periodInstallmentExpenses);

    // 5. Série Mensal (para o Comparativo Mensal Receitas vs Despesas)
    const chartMonthsCount = Math.max(monthsCount, 5);
    const chartMonths: string[] = [];
    for (let i = chartMonthsCount - 1; i >= 0; i--) {
      chartMonths.push(addMonthsToCompetence(referenceMonth, -i));
    }

    const monthlySeries: MonthlyChartPoint[] = chartMonths.map((m) => {
      const mTx = allTransactions.filter((t) => t.competenceMonth === m);
      const mInc = round2(
        mTx.filter((t) => t.type === 'INCOME').reduce((acc, t) => acc + t.amount, 0)
      );
      const mVarExp = round2(
        mTx.filter((t) => t.type === 'EXPENSE').reduce((acc, t) => acc + t.amount, 0)
      );
      const mFixExp = round2(
        allFixedExpenses
          .filter((fe) => fixedExpenseService.isFixedExpenseApplicableInMonth(fe, m))
          .reduce((acc, fe) => acc + fe.amount, 0)
      );
      const mExp = round2(mVarExp + mFixExp);
      return {
        competenceMonth: m,
        monthLabel: formatCompetenceMonthPt(m, true),
        shortLabel: formatCompetenceMonthShortPt(m, false),
        income: mInc,
        expenses: mExp,
      };
    });

    return {
      userId,
      userName: user.name,
      periodDays,
      referenceMonth,
      competenceMonths,
      monthsLabel,
      kpis: {
        currentBalance: round2(user.currentBalance),
        totalIncome: totalIncomeActual,
        totalExpenses: totalExpensesActual,
        variableExpensesTotal,
        fixedExpensesCommittedTotal,
        fixedExpensesPaidTotal,
        accountsReceivable,
        accountsPayable,
      },
      incomeRows,
      budgetSummaryRows: {
        totalIncome: {
          label: 'Renda Total',
          budgeted: totalIncomeBudgeted,
          actual: totalIncomeActual,
          difference: round2(totalIncomeActual - totalIncomeBudgeted),
        },
        totalExpenses: {
          label: 'Despesas Totais',
          budgeted: totalExpensesBudgeted,
          actual: totalExpensesActual,
          difference: round2(totalExpensesBudgeted - totalExpensesActual),
        },
      },
      categoryExpenseRows,
      fixedExpenseRows,
      loanRows,
      charts: {
        monthlySeries,
        expensesByCategory,
      },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const analyticsService = new AnalyticsService();
