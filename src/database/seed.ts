import { prisma } from '../config/prisma.js';

/**
 * Script de inicialização dos dados essenciais (Seed).
 * Popula os serviços padrão da barbearia se a tabela estiver vazia.
 */
export async function seedDatabase() {
  const existingCount = await prisma.service.count();

  if (existingCount > 0) {
    return;
  }

  console.log('🌱 Populando serviços iniciais no banco de dados SQLite...');

  const defaultServices = [
    {
      name: 'Corte Tradicional',
      durationMinutes: 45,
      price: 45.0,
    },
    {
      name: 'Barba Terapia com Toalha Quente',
      durationMinutes: 30,
      price: 35.0,
    },
    {
      name: 'Combo: Cabelo + Barba',
      durationMinutes: 60,
      price: 70.0,
    },
    {
      name: 'Hidratação e Selagem Capilar',
      durationMinutes: 40,
      price: 50.0,
    },
  ];

  for (const service of defaultServices) {
    await prisma.service.upsert({
      where: { name: service.name },
      update: {},
      create: service,
    });
  }

  console.log('✅ Serviços padrão cadastrados com sucesso!');
}

// Permite execução direta via CLI (npm run seed)
if (process.argv[1]?.includes('seed')) {
  seedDatabase()
    .catch((e) => {
      console.error('❌ Erro ao rodar seed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
