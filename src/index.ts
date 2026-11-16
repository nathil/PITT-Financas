import { getEnv } from './config/env';
import { createApp } from './server';
import { getConfiguredTesterPhones } from './utils/phoneWhitelist';
import { baileysProvider } from './whatsapp/baileysProvider';

async function main() {
  const env = getEnv();
  const app = createApp();

  app.listen(env.PORT, () => {
    const testers = getConfiguredTesterPhones();
    console.log('============================================================');
    console.log(`🚀 PITT Finanças Chatbot Financeiro rodando na porta ${env.PORT}`);
    console.log(`🔒 Modo Exclusivo para Testers (STRICT_TESTER_ONLY): ${env.STRICT_TESTER_ONLY}`);
    console.log(
      `📱 Números Testers configurados (${testers.length}): ${
        testers.length > 0 ? testers.join(', ') : 'Nenhum configurado em TESTER_PHONES'
      }`
    );
    console.log(`🔌 Provedor WhatsApp ativo: ${env.WHATSAPP_PROVIDER}`);
    console.log('============================================================');
  });

  if (env.WHATSAPP_PROVIDER === 'baileys') {
    await baileysProvider.start();
  }
}

main().catch((err) => {
  console.error('Erro fatal ao iniciar PITT Finanças:', err);
  process.exit(1);
});
