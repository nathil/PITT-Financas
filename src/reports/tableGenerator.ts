import ExcelJS from 'exceljs';
import { PeriodAnalytics, BudgetComparisonRow } from '../services/analyticsService';
import { formatCompetenceMonthPt } from '../utils/dateCompetence';
import { renderHtmlToPngBuffer } from './browserPool';

function formatNumberPt(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (Math.abs(value) < 0.005) return '-';
  return value < 0 ? `(${formatted})` : formatted;
}

/**
 * Gera a Tabela de Gastos em formato .xlsx (Excel) no estilo e paleta do Dashboard:
 * #532728, #D6BF93, #F3DDB6, #CED0BA, #F2EFCE
 */
export async function generateTableXlsx(analytics: PeriodAnalytics): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PITT Finanças Chatbot Financeiro';
  workbook.created = new Date();

  const sheetName = `Tabela ${analytics.periodDays}d`.slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ showGridLines: true }],
  });

  sheet.columns = [
    { key: 'colA', width: 34 },
    { key: 'colB', width: 16 },
    { key: 'colC', width: 16 },
    { key: 'colD', width: 16 },
    { key: 'spacer', width: 4 },
    { key: 'colF', width: 34 },
    { key: 'colG', width: 16 },
    { key: 'colH', width: 16 },
    { key: 'colI', width: 16 },
  ];

  // Título Principal com os nomes dos meses (#532728 com texto #F2EFCE)
  sheet.mergeCells('A1:I1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `TABELA DE GASTOS – ÚLTIMOS ${analytics.periodDays} DIAS (${analytics.monthsLabel.toUpperCase()})`;
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFF2EFCE' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF532728' },
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 30;

  const styleSectionHeader = (
    rowNum: number,
    startCol: 'A' | 'F',
    title: string,
    bgColorArgb: string = 'FF532728',
    fontColorArgb: string = 'FFFFFFFF'
  ) => {
    const cols = startCol === 'A' ? ['A', 'B', 'C', 'D'] : ['F', 'G', 'H', 'I'];
    const headers = [title, 'Orçamento', 'Atual', 'Diferença'];
    headers.forEach((h, idx) => {
      const cell = sheet.getCell(`${cols[idx]}${rowNum}`);
      cell.value = h;
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: fontColorArgb } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgColorArgb },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: idx === 0 ? 'left' : 'right',
      };
    });
    sheet.getRow(rowNum).height = 22;
  };

  const writeComparisonRow = (
    rowNum: number,
    startCol: 'A' | 'F',
    row: BudgetComparisonRow,
    options: { isTotal?: boolean; bgColorArgb?: string } = {}
  ) => {
    const cols = startCol === 'A' ? ['A', 'B', 'C', 'D'] : ['F', 'G', 'H', 'I'];
    const cLabel = sheet.getCell(`${cols[0]}${rowNum}`);
    const cBudget = sheet.getCell(`${cols[1]}${rowNum}`);
    const cActual = sheet.getCell(`${cols[2]}${rowNum}`);
    const cDiff = sheet.getCell(`${cols[3]}${rowNum}`);

    cLabel.value = row.label;
    cBudget.value = row.budgeted;
    cActual.value = row.actual;
    cDiff.value = row.difference;

    const numFmt = '#,##0.00;(#,##0.00);"-"';
    cBudget.numFmt = numFmt;
    cActual.numFmt = numFmt;
    cDiff.numFmt = numFmt;

    [cLabel, cBudget, cActual, cDiff].forEach((cell, idx) => {
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: Boolean(options.isTotal),
        color:
          idx === 3 && row.difference < 0
            ? { argb: 'FF9B1C1C' }
            : { argb: 'FF2D2926' },
      };
      if (options.bgColorArgb) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: options.bgColorArgb },
        };
      }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5E0D5' } },
      };
    });
  };

  // Lado Esquerdo (Colunas A..D): RENDA
  let leftRow = 3;
  styleSectionHeader(leftRow++, 'A', 'RENDA', 'FF532728', 'FFFFFFFF');
  for (const r of analytics.incomeRows) {
    writeComparisonRow(leftRow++, 'A', r);
  }
  writeComparisonRow(leftRow++, 'A', analytics.budgetSummaryRows.totalIncome, {
    isTotal: true,
    bgColorArgb: 'FFCED0BA',
  });

  leftRow += 2;
  // Bloco DESPESAS FIXAS (Colunas A..D)
  const fixCols = ['A', 'B', 'C', 'D'];
  ['DESPESAS FIXAS', 'Comprometido', 'Pago', 'Diferença'].forEach((h, idx) => {
    const cell = sheet.getCell(`${fixCols[idx]}${leftRow}`);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF532728' } };
    cell.alignment = { vertical: 'middle', horizontal: idx === 0 ? 'left' : 'right' };
  });
  sheet.getRow(leftRow).height = 22;
  leftRow++;

  if (analytics.fixedExpenseRows.length === 0) {
    sheet.getCell(`A${leftRow}`).value = 'Nenhuma despesa fixa cadastrada';
    leftRow++;
  } else {
    for (const fe of analytics.fixedExpenseRows) {
      writeComparisonRow(leftRow++, 'A', {
        label: fe.description,
        budgeted: fe.periodCommitted,
        actual: fe.periodPaid,
        difference: -fe.periodRemaining,
      });
    }
    writeComparisonRow(
      leftRow++,
      'A',
      {
        label: 'Total Despesas Fixas',
        budgeted: analytics.kpis.fixedExpensesCommittedTotal,
        actual: analytics.kpis.fixedExpensesPaidTotal,
        difference: -(
          analytics.kpis.fixedExpensesCommittedTotal - analytics.kpis.fixedExpensesPaidTotal
        ),
      },
      { isTotal: true, bgColorArgb: 'FFCED0BA' }
    );
  }

  // Lado Direito (Colunas F..I): RESUMO DO ORÇAMENTO e DESPESAS POR CATEGORIA
  let rightRow = 3;
  styleSectionHeader(rightRow++, 'F', 'RESUMO DO ORÇAMENTO', 'FF532728', 'FFFFFFFF');
  writeComparisonRow(rightRow++, 'F', analytics.budgetSummaryRows.totalIncome);
  writeComparisonRow(rightRow++, 'F', analytics.budgetSummaryRows.totalExpenses, {
    isTotal: true,
    bgColorArgb: 'FFCED0BA',
  });

  rightRow += 2;
  styleSectionHeader(rightRow++, 'F', 'DESPESAS POR CATEGORIA', 'FF532728', 'FFFFFFFF');
  for (const catRow of analytics.categoryExpenseRows) {
    writeComparisonRow(rightRow++, 'F', catRow);
  }
  writeComparisonRow(rightRow++, 'F', analytics.budgetSummaryRows.totalExpenses, {
    isTotal: true,
    bgColorArgb: 'FFCED0BA',
  });

  // Bloco EMPRÉSTIMOS na parte inferior
  let bottomRow = Math.max(leftRow, rightRow) + 2;
  ['EMPRÉSTIMOS (PESSOA)', 'Emprestado', 'Pago', 'A Receber'].forEach((h, idx) => {
    const cell = sheet.getCell(`${fixCols[idx]}${bottomRow}`);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF532728' } };
    cell.alignment = { vertical: 'middle', horizontal: idx === 0 ? 'left' : 'right' };
  });
  sheet.getRow(bottomRow).height = 22;
  bottomRow++;

  if (analytics.loanRows.length === 0) {
    sheet.getCell(`A${bottomRow}`).value = 'Nenhum empréstimo registrado';
  } else {
    for (const loan of analytics.loanRows) {
      writeComparisonRow(bottomRow++, 'A', {
        label: loan.personName,
        budgeted: loan.totalAmount,
        actual: loan.paidAmount,
        difference: loan.remainingBalance,
      });
    }
    writeComparisonRow(
      bottomRow++,
      'A',
      {
        label: 'Total Empréstimos em Aberto',
        budgeted: analytics.loanRows.reduce((a, b) => a + b.totalAmount, 0),
        actual: analytics.loanRows.reduce((a, b) => a + b.paidAmount, 0),
        difference: analytics.kpis.accountsReceivable,
      },
      { isTotal: true, bgColorArgb: 'FFCED0BA' }
    );
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Gera a Tabela de Gastos em imagem .png seguindo exatamente o estilo visual e a paleta do Dashboard:
 * Fundo #EAEAEA, cards brancos arredondados, cabeçalho com pill do mês e cores #532728, #D6BF93, #F3DDB6, #CED0BA, #F2EFCE.
 */
export async function generateTablePng(analytics: PeriodAnalytics): Promise<Buffer> {
  const monthNamesOnly = analytics.competenceMonths.map((m) => formatCompetenceMonthPt(m, false));
  const monthPillText =
    monthNamesOnly.length === 1
      ? monthNamesOnly[0]
      : monthNamesOnly.length === 2
        ? `${monthNamesOnly[0]} e ${monthNamesOnly[1]}`
        : `${monthNamesOnly.slice(0, -1).join(', ')} e ${monthNamesOnly[monthNamesOnly.length - 1]}`;

  const renderRows = (rows: BudgetComparisonRow[]) =>
    rows
      .map((r, idx) => {
        const isNeg = r.difference < -0.005;
        const diffClass = isNeg ? 'neg' : '';
        const zebra = idx % 2 === 1 ? 'zebra' : '';
        return `
          <tr class="${zebra}">
            <td class="label">${escapeHtml(r.label)}</td>
            <td class="num">${formatNumberPt(r.budgeted)}</td>
            <td class="num">${formatNumberPt(r.actual)}</td>
            <td class="num ${diffClass}">${formatNumberPt(r.difference)}</td>
          </tr>
        `;
      })
      .join('');

  const fixedRowsHtml =
    analytics.fixedExpenseRows.length === 0
      ? `<tr><td class="label" colspan="4">Nenhuma despesa fixa cadastrada no período</td></tr>`
      : analytics.fixedExpenseRows
          .map(
            (fe, idx) => `
          <tr class="${idx % 2 === 1 ? 'zebra' : ''}">
            <td class="label">${escapeHtml(fe.description)}</td>
            <td class="num">${formatNumberPt(fe.periodCommitted)}</td>
            <td class="num">${formatNumberPt(fe.periodPaid)}</td>
            <td class="num ${fe.periodRemaining > 0 ? 'neg' : ''}">${formatNumberPt(-fe.periodRemaining)}</td>
          </tr>
        `
          )
          .join('');

  const loanRowsHtml =
    analytics.loanRows.length === 0
      ? `<tr><td class="label" colspan="4">Nenhum empréstimo registrado no período</td></tr>`
      : analytics.loanRows
          .map(
            (l, idx) => `
          <tr class="${idx % 2 === 1 ? 'zebra' : ''}">
            <td class="label">${escapeHtml(l.personName)}</td>
            <td class="num">${formatNumberPt(l.totalAmount)}</td>
            <td class="num">${formatNumberPt(l.paidAmount)}</td>
            <td class="num ${l.remainingBalance > 0 ? 'pos-highlight' : ''}">${formatNumberPt(l.remainingBalance)}</td>
          </tr>
        `
          )
          .join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #EAEAEA;
      color: #2D2926;
      padding: 32px 38px 34px 38px;
      width: 1400px;
    }

    /* CABEÇALHO SUPERIOR IDÊNTICO AO DASHBOARD */
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
    }
    .header-left h1 {
      font-size: 23px;
      font-weight: 700;
      color: #2D2926;
      letter-spacing: 0.2px;
      text-transform: uppercase;
    }
    .header-left .subtitle {
      font-size: 11.5px;
      color: #9E9E9E;
      margin-top: 4px;
      font-weight: 400;
    }
    .filter-pills {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
    }
    .calendar-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid #532728;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      color: #2D2926;
    }
    .month-pill {
      height: 32px;
      padding: 0 24px;
      border-radius: 999px;
      border: 1px solid #532728;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11.5px;
      font-weight: 600;
      color: #2D2926;
      background: transparent;
    }
    .period-pill {
      background: #532728;
      color: #FFFFFF;
      padding: 13px 38px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      min-width: 280px;
      box-shadow: 0 2px 6px rgba(83, 39, 40, 0.18);
    }

    /* GRID DE TABELAS QUADRADAS */
    .grid-2col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
    }
    .table-card {
      background: #FFFFFF;
      border-radius: 0;
      overflow: hidden;
      margin-bottom: 20px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
    }
    table.fin-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    table.fin-table thead th {
      background: #532728;
      color: #FFFFFF;
      font-weight: 600;
      font-size: 11.5px;
      padding: 11px 14px;
      text-align: right;
      letter-spacing: 0.3px;
    }
    table.fin-table thead th:first-child {
      text-align: left;
      text-transform: uppercase;
    }
    table.fin-table td {
      padding: 9px 14px;
      border-bottom: 1px solid #F2F2F2;
      color: #2D2926;
    }
    table.fin-table tr.zebra td {
      background: #FAF8F2;
    }
    table.fin-table td.label {
      text-align: left;
      font-weight: 500;
    }
    table.fin-table td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    table.fin-table td.neg {
      color: #9B1C1C;
      font-weight: 700;
    }
    table.fin-table td.pos-highlight {
      color: #532728;
      font-weight: 700;
    }
    tr.total-sage td {
      background: #CED0BA !important;
      color: #2D2926;
      font-weight: 700;
      border-top: 2px solid #B5B8A0;
      border-bottom: none;
    }
    tr.total-sage td.neg {
      color: #9B1C1C !important;
    }
    .footer-note {
      margin-top: 4px;
      font-size: 11px;
      color: #8E8E8E;
      text-align: right;
    }
  </style>
