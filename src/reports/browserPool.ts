import fs from 'fs';
import path from 'path';
import { chromium, Browser } from 'playwright';

// Garante que o Playwright encontre o Chromium instalado no workspace (.runtime/browsers)
const localBrowsersPath = path.resolve(process.cwd(), '.runtime/browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(localBrowsersPath)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsersPath;
}

let cachedChartJsContent: string | null = null;

/**
 * Carrega o bundle local do Chart.js a partir de node_modules para injeção inline no HTML,
 * evitando qualquer dependência de rede durante a geração do PNG.
 */
export function getInlineChartJsScript(): string {
  if (cachedChartJsContent !== null) {
    return cachedChartJsContent;
  }
  const chartJsPath = path.resolve(
    process.cwd(),
    'node_modules/chart.js/dist/chart.umd.js'
  );
  if (fs.existsSync(chartJsPath)) {
    cachedChartJsContent = fs.readFileSync(chartJsPath, 'utf-8');
    return cachedChartJsContent;
  }
  return '';
}

/**
 * Renderiza um documento HTML completo em um Buffer PNG usando Playwright Chromium Headless.
 */
export async function renderHtmlToPngBuffer(
  htmlContent: string,
  options: { width: number; height: number } = { width: 1400, height: 1000 }
): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load' });
    // Pequena pausa para garantir que animações síncronas/canvas do Chart.js finalizaram
    await page.waitForTimeout(150);

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
    });
    await context.close();
    return Buffer.from(screenshot);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
