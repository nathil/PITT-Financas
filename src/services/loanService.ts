import { prisma } from '../db/prisma';
import {
  addMonthsToCompetence,
  getCurrentCompetenceMonth,
  splitInstallmentAmounts,
} from '../utils/dateCompetence';

export interface CreateLoanInput {
  userId: string;
  personName: string;
  totalAmount: number;
  isInstallment?: boolean;
  totalInstallments?: number;
  startMonth?: string;
}

export interface RegisterLoanPaymentInput {
  userId: string;
  personName: string;
  amount: number;
  competenceMonth?: string;
}

export class LoanService {
  /**
   * Registra um novo empréstimo concedido a uma pessoa (ex: familiar/amigo).
   * Pode ser à vista ou parcelado para dividir nas tabelas dos próximos meses.
   */
  async createLoan(input: CreateLoanInput) {
    const startMonth = input.startMonth ?? getCurrentCompetenceMonth();
    const isInstallment = Boolean(input.isInstallment && (input.totalInstallments ?? 1) > 1);
    const totalInstallments = isInstallment ? Math.max(2, Math.floor(input.totalInstallments!)) : null;
    const roundedTotal = Math.round(input.totalAmount * 100) / 100;

    const loan = await prisma.loan.create({
      data: {
        userId: input.userId,
        personName: input.personName.trim(),
        totalAmount: roundedTotal,
        paidAmount: 0,
        isInstallment,
        totalInstallments,
        startMonth,
        status: 'OPEN',
      },
    });

    // Quando o usuário empresta dinheiro, sai do saldo disponível atual
    await prisma.user.update({
      where: { id: input.userId },
      data: {
        currentBalance: {
          decrement: roundedTotal,
        },
      },
    });

    const monthlySchedule = isInstallment
      ? splitInstallmentAmounts(roundedTotal, totalInstallments!).map((amt, idx) => ({
          installment: idx + 1,
          competenceMonth: addMonthsToCompetence(startMonth, idx),
          amount: amt,
        }))
      : [{ installment: 1, competenceMonth: startMonth, amount: roundedTotal }];

    return {
      loan,
      monthlySchedule,
    };
  }

  /**
   * Registra o pagamento de valor X feito pela pessoa que pegou dinheiro emprestado,
   * subtraindo X do valor que foi emprestado.
   */
  async registerPaymentByPerson(input: RegisterLoanPaymentInput) {
    const competenceMonth = input.competenceMonth ?? getCurrentCompetenceMonth();
    const searchName = input.personName.trim().toLowerCase();

    const openLoans = await prisma.loan.findMany({
      where: {
        userId: input.userId,
        status: 'OPEN',
      },
      orderBy: { createdAt: 'asc' },
    });

    const matchingLoans = openLoans.filter(
      (l) =>
        l.personName.toLowerCase() === searchName ||
        l.personName.toLowerCase().includes(searchName)
    );

    if (matchingLoans.length === 0) {
      return null;
    }

    let remainingPayment = Math.round(input.amount * 100) / 100;
    const updatedLoans = [];
    const payments = [];

    for (const loan of matchingLoans) {
      if (remainingPayment <= 0) break;
      const currentDebt = Math.max(0, Math.round((loan.totalAmount - loan.paidAmount) * 100) / 100);
      const appliedAmount = Math.min(remainingPayment, currentDebt > 0 ? currentDebt : remainingPayment);

      const payment = await prisma.loanPayment.create({
        data: {
          loanId: loan.id,
          amount: appliedAmount,
          competenceMonth,
        },
      });
      payments.push(payment);

      const newPaidAmount = Math.round((loan.paidAmount + appliedAmount) * 100) / 100;
      const newRemaining = Math.max(0, Math.round((loan.totalAmount - newPaidAmount) * 100) / 100);
      const newStatus = newRemaining <= 0.009 ? 'PAID' : 'OPEN';

      const updated = await prisma.loan.update({
        where: { id: loan.id },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
        },
      });
      updatedLoans.push({
        ...updated,
        remainingBalance: newRemaining,
      });

      remainingPayment = Math.round((remainingPayment - appliedAmount) * 100) / 100;
    }

    // O valor recebido volta para o saldo atual do usuário
    const totalApplied = Math.round((input.amount - remainingPayment) * 100) / 100;
    if (totalApplied > 0) {
      await prisma.user.update({
        where: { id: input.userId },
        data: {
          currentBalance: {
            increment: totalApplied,
          },
        },
      });
    }

    const totalRemainingForPerson = updatedLoans.reduce((acc, l) => acc + l.remainingBalance, 0);

    return {
      personName: matchingLoans[0].personName,
      amountPaidNow: totalApplied,
      totalRemainingForPerson: Math.round(totalRemainingForPerson * 100) / 100,
      updatedLoans,
      payments,
    };
  }

  /**
   * Lista empréstimos do usuário (abertos e quitados).
   */
  async listLoans(userId: string, onlyOpen: boolean = false) {
    const loans = await prisma.loan.findMany({
      where: {
        userId,
        ...(onlyOpen ? { status: 'OPEN' } : {}),
      },
      include: { payments: true },
      orderBy: { createdAt: 'asc' },
    });

    return loans.map((l) => ({
      ...l,
      remainingBalance: Math.max(0, Math.round((l.totalAmount - l.paidAmount) * 100) / 100),
    }));
  }

  /**
   * Calcula quanto de um empréstimo (parcelado ou à vista) compete a um determinado mês YYYY-MM
   * para exibição nas tabelas mensais.
   */
  getLoanMonthSlice(
    loan: {
      totalAmount: number;
      paidAmount: number;
      isInstallment: boolean;
      totalInstallments: number | null;
      startMonth: string;
    },
    competenceMonth: string
  ): number {
    if (competenceMonth < loan.startMonth) return 0;

    if (!loan.isInstallment || !loan.totalInstallments || loan.totalInstallments <= 1) {
      return competenceMonth === loan.startMonth ? loan.totalAmount : 0;
    }

    const installments = splitInstallmentAmounts(loan.totalAmount, loan.totalInstallments);
    for (let i = 0; i < loan.totalInstallments; i++) {
      const m = addMonthsToCompetence(loan.startMonth, i);
      if (m === competenceMonth) {
        return installments[i];
      }
    }
    return 0;
  }
}

export const loanService = new LoanService();
