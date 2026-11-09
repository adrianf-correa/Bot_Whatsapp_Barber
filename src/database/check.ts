import { prisma } from '../config/prisma.js';

/**
 * Script utilitário para inspecionar rapidamente os dados no SQLite pelo terminal.
 */
async function checkDatabase() {
  console.log('\n📊 ========================================================');
  console.log('🔍 RELATÓRIO DO BANCO DE DADOS (SQLite - dev.db)');
  console.log('========================================================\n');

  // 1. Clientes
  const clients = await prisma.client.findMany({
    include: {
      appointments: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`👤 CLIENTES CADASTRADOS (${clients.length}):`);
  if (clients.length === 0) {
    console.log('   (Nenhum cliente cadastrado ainda)\n');
  } else {
    console.table(
      clients.map((c) => ({
        ID: c.id.substring(0, 8) + '...',
        Nome: c.name,
        Telefone: c.phone,
        'Qtd Agendamentos': c.appointments.length,
        CriadoEm: c.createdAt.toLocaleString('pt-BR'),
      }))
    );
  }

  // 2. Agendamentos
  const appointments = await prisma.appointment.findMany({
    include: {
      client: true,
    },
    orderBy: { dateTime: 'asc' },
  });

  console.log(`\n📅 AGENDAMENTOS REGISTRADOS (${appointments.length}):`);
  if (appointments.length === 0) {
    console.log('   (Nenhum agendamento realizado ainda)\n');
  } else {
    console.table(
      appointments.map((a) => ({
        ID: a.id.substring(0, 8) + '...',
        Cliente: a.client.name,
        Telefone: a.client.phone,
        Serviço: a.serviceName,
        'Data / Hora': a.dateTime.toLocaleString('pt-BR'),
        Status: a.status,
      }))
    );
  }

  // 3. Serviços
  const services = await prisma.service.findMany({
    orderBy: { price: 'asc' },
  });

  console.log(`\n✂️ CATÁLOGO DE SERVIÇOS (${services.length}):`);
  console.table(
    services.map((s) => ({
      Nome: s.name,
      Preço: `R$ ${s.price.toFixed(2)}`,
      Duração: `${s.durationMinutes} min`,
    }))
  );

  console.log('\n💡 DICA: Para visualizar e editar os dados em uma interface visual no navegador, execute:');
  console.log('👉 npx prisma studio\n');
}

checkDatabase()
  .catch((e) => {
    console.error('❌ Erro ao consultar banco:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
