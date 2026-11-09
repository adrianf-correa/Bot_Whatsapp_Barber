import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import type { FunctionDeclaration } from '@google/genai';

/**
 * ============================================================================
 * IMPLEMENTAÇÃO CONCRETA DAS FUNÇÕES DE NEGÓCIO E BANCO DE DADOS
 * ============================================================================
 */

export interface AvailableSlotsResult {
  success: boolean;
  date: string;
  availableSlots: string[];
  bookedSlots: string[];
  message: string;
}

export interface CreateAppointmentResult {
  success: boolean;
  message: string;
  appointment?: {
    id: string;
    clientName: string;
    clientPhone: string;
    serviceName: string;
    dateTime: string;
    status: string;
  };
  error?: string;
}

/**
 * Consulta no SQLite os horários livres para uma data especificada (YYYY-MM-DD).
 * Horário comercial padrão: das 09:00 às 18:00 (intervalos de 1 hora).
 */
export async function getAvailableSlots(date: string): Promise<AvailableSlotsResult> {
  // Validação de formato da data (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return {
      success: false,
      date,
      availableSlots: [],
      bookedSlots: [],
      message: 'Formato de data inválido. Utilize o padrão AAAA-MM-DD (ex: 2026-11-10).',
    };
  }

  const [year, month, day] = date.split('-').map(Number);
  const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
  const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

  // Busca agendamentos ativos no intervalo do dia
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      dateTime: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        not: 'CANCELED',
      },
    },
    select: {
      dateTime: true,
      serviceName: true,
    },
  });

  // Mapeia os horários já ocupados no formato "HH:00"
  const bookedHours = new Set<string>();
  for (const app of existingAppointments) {
    const d = new Date(app.dateTime);
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    bookedHours.add(`${hour}:${minute}`);
  }

  const availableSlots: string[] = [];
  const bookedSlots: string[] = [];
  const now = new Date();

  // Itera pelas horas de funcionamento (ex: das 09h às 18h)
  for (let hour = env.BARBERSHOP_OPEN_HOUR; hour < env.BARBERSHOP_CLOSE_HOUR; hour++) {
    const timeSlot = `${String(hour).padStart(2, '0')}:00`;
    const slotDate = new Date(year, month - 1, day, hour, 0, 0, 0);

    // Se a consulta for para a data de hoje, não exibe horários que já passaram
    const isPastSlot = slotDate.getTime() <= now.getTime();

    if (bookedHours.has(timeSlot) || isPastSlot) {
      bookedSlots.push(timeSlot);
    } else {
      availableSlots.push(timeSlot);
    }
  }

  return {
    success: true,
    date,
    availableSlots,
    bookedSlots,
    message:
      availableSlots.length > 0
        ? `Horários disponíveis em ${date}: ${availableSlots.join(', ')}.`
        : `Não há horários disponíveis para a data ${date}.`,
  };
}

/**
 * Cria ou atualiza o cliente e registra o agendamento no SQLite se o horário estiver livre.
 */
export async function createAppointment(
  clientPhone: string,
  clientName: string,
  serviceName: string,
  dateTime: string
): Promise<CreateAppointmentResult> {
  try {
    const appointmentDate = new Date(dateTime);

    // Validação de formato de data/hora
    if (isNaN(appointmentDate.getTime())) {
      return {
        success: false,
        message: 'Falha no agendamento.',
        error: 'Data e hora inválidas. Use o formato ISO 8601 (ex: 2026-11-10T14:00:00).',
      };
    }

    // Regra de Negócio: Não permitir agendamentos no passado
    if (appointmentDate.getTime() < Date.now()) {
      return {
        success: false,
        message: 'Falha no agendamento.',
        error: 'Não é possível agendar um horário no passado.',
      };
    }

    // Regra de Negócio: Verificar se o horário já está ocupado
    const conflict = await prisma.appointment.findFirst({
      where: {
        dateTime: appointmentDate,
        status: { not: 'CANCELED' },
      },
    });

    if (conflict) {
      return {
        success: false,
        message: 'Horário indisponível.',
        error: `O horário ${appointmentDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} em ${appointmentDate.toLocaleDateString('pt-BR')} já está reservado. Escolha outro horário.`,
      };
    }

    // Upsert do cliente (cria se novo, atualiza nome se já existente)
    const client = await prisma.client.upsert({
      where: { phone: clientPhone },
      update: { name: clientName },
      create: {
        phone: clientPhone,
        name: clientName,
      },
    });

    // Criação do agendamento
    const appointment = await prisma.appointment.create({
      data: {
        clientId: client.id,
        serviceName,
        dateTime: appointmentDate,
        status: 'CONFIRMED',
      },
    });

    return {
      success: true,
      message: 'Agendamento realizado com sucesso!',
      appointment: {
        id: appointment.id,
        clientName: client.name,
        clientPhone: client.phone,
        serviceName: appointment.serviceName,
        dateTime: appointment.dateTime.toISOString(),
        status: appointment.status,
      },
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      message: 'Erro interno ao processar o agendamento.',
      error: err.message,
    };
  }
}

/**
 * Consulta a lista de serviços cadastrados no banco de dados.
 */
export async function listServices() {
  const services = await prisma.service.findMany({
    orderBy: { price: 'asc' },
  });

  return {
    success: true,
    services: services.map((s) => ({
      name: s.name,
      price: `R$ ${s.price.toFixed(2)}`,
      durationMinutes: s.durationMinutes,
    })),
  };
}

/**
 * ============================================================================
 * ESPECIFICAÇÃO DE TOOLS PARA O GOOGLE GEMINI (@google/genai)
 * ============================================================================
 */
export const GEMINI_BOOKING_TOOLS: FunctionDeclaration[] = [
  {
    name: 'getAvailableSlots',
    description:
      'Consulta os horários de agendamento livres no banco de dados para uma data específica (horário comercial das 09:00 às 18:00). Retorna os horários vagos.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Data no formato YYYY-MM-DD para verificar os horários livres (exemplo: "2026-11-10").',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'createAppointment',
    description:
      'Cria e confirma um novo agendamento no banco de dados SQLite para o cliente no serviço e horário escolhido. Só deve ser executado após verificar a disponibilidade e obter a confirmação do cliente.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        clientPhone: {
          type: 'string',
          description: 'Telefone ou JID do WhatsApp do cliente.',
        },
        clientName: {
          type: 'string',
          description: 'Nome completo ou primeiro nome do cliente.',
        },
        serviceName: {
          type: 'string',
          description: 'Nome do serviço a ser agendado (ex: "Corte Tradicional", "Barba Terapia com Toalha Quente", "Combo: Cabelo + Barba").',
        },
        dateTime: {
          type: 'string',
          description: 'Data e hora de início no formato ISO 8601 (exemplo: "2026-11-10T14:00:00").',
        },
      },
      required: ['clientPhone', 'clientName', 'serviceName', 'dateTime'],
    },
  },
  {
    name: 'listServices',
    description:
      'Retorna o catálogo de serviços disponíveis na barbearia/salão, incluindo valores em reais e duração de cada procedimento.',
    parametersJsonSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Despachante seguro que roteia e executa a ferramenta requisitada pela LLM.
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'getAvailableSlots':
      return await getAvailableSlots(args.date);

    case 'createAppointment':
      return await createAppointment(
        args.clientPhone,
        args.clientName,
        args.serviceName,
        args.dateTime
      );

    case 'listServices':
      return await listServices();

    default:
      return {
        success: false,
        error: `Ferramenta desconhecida: "${name}".`,
      };
  }
}
