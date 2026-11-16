import { MONTH_NAMES_PT, MONTH_SHORT_PT } from '../config/categories';

export type PeriodDays = 30 | 60 | 90;

/**
 * Retorna a competência "YYYY-MM" de uma data (ou da data atual).
 */
export function getCurrentCompetenceMonth(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Soma (ou subtrai) `offset` meses a partir de uma competência "YYYY-MM".
 */
export function addMonthsToCompetence(competenceMonth: string, offset: number): string {
  const [yearStr, monthStr] = competenceMonth.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // 0-based
  const target = new Date(year, monthIndex + offset, 1);
  return getCurrentCompetenceMonth(target);
}

/**
 * Retorna o nome por extenso do mês em português a partir de "YYYY-MM"
 * Ex: "2026-11" -> "Novembro/2026" ou apenas "Novembro"
 */
export function formatCompetenceMonthPt(
  competenceMonth: string,
  includeYear: boolean = true
): string {
  const [yearStr, monthStr] = competenceMonth.split('-');
  const monthNum = Number(monthStr);
  const monthName = MONTH_NAMES_PT[monthNum] ?? monthStr;
  return includeYear ? `${monthName}/${yearStr}` : monthName;
}

/**
 * Retorna abreviação de 3 letras do mês (ex: "NOV/26" ou "NOV")
 */
export function formatCompetenceMonthShortPt(
  competenceMonth: string,
  includeYear: boolean = false
): string {
  const [yearStr, monthStr] = competenceMonth.split('-');
  const monthNum = Number(monthStr);
  const shortName = MONTH_SHORT_PT[monthNum] ?? monthStr;
  return includeYear ? `${shortName}/${yearStr.slice(-2)}` : shortName;
}

/**
 * Retorna a lista ordenada de meses de competência ("YYYY-MM") correspondente
 * aos últimos 30 dias (1 mês), 60 dias (2 meses) ou 90 dias (3 meses).
 */
export function getCompetenceMonthsForPeriod(
  periodDays: PeriodDays,
  referenceMonth: string = getCurrentCompetenceMonth()
): string[] {
  const count = periodDays === 30 ? 1 : periodDays === 60 ? 2 : 3;
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(addMonthsToCompetence(referenceMonth, -i));
  }
  return months;
}

/**
 * Gera o label legível com os nomes dos meses que referem-se à Tabela ou Dashboard.
 * Ex (30 dias): "Novembro/2026"
 * Ex (60 dias): "Outubro/2026 e Novembro/2026"
 * Ex (90 dias): "Setembro/2026, Outubro/2026 e Novembro/2026"
 */
export function getPeriodMonthsLabel(
  periodDays: PeriodDays,
  referenceMonth: string = getCurrentCompetenceMonth()
): string {
  const months = getCompetenceMonthsForPeriod(periodDays, referenceMonth);
  const names = months.map((m) => formatCompetenceMonthPt(m, true));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * Divide um valor monetário total em N parcelas com precisão de 2 casas decimais,
 * ajustando eventual diferença de centavos na primeira parcela.
 */
export function splitInstallmentAmounts(totalAmount: number, installments: number): number[] {
  if (installments <= 1) {
    return [Math.round(totalAmount * 100) / 100];
  }
  const baseCents = Math.floor((Math.round(totalAmount * 100)) / installments);
  const remainderCents = Math.round(totalAmount * 100) - baseCents * installments;

  const result: number[] = [];
  for (let i = 0; i < installments; i++) {
    const cents = i === 0 ? baseCents + remainderCents : baseCents;
    result.push(cents / 100);
  }
  return result;
}

/**
 * Faz o parse de um valor monetário digitado pelo usuário no WhatsApp
 * Ex: "R$ 1.250,50" -> 1250.5, "45,90" -> 45.9, "100" -> 100
 */
export function parseCurrencyInput(input: string): number | null {
  if (!input) return null;
  let cleaned = input
    .replace(/[R$\s]/gi, '')
    .trim();

  if (!cleaned) return null;

  // Se tiver ponto e vírgula (ex: 1.234,56), remove pontos e troca vírgula por ponto
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    // Ex: 1234,56
    cleaned = cleaned.replace(',', '.');
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

/**
 * Formata um número em moeda brasileira (R$ 1.234,56).
 */
export function formatBRL(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-R$ ${formatted}` : `R$ ${formatted}`;
}
