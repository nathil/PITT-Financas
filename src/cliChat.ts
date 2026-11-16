import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { botEngine } from './bot/botEngine';
import { getConfiguredTesterPhones } from './utils/phoneWhitelist';

async function startInteractiveCli() {
  const testers = getConfiguredTesterPhones();
  const defaultTester = testers[0] ?? '5511999999999';
  let currentPhone = process.argv[2] ?? defaultTester;

  const outDir = path.resolve(process.cwd(), 'generated_reports');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('================================================================');
  console.log('💬 SIMULADOR INTERATIVO DO WHATSAPP — PITT Finanças');
  console.log('================================================================');
  console.log(`🔒 Testers autorizados no .env: ${testers.join(', ')}`);
  console.log(`📱 Simulando mensagens vindas do número: ${currentPhone}`);
  console.log('----------------------------------------------------------------');
  console.log('Comandos especiais do simulador:');
  console.log('  /numero <TELEFONE>  -> Troca o número remetente (ex: /numero 5511000000000 para testar bloqueio)');
  console.log('  /sair               -> Encerra o simulador');
  console.log('================================================================\n');
  console.log('Digite "oi" para iniciar a conversa com o bot:\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `[Você (${currentPhone})] > `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === '/sair') {
      rl.close();
      process.exit(0);
    }

    if (trimmed.toLowerCase().startsWith('/numero ')) {
      currentPhone = trimmed.slice(8).trim();
      console.log(`\n🔄 Número remetente alterado para: ${currentPhone}\n`);
      rl.setPrompt(`[Você (${currentPhone})] > `);
      rl.prompt();
      return;
    }

    try {
      const result = await botEngine.handleIncomingMessage({
        senderJidOrPhone: `${currentPhone}@s.whatsapp.net`,
        text: trimmed,
        senderName: 'Usuário Simulador',
      });

      if (result.ignored) {
        console.log(
          `\n🚫 [BOT IGNOROU A MENSAGEM] Motivo: ${result.reason} (O número ${currentPhone} não está na lista de Testers!)\n`
        );
      } else {
        for (const resp of result.responses) {
          if (resp.text) {
            console.log(`\n🤖 [PITT Finanças Bot]:\n${resp.text}\n`);
          }
          if (resp.media && resp.media.length > 0) {
            for (const m of resp.media) {
              const targetPath = path.join(outDir, m.filename);
              fs.writeFileSync(targetPath, m.buffer);
              console.log(`📎 [ARQUIVO GERADO E ENVIADO]: ${targetPath}`);
              if (m.caption) {
                console.log(`   Legenda: ${m.caption}`);
              }
            }
            console.log('');
          }
        }
      }
    } catch (err) {
      console.error('\n❌ Erro ao processar mensagem:', err);
    }

    rl.prompt();
  });
}

startInteractiveCli();
