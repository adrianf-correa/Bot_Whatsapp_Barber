import dotenv from 'dotenv';
import path from 'path';

// Carrega as variáveis de ambiente a partir do arquivo .env
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

/**
 * Validação e exportação centralizada das variáveis de ambiente da aplicação.
 * Garante tipagem estrita e valores padrão seguros.
 */
export const env = {
  // Configurações do Banco de Dados
  DATABASE_URL: process.env.DATABASE_URL || 'file:./dev.db',

  // Configurações da API de IA (Google Gemini via @google/genai)
  // Aceita GEMINI_API_KEY, API_KEY, GOOGLE_API_KEY ou OPENAI_API_KEY por conveniência
  GEMINI_API_KEY:
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',

  // Configurações do Negócio
  BOT_NAME: process.env.BOT_NAME || 'Sophia',
  BARBERSHOP_NAME: process.env.BARBERSHOP_NAME || 'Barbearia Estilo & Navalha',
  BARBERSHOP_OPEN_HOUR: parseInt(process.env.BARBERSHOP_OPEN_HOUR || '9', 10),
  BARBERSHOP_CLOSE_HOUR: parseInt(process.env.BARBERSHOP_CLOSE_HOUR || '18', 10),
} as const;

// Validação preventiva em tempo de inicialização
if (!env.GEMINI_API_KEY) {
  console.warn(
    '⚠️ [AVISO]: Nenhuma chave de API (GEMINI_API_KEY ou API_KEY) foi encontrada no arquivo .env. Configure sua chave do Google AI Studio para que o bot funcione.'
  );
}
