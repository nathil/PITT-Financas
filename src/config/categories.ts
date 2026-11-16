export const VARIABLE_EXPENSE_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Educação',
  'Saúde e Bem-Estar',
  'Streaming',
  'Dívidas e Compromissos Financeiros',
  'Lazer e Estilo de Vida',
  'Outros',
] as const;

export type VariableExpenseCategory = (typeof VARIABLE_EXPENSE_CATEGORIES)[number];

export const FIXED_AND_DASHBOARD_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Educação',
  'Saúde e Bem-Estar',
  'Streaming',
  'Dívidas e Compromissos Financeiros',
  'Lazer e Estilo de Vida',
  'Reserva de Emergência',
  'Outros',
] as const;

export type FixedAndDashboardCategory = (typeof FIXED_AND_DASHBOARD_CATEGORIES)[number];

export const INCOME_CATEGORIES = [
  'Salário',
  'Renda Extra',
  'Outros',
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const MONTH_NAMES_PT: Record<number, string> = {
  1: 'Janeiro',
  2: 'Fevereiro',
  3: 'Março',
  4: 'Abril',
  5: 'Maio',
  6: 'Junho',
  7: 'Julho',
  8: 'Agosto',
  9: 'Setembro',
  10: 'Outubro',
  11: 'Novembro',
  12: 'Dezembro',
};

export const MONTH_SHORT_PT: Record<number, string> = {
  1: 'JAN',
  2: 'FEV',
  3: 'MAR',
  4: 'ABR',
  5: 'MAI',
  6: 'JUN',
  7: 'JUL',
  8: 'AGO',
  9: 'SET',
  10: 'OUT',
  11: 'NOV',
  12: 'DEZ',
};
