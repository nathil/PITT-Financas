export type BotState =
  | 'MAIN_MENU'
  // 1. Adicionar Gastos
  | 'EXPENSE_SELECT_CATEGORY'
  | 'EXPENSE_ENTER_AMOUNT'
  | 'EXPENSE_ENTER_DESCRIPTION'
  | 'EXPENSE_ASK_INSTALLMENT'
  | 'EXPENSE_ENTER_INSTALLMENTS'
  // 2. Despesas Fixas
  | 'FIXED_SUBMENU'
  | 'FIXED_SELECT_CATEGORY'
  | 'FIXED_ENTER_DESCRIPTION'
  | 'FIXED_ENTER_AMOUNT'
  | 'FIXED_ASK_INSTALLMENT'
  | 'FIXED_ENTER_INSTALLMENTS'
  | 'FIXED_PAYMENT_ENTER_AMOUNT'
  // 3. Empréstimo
  | 'LOAN_SUBMENU'
  | 'LOAN_CREATE_ENTER_AMOUNT'
  | 'LOAN_CREATE_ENTER_PERSON'
  | 'LOAN_CREATE_ASK_INSTALLMENT'
  | 'LOAN_CREATE_ENTER_INSTALLMENTS'
  | 'LOAN_PAYMENT_ENTER_PERSON'
  | 'LOAN_PAYMENT_ENTER_AMOUNT'
  // 4. Gerar Tabela de Gastos
  | 'TABLE_SELECT_PERIOD'
  | 'TABLE_SELECT_FORMAT'
  // 5. Gerar Dashboard de Gastos
  | 'DASHBOARD_SELECT_PERIOD'
  // 6. Renda e Orçamento
  | 'INCOME_BALANCE_SUBMENU'
  | 'INCOME_SELECT_CATEGORY'
  | 'INCOME_ENTER_AMOUNT'
  | 'BUDGET_SELECT_CATEGORY'
  | 'BUDGET_ENTER_AMOUNT';

export interface BotMediaAttachment {
  type: 'image' | 'document';
  buffer: Buffer;
  filename: string;
  mimetype: string;
  caption?: string;
}

export interface BotResponse {
  text?: string;
  media?: BotMediaAttachment[];
}

export interface HandleMessageResult {
  ignored: boolean;
  reason?: string;
  responses: BotResponse[];
}
