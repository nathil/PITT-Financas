import { PeriodAnalytics } from '../services/analyticsService';
import { formatCompetenceMonthPt } from '../utils/dateCompetence';
import { getInlineChartJsScript, renderHtmlToPngBuffer } from './browserPool';

function fmtCurrencyCompact(val: number): string {
  const isWhole = Math.abs(val - Math.round(val)) < 0.005;
  return val.toLocaleString('pt-BR', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function fmtCurrencyFull(val: number): string {
  return val.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CATEGORY_PALETTE = [
  '#532728',
  '#D6BF93',
  '#CED0BA',
  '#F3DDB6',
  '#8C4A4C',
  '#B59B6D',
  '#9FA387',
  '#E5C796',
  '#F2EFCE',
];

/**
 * Gera o Dashboard de Gastos em .png seguindo o modelo visual "SEU DASHBOARD":
 * - Na pílula ao lado do ícone de calendário, exibe o(s) nome(s) do(s) mês(es) de referência.
 * - No card do gráfico de pizza/rosca, exibe os gastos por categoria com seus valores e respectivas porcentagens.
 */
export async function generateDashboardPng(analytics: PeriodAnalytics): Promise<Buffer> {
  const chartJsCode = getInlineChartJsScript();

  const monthLabels = analytics.charts.monthlySeries.map((m) => m.shortLabel);
  const incomeSeries = analytics.charts.monthlySeries.map((m) => m.income);
  const expenseSeries = analytics.charts.monthlySeries.map((m) => m.expenses);

  // Nome(s) do(s) mês(es) sem o ano para a pílula de Mês (ex: "Novembro" ou "Setembro, Outubro e Novembro")
  const monthNamesOnly = analytics.competenceMonths.map((m) => formatCompetenceMonthPt(m, false));
  const monthPillText =
    monthNamesOnly.length === 1
      ? monthNamesOnly[0]
      : monthNamesOnly.length === 2
        ? `${monthNamesOnly[0]} e ${monthNamesOnly[1]}`
        : `${monthNamesOnly.slice(0, -1).join(', ')} e ${monthNamesOnly[monthNamesOnly.length - 1]}`;

  const allCategories = analytics.charts.expensesByCategory;
  const catLabels = allCategories.map((c) => c.category);
  const catValues = allCategories.map((c) => c.totalAmount);

  const openLoansCount = analytics.loanRows.filter((l) => l.status === 'OPEN').length;

  const categoryLegendHtml = allCategories
    .map((c, idx) => {
      const color = CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length];
      const pct = c.percentageOfExpenses.toFixed(1).replace('.', ',');
      return `
        <div class="cat-row">
          <div class="cat-left">
            <span class="cat-dot" style="background: ${color};"></span>
            <span class="cat-name">${escapeHtml(c.category)}</span>
          </div>
          <div class="cat-right">
            <span class="cat-val">R$ ${fmtCurrencyFull(c.totalAmount)}</span>
            <span class="cat-pct">${pct}%</span>
          </div>
        </div>
      `;
    })
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
      padding: 32px 38px 36px 38px;
      width: 1400px;
    }

    /* CABEÇALHO SUPERIOR */
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 22px;
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
      padding: 13px 44px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      min-width: 280px;
      box-shadow: 0 2px 6px rgba(83, 39, 40, 0.18);
    }

    /* LINHA DE 4 CARDS DE KPI */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 22px;
      margin-bottom: 26px;
    }
    .kpi-card {
      background: #F8F8F8;
      border-radius: 10px;
      padding: 16px 18px 18px 18px;
      height: 148px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
    }
    .kpi-title {
      font-size: 11.5px;
      color: #6E6E6E;
      font-weight: 500;
      text-align: left;
    }
    .kpi-value {
      font-size: 27px;
      font-weight: 700;
      color: #2D2926;
      text-align: center;
      letter-spacing: -0.3px;
    }
    .kpi-sub {
      font-size: 10.5px;
      color: #9E9E9E;
      text-align: center;
      font-weight: 400;
    }

    /* LINHA INFERIOR COM OS 2 GRÁFICOS */
    .charts-grid {
      display: grid;
      grid-template-columns: 1.35fr 1.15fr;
      gap: 24px;
    }
    .chart-card {
      background: #FFFFFF;
      border-radius: 12px;
      padding: 20px 28px 20px 28px;
      height: 370px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .chart-top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .chart-title {
      font-size: 11.5px;
      color: #6E6E6E;
      font-weight: 500;
    }
    .legend-custom {
      display: flex;
      align-items: center;
      gap: 26px;
      margin-right: 20px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11px;
      color: #555555;
    }
    .legend-dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12);
    }
    .legend-dot.ganho { background: #F3DDB6; }
    .legend-dot.gasto { background: #532728; }

    .bar-canvas-wrap {
      height: 265px;
      width: 94%;
      margin: 0 auto;
    }
    .chart-bottom-label {
      text-align: center;
      font-size: 11.5px;
      color: #6E6E6E;
      font-weight: 500;
      margin-top: 4px;
    }

    /* CARD DIREITO: ROSCA + LISTA DE GASTOS E PORCENTAGENS POR CATEGORIA */
    .donut-card {
      background: #FFFFFF;
      border-radius: 12px;
      padding: 20px 24px;
      height: 370px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .donut-content {
      display: grid;
      grid-template-columns: 205px 1fr;
      gap: 18px;
      align-items: center;
      flex: 1;
    }
    .donut-wrap {
      width: 205px;
      height: 205px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cat-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .cat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      padding-bottom: 5px;
      border-bottom: 1px solid #F2F2F2;
      gap: 8px;
    }
    .cat-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .cat-left {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #3D3D3D;
      font-weight: 500;
      white-space: nowrap;
    }
    .cat-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      flex-shrink: 0;
      border: 1px solid rgba(83, 39, 40, 0.2);
    }
    .cat-right {
      display: flex;
      align-items: center;
      gap: 8px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .cat-val {
      color: #2D2926;
      font-weight: 600;
    }
    .cat-pct {
      background: #F3DDB6;
      color: #532728;
      font-weight: 700;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 6px;
      min-width: 44px;
      text-align: right;
    }
  </style>
  <script>${chartJsCode}</script>
</head>
<body>
  <!-- TOPO -->
  <div class="header-row">
    <div class="header-left">
      <h1>SEU DASHBOARD – ÚLTIMOS ${analytics.periodDays} DIAS</h1>
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

  <!-- 4 CARDS DE KPI -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">Renda Total</div>
      <div class="kpi-value">R$ ${fmtCurrencyCompact(analytics.kpis.totalIncome)}</div>
      <div class="kpi-sub">Somatório de Ganhos no Período</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">Despesas Totais</div>
      <div class="kpi-value">R$ ${fmtCurrencyCompact(analytics.kpis.totalExpenses)}</div>
      <div class="kpi-sub">Fixas: R$ ${fmtCurrencyCompact(analytics.kpis.fixedExpensesCommittedTotal)} | Var: R$ ${fmtCurrencyCompact(analytics.kpis.variableExpensesTotal)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">Contas a Receber (Empréstimos)</div>
      <div class="kpi-value">R$ ${fmtCurrencyCompact(analytics.kpis.accountsReceivable)}</div>
      <div class="kpi-sub">${openLoansCount} empréstimo(s) em aberto</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">Despesas Fixas</div>
      <div class="kpi-value">R$ ${fmtCurrencyCompact(analytics.kpis.fixedExpensesCommittedTotal)}</div>
      <div class="kpi-sub">Pendentes no período</div>
    </div>
  </div>

  <!-- 2 CARDS DE GRÁFICOS -->
  <div class="charts-grid">
    <!-- CARD ESQUERDO: FLUXO DE RENDA -->
    <div class="chart-card">
      <div class="chart-top-bar">
        <div class="chart-title">Fluxo de Renda</div>
        <div class="legend-custom">
          <div class="legend-item">
            <span class="legend-dot ganho"></span>
            <span>Ganho</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot gasto"></span>
            <span>Gasto</span>
          </div>
        </div>
      </div>

      <div class="bar-canvas-wrap">
        <canvas id="incomeFlowChart"></canvas>
      </div>

      <div class="chart-bottom-label">Comparativo Mensal</div>
    </div>

    <!-- CARD DIREITO: ROSCA DE DESPESAS POR CATEGORIA + VALORES E PORCENTAGENS -->
    <div class="donut-card">
      <div class="chart-top-bar">
        <div class="chart-title">Gastos por Categoria</div>
      </div>
      <div class="donut-content">
        <div class="donut-wrap">
          <canvas id="categoryDonutChart"></canvas>
        </div>
        <div class="cat-list">
          ${categoryLegendHtml}
        </div>
      </div>
    </div>
  </div>

  <script>
    Chart.defaults.animation = false;
    Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    Chart.defaults.font.size = 10;

    // 1. Gráfico de Barras "Fluxo de Renda" (Ganho #F3DDB6 vs Gasto #532728)
    new Chart(document.getElementById('incomeFlowChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(monthLabels)},
        datasets: [
          {
            label: 'Ganho',
            data: ${JSON.stringify(incomeSeries)},
            backgroundColor: '#F3DDB6',
            borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 2, bottomRight: 2 },
            borderSkipped: false,
            barPercentage: 0.72,
            categoryPercentage: 0.56
          },
          {
            label: 'Gasto',
            data: ${JSON.stringify(expenseSeries)},
            backgroundColor: '#532728',
            borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 2, bottomRight: 2 },
            borderSkipped: false,
            barPercentage: 0.72,
            categoryPercentage: 0.56
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: '#BDBDBD' },
            ticks: { color: '#757575', font: { size: 9.5 } }
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            ticks: {
              display: true,
              count: 5,
              color: '#757575',
              padding: 8,
              font: { size: 9.5, weight: '500' },
              callback: function(value) {
                return 'R$ ' + Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
              }
            },
            grid: {
              color: '#E5E5E5',
              drawTicks: false
            }
          }
        }
      }
    });

    // 2. Gráfico de Rosca (Paleta #532728, #D6BF93, #CED0BA, #F3DDB6, #F2EFCE)
    const catData = ${JSON.stringify(catValues)};
    const hasCatData = catData.some(v => v > 0);
    const palette = ${JSON.stringify(CATEGORY_PALETTE)};

    new Chart(document.getElementById('categoryDonutChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(catLabels)},
        datasets: [{
          data: hasCatData ? catData : [1],
          backgroundColor: hasCatData ? palette : ['#E5E5E5'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
  </script>
</body>
</html>`;

  return renderHtmlToPngBuffer(html, { width: 1400, height: 690 });
}
