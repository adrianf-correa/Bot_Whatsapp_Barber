import { prisma } from './config/prisma.js';
import { env } from './config/env.js';
import { seedDatabase } from './database/seed.js';
import { startWhatsAppBot, stopWhatsAppBot } from './services/whatsapp.js';

/**
 * Ponto de entrada da aplicação (Entrypoint).
 * Orquestra a conexão com o banco de dados, verificação de dados essenciais e inicialização do bot.
 */
async function bootstrap() {
  console.log('🚀 ========================================================');
  console.log(`💈 INICIANDO BOT DE AGENDAMENTO: ${env.BARBERSHOP_NAME}`);
  console.log(`🤖 ASSISTENTE: ${env.BOT_NAME} | MODELO IA: Google Gemini (${env.GEMINI_MODEL})`);
  console.log('========================================================\n');

  try {
    // 1. Testa a conexão com o banco de dados SQLite via Prisma
    console.log('📦 Conectando ao banco de dados SQLite...');
    await prisma.$connect();
    console.log('✅ Banco de dados conectado com sucesso!');

    // 2. Garante que os serviços iniciais estejam cadastrados
    await seedDatabase();

    // 3. Inicializa o serviço do WhatsApp (Baileys)
    console.log('📱 Inicializando cliente WhatsApp...');
    await startWhatsAppBot();
  } catch (error) {
    console.error('❌ Falha crítica durante a inicialização do sistema:', error);
    await cleanup();
    process.exit(1);
  }
}

/**
 * Função de encerramento gracioso (Graceful Shutdown)
 */
async function cleanup() {
  console.log('\n🛑 Encerrando aplicação e liberando recursos...');
  try {
    await stopWhatsAppBot();
    await prisma.$disconnect();
    console.log('👋 Conexões encerradas com sucesso. Até logo!');
  } catch (err) {
    console.error('Erro durante o encerramento:', err);
  }
}

// Captura sinais do sistema operacional para finalização limpa
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

// Inicialização da aplicação
bootstrap();
