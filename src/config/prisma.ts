import { PrismaClient } from '@prisma/client';

/**
 * Instância Singleton do cliente Prisma para evitar múltiplas conexões
 * desnecessárias com o banco de dados SQLite.
 */
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}
