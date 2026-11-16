import {
  FIXED_AND_DASHBOARD_CATEGORIES,
  INCOME_CATEGORIES,
  VARIABLE_EXPENSE_CATEGORIES,
} from '../config/categories';
import { generateDashboardPng } from '../reports/dashboardGenerator';
import { generateTablePng, generateTableXlsx } from '../reports/tableGenerator';
import { analyticsService } from '../services/analyticsService';
import { budgetGoalService } from '../services/budgetGoalService';
import { fixedExpenseService } from '../services/fixedExpenseService';
import { loanService } from '../services/loanService';
import { transactionService } from '../services/transactionService';
import { userService } from '../services/userService';
import {
  PeriodDays,
  formatBRL,
  formatCompetenceMonthPt,
  getCurrentCompetenceMonth,
  getPeriodMonthsLabel,
  parseCurrencyInput,
} from '../utils/dateCompetence';
import { isGroupOrBroadcastJid } from '../utils/phoneWhitelist';
import { BotResponse, BotState, HandleMessageResult } from './types';

const GLOBAL_RESET_COMMANDS = new Set([
  '0',
  'menu',
  'voltar',
  'inicio',
  'início',
  'cancelar',
]);

const EXIT_COMMANDS = new Set([
  'sair',
  'encerrar',
  'finalizar',
  'tchau',
  'ate logo',
  'até logo',
]);

const GREETING_COMMANDS = new Set([
  'oi',
  'ola',
  'olá',
  'bom dia',
  'boa tarde',
  'boa noite',
  'start',
  'iniciar',
]);

export class BotEngine {
  /**
   * Processa uma mensagem recebida do WhatsApp.
   * - Se o número NÃO for de um usuário Tester autorizado (ou for grupo/fromMe),
   *   ignora completamente e retorna `{ ignored: true, responses: [] }`.
   */
  async handleIncomingMessage(params: {
    senderJidOrPhone: string;
    text: string;
    senderName?: string;
    fromMe?: boolean;
    referenceMonth?: string;
  }): Promise<HandleMessageResult> {
    const { senderJidOrPhone, text, senderName, fromMe } = params;
    const refMonth = params.referenceMonth ?? getCurrentCompetenceMonth();

    if (fromMe) {
      return { ignored: true, reason: 'FROM_ME', responses: [] };
    }

    if (!senderJidOrPhone || isGroupOrBroadcastJid(senderJidOrPhone)) {
      return { ignored: true, reason: 'GROUP_OR_INVALID_JID', responses: [] };
    }

    // Verifica se o telefone pertence a um Tester autorizado
    const isTester = await userService.isAuthorizedTesterPhone(senderJidOrPhone);
    if (!isTester) {
      return { ignored: true, reason: 'NOT_A_TESTER', responses: [] };
    }

    const cleanText = (text ?? '').trim();
    if (!cleanText) {
      return { ignored: true, reason: 'EMPTY_MESSAGE', responses: [] };
    }

    const user = await userService.getOrCreateUser(senderJidOrPhone, senderName);
    const currentState = (user.session?.state ?? 'MAIN_MENU') as BotState;
    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(user.session?.payload ?? '{}');
    } catch {
      payload = {};
    }

    const lower = cleanText.toLowerCase();

    // Comandos globais para encerrar o atendimento / sair
    if (EXIT_COMMANDS.has(lower)) {
      await userService.updateSession(user.id, 'MAIN_MENU', {});
      return {
        ignored: false,
        responses: [{ text: this.getExitMessageText() }],
      };
    }

    // Comandos globais para voltar ao Menu Principal
    if (GLOBAL_RESET_COMMANDS.has(lower)) {
      await userService.updateSession(user.id, 'MAIN_MENU', {});
      return {
        ignored: false,
        responses: [{ text: this.getMainMenuText() }],
      };
    }

    // Se estiver no MAIN_MENU e mandar "oi" / saudação, exibe o menu
    if (currentState === 'MAIN_MENU' && GREETING_COMMANDS.has(lower)) {
      return {
        ignored: false,
        responses: [{ text: this.getMainMenuText() }],
      };
    }