</head>
<body>
  <!-- TOPO NO ESTILO DO DASHBOARD -->
  <div class="header-row">
    <div class="header-left">
      <h1>SUA TABELA DE GASTOS – ÚLTIMOS ${analytics.periodDays} DIAS</h1>
      <div class="subtitle">PITT Finanças é o melhor jeito de organizar sua vida financeira!</div>
      <div class="filter-pills">
        <div class="calendar-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2D2926" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </div>
        <div class="month-pill">${escapeHtml(monthPillText)}</div>
      </div>
    </div>
    <div class="period-pill">
      Período: ${analytics.periodDays} dias (${escapeHtml(analytics.monthsLabel)})
    </div>
  </div>

  <div class="grid-2col">
    <!-- COLUNA ESQUERDA -->
    <div>
      <div class="table-card">
        <table class="fin-table">
          <thead>
            <tr>
              <th>RENDA</th>
              <th>Orçamento</th>
              <th>Atual</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            ${renderRows(analytics.incomeRows)}
            <tr class="total-sage">
              <td class="label">Renda Total</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalIncome.budgeted)}</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalIncome.actual)}</td>
              <td class="num ${analytics.budgetSummaryRows.totalIncome.difference < 0 ? 'neg' : ''}">
                ${formatNumberPt(analytics.budgetSummaryRows.totalIncome.difference)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="table-card">
        <table class="fin-table">
          <thead>
            <tr>
              <th>DESPESAS FIXAS</th>
              <th>Comprometido</th>
              <th>Pago</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            ${fixedRowsHtml}
            <tr class="total-sage">
              <td class="label">Total Despesas Fixas</td>
              <td class="num">${formatNumberPt(analytics.kpis.fixedExpensesCommittedTotal)}</td>
              <td class="num">${formatNumberPt(analytics.kpis.fixedExpensesPaidTotal)}</td>
              <td class="num ${
                analytics.kpis.fixedExpensesCommittedTotal - analytics.kpis.fixedExpensesPaidTotal > 0
                  ? 'neg'
                  : ''
              }">
                ${formatNumberPt(
                  -(
                    analytics.kpis.fixedExpensesCommittedTotal -
                    analytics.kpis.fixedExpensesPaidTotal
                  )
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="table-card" style="margin-bottom: 0;">
        <table class="fin-table">
          <thead>
            <tr>
              <th>EMPRÉSTIMOS (PESSOA)</th>
              <th>Emprestado</th>
              <th>Pago</th>
              <th>A Receber</th>
            </tr>
          </thead>
          <tbody>
            ${loanRowsHtml}
            <tr class="total-sage">
              <td class="label">Total Empréstimos em Aberto</td>
              <td class="num">${formatNumberPt(
                analytics.loanRows.reduce((a, b) => a + b.totalAmount, 0)
              )}</td>
              <td class="num">${formatNumberPt(
                analytics.loanRows.reduce((a, b) => a + b.paidAmount, 0)
              )}</td>
              <td class="num pos-highlight">${formatNumberPt(analytics.kpis.accountsReceivable)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- COLUNA DIREITA -->
    <div>
      <div class="table-card">
        <table class="fin-table">
          <thead>
            <tr>
              <th>RESUMO DO ORÇAMENTO</th>
              <th>Orçamento</th>
              <th>Atual</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="label">Renda Total</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalIncome.budgeted)}</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalIncome.actual)}</td>
              <td class="num ${analytics.budgetSummaryRows.totalIncome.difference < 0 ? 'neg' : ''}">
                ${formatNumberPt(analytics.budgetSummaryRows.totalIncome.difference)}
              </td>
            </tr>
            <tr class="total-sage">
              <td class="label">Despesas Totais</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalExpenses.budgeted)}</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalExpenses.actual)}</td>
              <td class="num ${analytics.budgetSummaryRows.totalExpenses.difference < 0 ? 'neg' : ''}">
                ${formatNumberPt(analytics.budgetSummaryRows.totalExpenses.difference)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="table-card" style="margin-bottom: 0;">
        <table class="fin-table">
          <thead>
            <tr>
              <th>DESPESAS POR CATEGORIA</th>
              <th>Orçamento</th>
              <th>Atual</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            ${renderRows(analytics.categoryExpenseRows)}
            <tr class="total-sage">
              <td class="label">Total Despesas por Categoria</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalExpenses.budgeted)}</td>
              <td class="num">${formatNumberPt(analytics.budgetSummaryRows.totalExpenses.actual)}</td>
              <td class="num ${analytics.budgetSummaryRows.totalExpenses.difference < 0 ? 'neg' : ''}">
                ${formatNumberPt(analytics.budgetSummaryRows.totalExpenses.difference)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <div class="footer-note">
    Gerado automaticamente por PITT Finanças — Organização Financeira (${escapeHtml(analytics.monthsLabel)})
  </div>
</body>
</html>`;

  return renderHtmlToPngBuffer(html, { width: 1400, height: 830 });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