    switch (currentState) {
      case 'MAIN_MENU':
        return this.handleMainMenu(user.id, cleanText, refMonth);

      // ================= 1. ADICIONAR GASTOS =================
      case 'EXPENSE_SELECT_CATEGORY':
        return this.handleExpenseSelectCategory(user.id, cleanText, payload);
      case 'EXPENSE_ENTER_AMOUNT':
        return this.handleExpenseEnterAmount(user.id, cleanText, payload);
      case 'EXPENSE_ENTER_DESCRIPTION':
        return this.handleExpenseEnterDescription(user.id, cleanText, payload);
      case 'EXPENSE_ASK_INSTALLMENT':
        return this.handleExpenseAskInstallment(user.id, cleanText, payload, refMonth);
      case 'EXPENSE_ENTER_INSTALLMENTS':
        return this.handleExpenseEnterInstallments(user.id, cleanText, payload, refMonth);

      // ================= 2. DESPESAS FIXAS =================
      case 'FIXED_SUBMENU':
        return this.handleFixedSubmenu(user.id, cleanText, refMonth);
      case 'FIXED_SELECT_CATEGORY':
        return this.handleFixedSelectCategory(user.id, cleanText, payload);
      case 'FIXED_ENTER_DESCRIPTION':
        return this.handleFixedEnterDescription(user.id, cleanText, payload);
      case 'FIXED_ENTER_AMOUNT':
        return this.handleFixedEnterAmount(user.id, cleanText, payload);
      case 'FIXED_ASK_INSTALLMENT':
        return this.handleFixedAskInstallment(user.id, cleanText, payload, refMonth);
      case 'FIXED_ENTER_INSTALLMENTS':
        return this.handleFixedEnterInstallments(user.id, cleanText, payload, refMonth);
      case 'FIXED_PAYMENT_ENTER_AMOUNT':
        return this.handleFixedPaymentEnterAmount(user.id, cleanText, refMonth);

      // ================= 3. EMPRÉSTIMO =================
      case 'LOAN_SUBMENU':
        return this.handleLoanSubmenu(user.id, cleanText);
      case 'LOAN_CREATE_ENTER_AMOUNT':
        return this.handleLoanCreateEnterAmount(user.id, cleanText, payload);
      case 'LOAN_CREATE_ENTER_PERSON':
        return this.handleLoanCreateEnterPerson(user.id, cleanText, payload);
      case 'LOAN_CREATE_ASK_INSTALLMENT':
        return this.handleLoanCreateAskInstallment(user.id, cleanText, payload, refMonth);
      case 'LOAN_CREATE_ENTER_INSTALLMENTS':
        return this.handleLoanCreateEnterInstallments(user.id, cleanText, payload, refMonth);
      case 'LOAN_PAYMENT_ENTER_PERSON':
        return this.handleLoanPaymentEnterPerson(user.id, cleanText, payload);
      case 'LOAN_PAYMENT_ENTER_AMOUNT':
        return this.handleLoanPaymentEnterAmount(user.id, cleanText, payload, refMonth);

      // ================= 4. GERAR TABELA DE GASTOS =================
      case 'TABLE_SELECT_PERIOD':
        return this.handleTableSelectPeriod(user.id, cleanText, payload, refMonth);
      case 'TABLE_SELECT_FORMAT':
        return this.handleTableSelectFormat(user.id, cleanText, payload, refMonth);

      // ================= 5. GERAR DASHBOARD DE GASTOS =================
      case 'DASHBOARD_SELECT_PERIOD':
        return this.handleDashboardSelectPeriod(user.id, cleanText, refMonth);

      // ================= 6. RENDA E ORÇAMENTO =================
      case 'INCOME_BALANCE_SUBMENU':
        return this.handleIncomeBalanceSubmenu(user.id, cleanText);
      case 'INCOME_SELECT_CATEGORY':
        return this.handleIncomeSelectCategory(user.id, cleanText, payload);
      case 'INCOME_ENTER_AMOUNT':
        return this.handleIncomeEnterAmount(user.id, cleanText, payload, refMonth);
      case 'BUDGET_SELECT_CATEGORY':
        return this.handleBudgetSelectCategory(user.id, cleanText, payload);
      case 'BUDGET_ENTER_AMOUNT':
        return this.handleBudgetEnterAmount(user.id, cleanText, payload, refMonth);

      default:
        await userService.updateSession(user.id, 'MAIN_MENU', {});
        return {
          ignored: false,
          responses: [{ text: this.getMainMenuText() }],
        };
    }
  }

  public getMainMenuText(): string {
    return [
      '💰 *PITT Finanças — Organização Financeira (Menu Principal)*',
      '',
      'Escolha uma das opções abaixo enviando o número:',
      '1️⃣ *Adicionar Gastos*',
      '2️⃣ *Adicionar Despesas Fixas*',
      '3️⃣ *Empréstimo*',
      '4️⃣ *Gerar Tabela de Gastos*',
      '5️⃣ *Gerar Dashboard de Gastos*',
      '6️⃣ *Renda e Orçamento*',
      '7️⃣ *Sair / Encerrar*',
      '',
      '_Envie *0* ou *menu* para voltar aqui, ou *7* (*sair*) para encerrar._',
    ].join('\n');
  }

  public getExitMessageText(): string {
    return [
      '👋 *Atendimento encerrado!*',
      'Todos os seus lançamentos foram salvos com segurança no *PITT Finanças*.',
      '',
      '_Quando quiser registrar novos gastos ou gerar relatórios, basta enviar *oi* ou *menu*._',
    ].join('\n');
  }

  private async handleMainMenu(
    userId: string,
    input: string,
    refMonth: string
  ): Promise<HandleMessageResult> {
    switch (input) {
      case '1': {
        await userService.updateSession(userId, 'EXPENSE_SELECT_CATEGORY', {});
        const cats = VARIABLE_EXPENSE_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n');
        return {
          ignored: false,
          responses: [
            {
              text: `🛒 *Adicionar Gastos*\nEscolha a categoria do gasto:\n\n${cats}\n\n_Envie 0 para voltar ao menu._`,
            },
          ],
        };
      }

      case '2': {
        await userService.updateSession(userId, 'FIXED_SUBMENU', {});
        const status = await fixedExpenseService.getMonthlyStatus(userId, refMonth);
        return {
          ignored: false,
          responses: [
            {
              text: [
                `📌 *Despesas Fixas (${formatCompetenceMonthPt(refMonth)})*`,
                `• Total comprometido no mês: *${formatBRL(status.totalCommitted)}*`,
                `• Total pago no mês: *${formatBRL(status.totalPaid)}*`,
                `• Restante a pagar: *${formatBRL(status.totalRemaining)}*`,
                '',
                'Escolha uma opção:',
                '1. Adicionar Despesa Fixa',
                '2. Pagamento (creditar pagamento mensal)',
                '',
                '_Envie 0 para voltar ao menu._',
              ].join('\n'),
            },
          ],
        };
      }

      case '3': {
        await userService.updateSession(userId, 'LOAN_SUBMENU', {});
        const openLoans = await loanService.listLoans(userId, true);
        const totalReceivable = openLoans.reduce((acc, l) => acc + l.remainingBalance, 0);
        return {
          ignored: false,
          responses: [
            {
              text: [
                '🤝 *Empréstimo*',
                `Total em aberto a receber: *${formatBRL(totalReceivable)}* (${openLoans.length} registro(s))`,
                '',
                'Escolha uma opção:',
                '1. Valor do Empréstimo (registrar novo empréstimo)',
                '2. Pagamento (abater valor pago por quem pegou emprestado)',
                '',
                '_Envie 0 para voltar ao menu._',
              ].join('\n'),
            },
          ],
        };
      }

      case '4': {
        await userService.updateSession(userId, 'TABLE_SELECT_PERIOD', {});
        return {
          ignored: false,
          responses: [
            {
              text: [
                '📊 *Gerar Tabela de Gastos*',
                'Escolha o período desejado:',
                `1. Tabela dos últimos 30 dias (${getPeriodMonthsLabel(30, refMonth)})`,
                `2. Tabela dos últimos 60 dias (${getPeriodMonthsLabel(60, refMonth)})`,
                `3. Tabela dos últimos 90 dias (${getPeriodMonthsLabel(90, refMonth)})`,
                '',
                '_Envie 0 para voltar ao menu._',
              ].join('\n'),
            },
          ],
        };
      }

      case '5': {
        await userService.updateSession(userId, 'DASHBOARD_SELECT_PERIOD', {});
        return {
          ignored: false,
          responses: [
            {
              text: [
                '📈 *Gerar Dashboard de Gastos*',
                'Escolha o período desejado:',
                `1. Dashboard dos últimos 30 dias (${getPeriodMonthsLabel(30, refMonth)})`,
                `2. Dashboard dos últimos 60 dias (${getPeriodMonthsLabel(60, refMonth)})`,
                `3. Dashboard dos últimos 90 dias (${getPeriodMonthsLabel(90, refMonth)})`,
                '',
                '_Envie 0 para voltar ao menu._',
              ].join('\n'),
            },
          ],
        };
      }

      case '6': {
        await userService.updateSession(userId, 'INCOME_BALANCE_SUBMENU', {});
        return {
          ignored: false,
          responses: [
            {
              text: [
                '💵 *Renda e Orçamento*',
                'Escolha o que deseja atualizar:',
                '1. Adicionar Renda / Receita (Salário, Renda Extra, Outros)',
                '2. Definir Orçamento Mensal por Categoria',
                '',
                '_Envie 0 para voltar ao menu._',
              ].join('\n'),
            },
          ],
        };
      }

      case '7': {
        await userService.updateSession(userId, 'MAIN_MENU', {});
        return {
          ignored: false,
          responses: [{ text: this.getExitMessageText() }],
        };
      }

      default:
        return {
          ignored: false,
          responses: [
            {
              text: `Opção inválida.\n\n${this.getMainMenuText()}`,
            },
          ],
        };
    }
  }

  // ============================================================================
  // 1. ADICIONAR GASTOS
  // ============================================================================
  private async handleExpenseSelectCategory(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const idx = Number(input) - 1;
    const category =
      idx >= 0 && idx < VARIABLE_EXPENSE_CATEGORIES.length
        ? VARIABLE_EXPENSE_CATEGORIES[idx]
        : VARIABLE_EXPENSE_CATEGORIES.find(
            (c) => c.toLowerCase() === input.toLowerCase()
          );

    if (!category) {
      return {
        ignored: false,
        responses: [
          {
            text: `Por favor, escolha um número de 1 a ${VARIABLE_EXPENSE_CATEGORIES.length} correspondente à categoria do gasto.`,
          },
        ],
      };
    }

    await userService.updateSession(userId, 'EXPENSE_ENTER_AMOUNT', {
      ...payload,
      category,
    });

    return {
      ignored: false,
      responses: [
        {
          text: `Categoria selecionada: *${category}*\n\nDigite o *valor* do gasto (ex: 85,90):`,
        },
      ],
    };
  }

  private async handleExpenseEnterAmount(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const amount = parseCurrencyInput(input);
    if (!amount) {
      return {
        ignored: false,
        responses: [{ text: 'Valor inválido. Digite um número positivo (ex: 49,90 ou 150):' }],
      };
    }

    await userService.updateSession(userId, 'EXPENSE_ENTER_DESCRIPTION', {
      ...payload,
      amount,
    });

    return {
      ignored: false,
      responses: [
        {
          text: `Valor: *${formatBRL(amount)}*\n\nDigite uma breve *descrição* do gasto (ex: Supermercado) ou envie *-* para pular:`,
        },
      ],
    };
  }

  private async handleExpenseEnterDescription(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const description = input === '-' ? payload.category : input;
    await userService.updateSession(userId, 'EXPENSE_ASK_INSTALLMENT', {
      ...payload,
      description,
    });

    return {
      ignored: false,
      responses: [
        {
          text: [
            'Esse gasto foi *parcelado*?',
            '1. Não (À vista)',
            '2. Sim (Parcelado — divide para as tabelas dos próximos meses)',
          ].join('\n'),
        },
      ],
    };
  }

  private async handleExpenseAskInstallment(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const lower = input.toLowerCase();
    if (lower === '1' || lower === 'nao' || lower === 'não' || lower === 'n') {
      const res = await transactionService.addExpense({
        userId,
        category: payload.category,
        amount: payload.amount,
        description: payload.description,
        isInstallment: false,
        startCompetenceMonth: refMonth,
      });

      await userService.updateSession(userId, 'MAIN_MENU', {});
      return {
        ignored: false,
        responses: [
          {
            text: [
              '✅ *Gasto registrado com sucesso!*',
              `• Categoria: *${payload.category}*`,
              `• Descrição: ${payload.description}`,
              `• Valor: *${formatBRL(res.monthlyAmounts[0])}* (À vista em ${formatCompetenceMonthPt(refMonth)})`,
              '',
              this.getMainMenuText(),
            ].join('\n'),
          },
        ],
      };
    }

    if (lower === '2' || lower === 'sim' || lower === 's') {
      await userService.updateSession(userId, 'EXPENSE_ENTER_INSTALLMENTS', payload);
      return {
        ignored: false,
        responses: [
          {
            text: 'Em quantas *parcelas* foi dividido? (Digite um número a partir de 2, ex: 3):',
          },
        ],
      };
    }

    return {
      ignored: false,
      responses: [{ text: 'Responda com *1* (Não / À vista) ou *2* (Sim / Parcelado):' }],
    };
  }

  private async handleExpenseEnterInstallments(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const count = parseInt(input, 10);
    if (!Number.isFinite(count) || count < 2 || count > 120) {
      return {
        ignored: false,
        responses: [{ text: 'Quantidade de parcelas inválida. Digite um número entre 2 e 120:' }],
      };
    }

    const res = await transactionService.addExpense({
      userId,
      category: payload.category,
      amount: payload.amount,
      description: payload.description,
      isInstallment: true,
      totalInstallments: count,
      startCompetenceMonth: refMonth,
    });

    await userService.updateSession(userId, 'MAIN_MENU', {});
    const firstMonthLabel = formatCompetenceMonthPt(res.months[0]);
    const lastMonthLabel = formatCompetenceMonthPt(res.months[res.months.length - 1]);

    return {
      ignored: false,
      responses: [
        {
          text: [
            '✅ *Gasto parcelado registrado e dividido nas próximas tabelas!*',
            `• Categoria: *${payload.category}*`,
            `• Descrição: ${payload.description}`,
            `• Valor Total: *${formatBRL(payload.amount)}*`,
            `• Parcelamento: *${count}x de ${formatBRL(res.monthlyAmounts[0])}*`,
            `• Distribuído nos meses: *${firstMonthLabel} até ${lastMonthLabel}*`,
            '',
            this.getMainMenuText(),
          ].join('\n'),
        },
      ],
    };
  }

  // ============================================================================
  // 2. ADICIONAR DESPESAS FIXAS E PAGAMENTO
  // ============================================================================
  private async handleFixedSubmenu(
    userId: string,
    input: string,
    refMonth: string
  ): Promise<HandleMessageResult> {
    if (input === '1') {
      await userService.updateSession(userId, 'FIXED_SELECT_CATEGORY', {});
      const cats = FIXED_AND_DASHBOARD_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n');
      return {
        ignored: false,
        responses: [
          {
            text: `📌 *Adicionar Despesa Fixa*\nEscolha a categoria:\n\n${cats}`,
          },
        ],
      };
    }

    if (input === '2') {
      const status = await fixedExpenseService.getMonthlyStatus(userId, refMonth);
      if (status.items.length === 0) {
        await userService.updateSession(userId, 'MAIN_MENU', {});
        return {
          ignored: false,
          responses: [
            {
              text: `Você ainda não possui despesas fixas cadastradas.\n\n${this.getMainMenuText()}`,
            },
          ],
        };
      }

      await userService.updateSession(userId, 'FIXED_PAYMENT_ENTER_AMOUNT', {});
      const listText = status.items
        .map(
          (item, i) =>
            `${i + 1}. *${item.description}* (${item.category}): ${formatBRL(item.amount)} [Pago: ${formatBRL(item.paidInMonth)} | Falta: ${formatBRL(item.remainingInMonth)}]`
        )
        .join('\n');

      return {
        ignored: false,
        responses: [
          {
            text: [
              `💳 *Pagamento de Despesas Fixas (${formatCompetenceMonthPt(refMonth)})*`,
              '',
              listText,
              '',
              `• *Total gasto com Despesas Fixas*: ${formatBRL(status.totalCommitted)}`,
              `• *Total já creditado no mês*: ${formatBRL(status.totalPaid)}`,
              `• *Saldo restante a pagar*: ${formatBRL(status.totalRemaining)}`,
              '',
              'Digite o *valor do pagamento mensal* que deseja creditar (ex: 1500,00):',
            ].join('\n'),
          },
        ],
      };
    }

    return {
      ignored: false,
      responses: [{ text: 'Escolha *1* (Adicionar Despesa Fixa) ou *2* (Pagamento):' }],
    };
  }

  private async handleFixedSelectCategory(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const idx = Number(input) - 1;
    const category =
      idx >= 0 && idx < FIXED_AND_DASHBOARD_CATEGORIES.length
        ? FIXED_AND_DASHBOARD_CATEGORIES[idx]
        : FIXED_AND_DASHBOARD_CATEGORIES.find(
            (c) => c.toLowerCase() === input.toLowerCase()
          );

    if (!category) {
      return {
        ignored: false,
        responses: [
          {
            text: `Escolha um número de 1 a ${FIXED_AND_DASHBOARD_CATEGORIES.length}.`,
          },
        ],
      };
    }

    await userService.updateSession(userId, 'FIXED_ENTER_DESCRIPTION', {
      ...payload,
      category,
    });

    return {
      ignored: false,
      responses: [
        {
          text: `Categoria: *${category}*\nDigite a *descrição* da despesa fixa (ex: Aluguel, Conta de Luz, Reserva Mensal):`,
        },
      ],
    };
  }

  private async handleFixedEnterDescription(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    await userService.updateSession(userId, 'FIXED_ENTER_AMOUNT', {
      ...payload,
      description: input,
    });

    return {
      ignored: false,
      responses: [
        {
          text: `Digite o *valor* da despesa "${input}" (se for parcelada, digite o valor total a ser dividido; se for fixa mensal, digite o valor mensal):`,
        },
      ],
    };
  }

  private async handleFixedEnterAmount(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const amount = parseCurrencyInput(input);
    if (!amount) {
      return {
        ignored: false,
        responses: [{ text: 'Valor inválido. Digite um número positivo (ex: 1100,00):' }],
      };
    }

    await userService.updateSession(userId, 'FIXED_ASK_INSTALLMENT', {
      ...payload,
      amount,
    });

    return {
      ignored: false,
      responses: [
        {
          text: [
            'Essa despesa foi *parcelada*?',
            '1. Não (Despesa fixa mensal recorrente)',
            '2. Sim (Parcelada — divide para as tabelas dos próximos meses)',
          ].join('\n'),
        },
      ],
    };
  }

  private async handleFixedAskInstallment(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const lower = input.toLowerCase();
    if (lower === '1' || lower === 'nao' || lower === 'não' || lower === 'n') {
      const fe = await fixedExpenseService.addFixedExpense({
        userId,
        category: payload.category,
        description: payload.description,
        amount: payload.amount,
        isInstallment: false,
        startMonth: refMonth,
      });

      const status = await fixedExpenseService.getMonthlyStatus(userId, refMonth);
      await userService.updateSession(userId, 'MAIN_MENU', {});

      return {
        ignored: false,
        responses: [
          {
            text: [
              '✅ *Despesa Fixa cadastrada com sucesso!*',
              `• Categoria: *${fe.category}*`,
              `• Descrição: ${fe.description}`,
              `• Valor Mensal: *${formatBRL(fe.amount)}*`,
              `• Total atual comprometido com Despesas Fixas: *${formatBRL(status.totalCommitted)}*`,
              '',
              this.getMainMenuText(),
            ].join('\n'),
          },
        ],
      };
    }

    if (lower === '2' || lower === 'sim' || lower === 's') {
      await userService.updateSession(userId, 'FIXED_ENTER_INSTALLMENTS', payload);
      return {
        ignored: false,
        responses: [{ text: 'Em quantas *parcelas/meses* será dividida? (Ex: 6):' }],
      };
    }

    return {
      ignored: false,
      responses: [{ text: 'Responda com *1* (Não) ou *2* (Sim):' }],
    };
  }

  private async handleFixedEnterInstallments(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const count = parseInt(input, 10);
    if (!Number.isFinite(count) || count < 2 || count > 120) {
      return {
        ignored: false,
        responses: [{ text: 'Digite um número de parcelas válido entre 2 e 120:' }],
      };
    }

    const fe = await fixedExpenseService.addFixedExpense({
      userId,
      category: payload.category,
      description: payload.description,
      amount: payload.amount,
      isInstallment: true,
      totalInstallments: count,
      startMonth: refMonth,
    });

    const status = await fixedExpenseService.getMonthlyStatus(userId, refMonth);
    await userService.updateSession(userId, 'MAIN_MENU', {});

    return {
      ignored: false,
      responses: [
        {
          text: [
            '✅ *Despesa Fixa parcelada cadastrada com sucesso!*',
            `• Categoria: *${fe.category}*`,
            `• Descrição: ${fe.description}`,
            `• Valor dividido por mês: *${count}x de ${formatBRL(fe.amount)}*`,
            `• Total mensal comprometido com Despesas Fixas: *${formatBRL(status.totalCommitted)}*`,
            '',
            this.getMainMenuText(),
          ].join('\n'),
        },
      ],
    };
  }

  private async handleFixedPaymentEnterAmount(
    userId: string,
    input: string,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const amount = parseCurrencyInput(input);
    if (!amount) {
      return {
        ignored: false,
        responses: [{ text: 'Valor inválido. Digite o valor pago (ex: 1100,00):' }],
      };
    }

    const res = await fixedExpenseService.registerGeneralMonthlyPayment(userId, amount, refMonth);
    await userService.updateSession(userId, 'MAIN_MENU', {});

    return {
      ignored: false,
      responses: [
        {
          text: [
            '✅ *Pagamento mensal de Despesas Fixas creditado!*',
            `• Valor creditado agora: *${formatBRL(amount)}*`,
            `• Total de Despesas Fixas do mês: *${formatBRL(res.updatedStatus.totalCommitted)}*`,
            `• Total já pago no mês: *${formatBRL(res.updatedStatus.totalPaid)}*`,
            `• Saldo pendente no mês: *${formatBRL(res.updatedStatus.totalRemaining)}*`,
            '',
            this.getMainMenuText(),
          ].join('\n'),
        },
      ],
    };
  }

  // ============================================================================
  // 3. EMPRÉSTIMO (VALOR DO EMPRÉSTIMO E PAGAMENTO POR NOME)
  // ============================================================================
  private async handleLoanSubmenu(
    userId: string,
    input: string
  ): Promise<HandleMessageResult> {
    if (input === '1') {
      await userService.updateSession(userId, 'LOAN_CREATE_ENTER_AMOUNT', {});
      return {
        ignored: false,
        responses: [
          {
            text: '🤝 *Novo Empréstimo*\nDigite o *Valor do Empréstimo* (ex: 200,00):',
          },
        ],
      };
    }

    if (input === '2') {
      const openLoans = await loanService.listLoans(userId, true);
      if (openLoans.length === 0) {
        await userService.updateSession(userId, 'MAIN_MENU', {});
        return {
          ignored: false,
          responses: [
            {
              text: `Não há nenhum empréstimo em aberto no momento.\n\n${this.getMainMenuText()}`,
            },
          ],
        };
      }

      await userService.updateSession(userId, 'LOAN_PAYMENT_ENTER_PERSON', {});
      const list = openLoans
        .map(
          (l) =>
            `• *${l.personName}*: Emprestado ${formatBRL(l.totalAmount)} | Pago ${formatBRL(l.paidAmount)} | Falta *${formatBRL(l.remainingBalance)}*`
        )
        .join('\n');

      return {
        ignored: false,
        responses: [
          {
            text: [
              '💸 *Pagamento de Empréstimo*',
              'Empréstimos em aberto:',
              list,
              '',
              'Digite o *nome da pessoa* que realizou o pagamento:',
            ].join('\n'),
          },
        ],
      };
    }

    return {
      ignored: false,
      responses: [{ text: 'Escolha *1* (Valor do Empréstimo) ou *2* (Pagamento):' }],
    };
  }

  private async handleLoanCreateEnterAmount(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const amount = parseCurrencyInput(input);
    if (!amount) {
      return {
        ignored: false,
        responses: [{ text: 'Valor inválido. Digite o valor emprestado (ex: 150,00):' }],
      };
    }

    await userService.updateSession(userId, 'LOAN_CREATE_ENTER_PERSON', {
      ...payload,
      totalAmount: amount,
    });

    return {
      ignored: false,
      responses: [
        {
          text: `Valor: *${formatBRL(amount)}*\nAgora digite o *nome de quem pegou o dinheiro emprestado*:`,
        },
      ],
    };
  }

  private async handleLoanCreateEnterPerson(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    await userService.updateSession(userId, 'LOAN_CREATE_ASK_INSTALLMENT', {
      ...payload,
      personName: input.trim(),
    });

    return {
      ignored: false,
      responses: [
        {
          text: [
            `Pessoa: *${input.trim()}*`,
            'Esse empréstimo foi *parcelado*?',
            '1. Não (À vista)',
            '2. Sim (Parcelado — divide para as tabelas dos próximos meses)',
          ].join('\n'),
        },
      ],
    };
  }

  private async handleLoanCreateAskInstallment(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const lower = input.toLowerCase();
    if (lower === '1' || lower === 'nao' || lower === 'não' || lower === 'n') {
      const res = await loanService.createLoan({
        userId,
        personName: payload.personName,
        totalAmount: payload.totalAmount,
        isInstallment: false,
        startMonth: refMonth,
      });

      await userService.updateSession(userId, 'MAIN_MENU', {});
      return {
        ignored: false,
        responses: [
          {
            text: [
              '✅ *Empréstimo registrado com sucesso!*',
              `• Pessoa: *${res.loan.personName}*`,
              `• Valor Emprestado: *${formatBRL(res.loan.totalAmount)}*`,
              '',
              this.getMainMenuText(),
            ].join('\n'),
          },
        ],
      };
    }

    if (lower === '2' || lower === 'sim' || lower === 's') {
      await userService.updateSession(userId, 'LOAN_CREATE_ENTER_INSTALLMENTS', payload);
      return {
        ignored: false,
        responses: [{ text: 'Em quantas *parcelas* será pago o empréstimo? (Ex: 3):' }],
      };
    }

    return {
      ignored: false,
      responses: [{ text: 'Responda com *1* (Não) ou *2* (Sim):' }],
    };
  }

  private async handleLoanCreateEnterInstallments(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const count = parseInt(input, 10);
    if (!Number.isFinite(count) || count < 2 || count > 120) {
      return {
        ignored: false,
        responses: [{ text: 'Digite um número de parcelas válido entre 2 e 120:' }],
      };
    }

    const res = await loanService.createLoan({
      userId,
      personName: payload.personName,
      totalAmount: payload.totalAmount,
      isInstallment: true,
      totalInstallments: count,
      startMonth: refMonth,
    });

    await userService.updateSession(userId, 'MAIN_MENU', {});
    return {
      ignored: false,
      responses: [
        {
          text: [
            '✅ *Empréstimo parcelado registrado com sucesso!*',
            `• Pessoa: *${res.loan.personName}*`,
            `• Valor Total: *${formatBRL(res.loan.totalAmount)}*`,
            `• Parcelas: *${count}x de ${formatBRL(res.monthlySchedule[0].amount)}*`,
            '',
            this.getMainMenuText(),
          ].join('\n'),
        },
      ],
    };
  }

  private async handleLoanPaymentEnterPerson(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const personName = input.trim();
    await userService.updateSession(userId, 'LOAN_PAYMENT_ENTER_AMOUNT', {
      ...payload,
      personName,
    });

    return {
      ignored: false,
      responses: [
        {
          text: `Pessoa selecionada: *${personName}*\nDigite o *valor pago* por ${personName} (ex: 50,00):`,
        },
      ],
    };
  }

  private async handleLoanPaymentEnterAmount(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const amount = parseCurrencyInput(input);
    if (!amount) {
      return {
        ignored: false,
        responses: [{ text: 'Valor inválido. Digite um valor positivo (ex: 50,00):' }],
      };
    }

    const result = await loanService.registerPaymentByPerson({
      userId,
      personName: payload.personName,
      amount,
      competenceMonth: refMonth,
    });

    await userService.updateSession(userId, 'MAIN_MENU', {});

    if (!result) {
      return {
        ignored: false,
        responses: [
          {
            text: [
              `⚠️ Não foi encontrado nenhum empréstimo em aberto para *"${payload.personName}"*.`,
              '',
              this.getMainMenuText(),
            ].join('\n'),
          },
        ],
      };
    }

    return {
      ignored: false,
      responses: [
        {
          text: [
            '✅ *Pagamento de empréstimo registrado!*',
            `• Pessoa: *${result.personName}*`,
            `• Valor abatido: *${formatBRL(result.amountPaidNow)}*`,
            `• Saldo restante a receber de ${result.personName}: *${formatBRL(result.totalRemainingForPerson)}*`,
            '',
            this.getMainMenuText(),
          ].join('\n'),
        },
      ],
    };
  }

  // ============================================================================
  // 4. GERAR TABELA DE GASTOS (30 / 60 / 90 DIAS — PNG OU XLSX)
  // ============================================================================
  private async handleTableSelectPeriod(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const periodMap: Record<string, PeriodDays> = {
      '1': 30,
      '30': 30,
      '2': 60,
      '60': 60,
      '3': 90,
      '90': 90,
    };

    const periodDays = periodMap[input];
    if (!periodDays) {
      return {
        ignored: false,
        responses: [{ text: 'Escolha *1* (30 dias), *2* (60 dias) ou *3* (90 dias):' }],
      };
    }

    await userService.updateSession(userId, 'TABLE_SELECT_FORMAT', {
      ...payload,
      periodDays,
    });

    return {
      ignored: false,
      responses: [
        {
          text: [
            `Período selecionado: *Últimos ${periodDays} dias (${getPeriodMonthsLabel(periodDays, refMonth)})*`,
            '',
            'Em qual formato deseja receber a Tabela de Gastos?',
            '1. Imagem (.png)',
            '2. Planilha Excel (.xlsx)',
            '3. Ambos (.png e .xlsx)',
          ].join('\n'),
        },
      ],
    };
  }

  private async handleTableSelectFormat(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    if (!['1', '2', '3'].includes(input)) {
      return {
        ignored: false,
        responses: [{ text: 'Escolha *1* (Imagem .png), *2* (Planilha .xlsx) ou *3* (Ambos):' }],
      };
    }

    const periodDays = (payload.periodDays ?? 30) as PeriodDays;
    const analytics = await analyticsService.getPeriodAnalytics(userId, periodDays, refMonth);
    const media = [];

    if (input === '1' || input === '3') {
      const pngBuffer = await generateTablePng(analytics);
      media.push({
        type: 'image' as const,
        buffer: pngBuffer,
        filename: `tabela-gastos-${periodDays}d.png`,
        mimetype: 'image/png',
        caption: `📊 Tabela de Gastos — Últimos ${periodDays} dias (${analytics.monthsLabel})`,
      });
    }

    if (input === '2' || input === '3') {
      const xlsxBuffer = await generateTableXlsx(analytics);
      media.push({
        type: 'document' as const,
        buffer: xlsxBuffer,
        filename: `tabela-gastos-${periodDays}d.xlsx`,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        caption: `📑 Planilha de Gastos — Últimos ${periodDays} dias (${analytics.monthsLabel})`,
      });
    }

    await userService.updateSession(userId, 'MAIN_MENU', {});

    return {
      ignored: false,
      responses: [
        {
          text: [
            `✅ *Tabela de Gastos dos últimos ${periodDays} dias (${analytics.monthsLabel}) gerada com sucesso!*`,
            `• Renda Total: *${formatBRL(analytics.kpis.totalIncome)}*`,
            `• Despesas Totais: *${formatBRL(analytics.kpis.totalExpenses)}*`,
            `• Empréstimos a receber: *${formatBRL(analytics.kpis.accountsReceivable)}*`,
          ].join('\n'),
          media,
        },
      ],
    };
  }

  // ============================================================================
  // 5. GERAR DASHBOARD DE GASTOS (30 / 60 / 90 DIAS — PNG)
  // ============================================================================
  private async handleDashboardSelectPeriod(
    userId: string,
    input: string,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const periodMap: Record<string, PeriodDays> = {
      '1': 30,
      '30': 30,
      '2': 60,
      '60': 60,
      '3': 90,
      '90': 90,
    };

    const periodDays = periodMap[input];
    if (!periodDays) {
      return {
        ignored: false,
        responses: [{ text: 'Escolha *1* (30 dias), *2* (60 dias) ou *3* (90 dias):' }],
      };
    }

    const analytics = await analyticsService.getPeriodAnalytics(userId, periodDays, refMonth);
    const pngBuffer = await generateDashboardPng(analytics);

    await userService.updateSession(userId, 'MAIN_MENU', {});

    const response: BotResponse = {
      text: [
        `📈 *Dashboard de Gastos — Últimos ${periodDays} dias (${analytics.monthsLabel})*`,
        `• Renda Total: *${formatBRL(analytics.kpis.totalIncome)}*`,
        `• Despesas Totais: *${formatBRL(analytics.kpis.totalExpenses)}*`,
        `• Empréstimos a receber: *${formatBRL(analytics.kpis.accountsReceivable)}*`,
      ].join('\n'),
      media: [
        {
          type: 'image',
          buffer: pngBuffer,
          filename: `dashboard-gastos-${periodDays}d.png`,
          mimetype: 'image/png',
          caption: `📈 Dashboard Financeiro — Últimos ${periodDays} dias (${analytics.monthsLabel})`,
        },
      ],
    };

    return {
      ignored: false,
      responses: [response],
    };
  }

  // ============================================================================
  // 6. RENDA E ORÇAMENTO
  // ============================================================================
  private async handleIncomeBalanceSubmenu(
    userId: string,
    input: string
  ): Promise<HandleMessageResult> {
    switch (input) {
      case '1': {
        await userService.updateSession(userId, 'INCOME_SELECT_CATEGORY', {});
        const cats = INCOME_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n');
        return {
          ignored: false,
          responses: [{ text: `💵 *Adicionar Renda / Receita*\nEscolha a categoria:\n\n${cats}` }],
        };
      }
      case '2': {
        await userService.updateSession(userId, 'BUDGET_SELECT_CATEGORY', {});
        const allCats = [...FIXED_AND_DASHBOARD_CATEGORIES, ...INCOME_CATEGORIES];
        const list = allCats.map((c, i) => `${i + 1}. ${c}`).join('\n');
        return {
          ignored: false,
          responses: [
            {
              text: `📋 *Definir Orçamento Mensal*\nEscolha a categoria:\n\n${list}`,
            },
          ],
        };
      }
      default:
        return {
          ignored: false,
          responses: [{ text: 'Escolha a opção 1 ou 2 (ou envie 0 para voltar ao menu):' }],
        };
    }
  }

  private async handleIncomeSelectCategory(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const idx = Number(input) - 1;
    const category =
      idx >= 0 && idx < INCOME_CATEGORIES.length
        ? INCOME_CATEGORIES[idx]
        : INCOME_CATEGORIES.find((c) => c.toLowerCase() === input.toLowerCase());

    if (!category) {
      return {
        ignored: false,
        responses: [{ text: `Escolha um número de 1 a ${INCOME_CATEGORIES.length}:` }],
      };
    }

    await userService.updateSession(userId, 'INCOME_ENTER_AMOUNT', {
      ...payload,
      category,
    });

    return {
      ignored: false,
      responses: [{ text: `Categoria: *${category}*\nDigite o *valor* recebido (ex: 2500,00):` }],
    };
  }

  private async handleIncomeEnterAmount(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const amount = parseCurrencyInput(input);
    if (!amount) {
      return {
        ignored: false,
        responses: [{ text: 'Valor inválido. Digite um valor positivo (ex: 2500,00):' }],
      };
    }

    await transactionService.addIncome({
      userId,
      category: payload.category,
      amount,
      competenceMonth: refMonth,
    });

    await userService.updateSession(userId, 'MAIN_MENU', {});
    return {
      ignored: false,
      responses: [
        {
          text: [
            '✅ *Receita registrada com sucesso!*',
            `• Categoria: *${payload.category}*`,
            `• Valor: *${formatBRL(amount)}*`,
            '',
            this.getMainMenuText(),
          ].join('\n'),
        },
      ],
    };
  }

  private async handleBudgetSelectCategory(
    userId: string,
    input: string,
    payload: Record<string, any>
  ): Promise<HandleMessageResult> {
    const allCats = [...FIXED_AND_DASHBOARD_CATEGORIES, ...INCOME_CATEGORIES];
    const idx = Number(input) - 1;
    const category =
      idx >= 0 && idx < allCats.length
        ? allCats[idx]
        : allCats.find((c) => c.toLowerCase() === input.toLowerCase());

    if (!category) {
      return {
        ignored: false,
        responses: [{ text: `Escolha um número de 1 a ${allCats.length}:` }],
      };
    }

    await userService.updateSession(userId, 'BUDGET_ENTER_AMOUNT', {
      ...payload,
      category,
    });

    return {
      ignored: false,
      responses: [
        {
          text: `Categoria: *${category}*\nDigite o valor de *Orçamento Mensal* planejado para esta categoria (ex: 800,00):`,
        },
      ],
    };
  }

  private async handleBudgetEnterAmount(
    userId: string,
    input: string,
    payload: Record<string, any>,
    refMonth: string
  ): Promise<HandleMessageResult> {
    const amount = parseCurrencyInput(input);
    if (!amount) {
      return {
        ignored: false,
        responses: [{ text: 'Digite um valor válido (ex: 800,00):' }],
      };
    }

    await budgetGoalService.setCategoryBudget(userId, payload.category, amount, refMonth);
    await userService.updateSession(userId, 'MAIN_MENU', {});

    return {
      ignored: false,
      responses: [
        {
          text: `✅ *Orçamento mensal de ${formatBRL(amount)} definido para ${payload.category}!*\n\n${this.getMainMenuText()}`,
        },
      ],
    };
  }
}

export const botEngine = new BotEngine();
