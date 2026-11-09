import { gemini, GEMINI_CONFIG } from '../config/ai.js';
import { env } from '../config/env.js';
import { GEMINI_BOOKING_TOOLS, executeTool } from '../tools/bookingTools.js';
import type { Content } from '@google/genai';

/**
 * Limite máximo de turnos de mensagens mantidos em memória por usuário.
 * Evita vazamento de memória e estouro da janela de contexto do modelo.
 */
const MAX_HISTORY_MESSAGES = 16;

/**
 * Serviço de Inteligência Artificial baseado no Google Gemini (@google/genai).
 * Gerencia histórico de conversas em memória, injeção temporal dinâmica e resolução de Function Calling.
 */
export class AIService {
  // Histórico em memória chaveado pelo telefone/JID do WhatsApp
  private sessionHistory: Map<string, Content[]> = new Map();

  /**
   * Constrói a instrução de sistema (System Instruction) com data e hora locais injetadas.
   * Essencial para que o Gemini resolva expressões relativas como "hoje", "amanhã", "quarta-feira".
   */
  private buildSystemPrompt(clientName?: string): string {
    const now = new Date();
    const currentDate = now.toLocaleDateString('pt-BR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const currentTime = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const currentISODate = now.toISOString().split('T')[0];

    return `Você é ${env.BOT_NAME}, assistente virtual e recepcionista inteligente da "${env.BARBERSHOP_NAME}".
Seu objetivo é atender os clientes pelo WhatsApp de maneira calorosa, ágil, educada e profissional, ajudando-os a consultar serviços, verificar horários disponíveis e agendar atendimentos.

### Contexto Temporal Atual
- Data e dia da semana de hoje: ${currentDate}
- Data no formato ISO (YYYY-MM-DD): ${currentISODate}
- Horário atual local: ${currentTime}
- Horário de funcionamento: Das ${env.BARBERSHOP_OPEN_HOUR}:00 às ${env.BARBERSHOP_CLOSE_HOUR}:00 (segunda a sábado, intervalos de 1 hora).

${clientName ? `O cliente identificado no WhatsApp se chama "${clientName}". Use o nome dele para um atendimento personalizado.` : ''}

### Suas Ferramentas (Tools):
1. 'listServices': Use quando o cliente perguntar os serviços disponíveis, valores ou duração.
2. 'getAvailableSlots(date)': Use SEMPRE que o cliente perguntar sobre disponibilidade ou desejar agendar em uma data específica. Converta termos relativos ("hoje", "amanhã", "quarta-feira") para a data correspondente em YYYY-MM-DD.
3. 'createAppointment(clientPhone, clientName, serviceName, dateTime)': Use APENAS quando o cliente confirmar explicitamente o serviço, data e horário desejados.

### Diretrizes de Conduta:
1. NUNCA invente ou presuma horários livres. Sempre consulte 'getAvailableSlots' antes de informar opções ao cliente.
2. Nunca execute 'createAppointment' sem a confirmação clara do cliente (ex: "Podemos confirmar para amanhã às 14h?").
3. Mantenha as mensagens no padrão WhatsApp: frases curtas, objetivas, amigáveis e com uso moderado de emojis.
4. Quando o agendamento for concluído com sucesso, envie um resumo elegante com:
   - 👤 Cliente
   - ✂️ Serviço
   - 📅 Data
   - ⏰ Horário
   - 📍 Local: ${env.BARBERSHOP_NAME}
5. Se o cliente tentar marcar um horário já ocupado ou no passado, explique educadamente e sugira os horários livres mais próximos.`;
  }

  /**
   * Obtém ou inicializa o histórico de mensagens de um usuário específico.
   */
  private getUserHistory(userId: string): Content[] {
    if (!this.sessionHistory.has(userId)) {
      this.sessionHistory.set(userId, []);
    }
    return this.sessionHistory.get(userId)!;
  }

  /**
   * Limpa o histórico de conversa de um usuário (útil para reiniciar atendimento).
   */
  public resetSession(userId: string): void {
    this.sessionHistory.delete(userId);
  }

  /**
   * Processa a mensagem do usuário, gerencia chamadas de ferramentas e retorna a resposta final.
   *
   * @param userPhone Telefone/JID do usuário no WhatsApp
   * @param userPushName Nome de perfil do WhatsApp (se disponível)
   * @param incomingText Texto enviado pelo cliente
   */
  public async processMessage(
    userPhone: string,
    userPushName: string | undefined,
    incomingText: string
  ): Promise<string> {
    const history = this.getUserHistory(userPhone);

    // Adiciona a mensagem do usuário ao histórico da sessão
    history.push({
      role: 'user',
      parts: [{ text: incomingText }],
    });

    // Poda o histórico se exceder o limite seguro (FIFO)
    if (history.length > MAX_HISTORY_MESSAGES) {
      history.splice(0, history.length - MAX_HISTORY_MESSAGES);
    }

    try {
      let isToolLoopActive = true;
      let iterationCount = 0;
      const MAX_TOOL_ITERATIONS = 5; // Previne loops infinitos

      while (isToolLoopActive && iterationCount < MAX_TOOL_ITERATIONS) {
        iterationCount++;

        const response = await gemini.models.generateContent({
          model: GEMINI_CONFIG.model,
          contents: [...history],
          config: {
            systemInstruction: this.buildSystemPrompt(userPushName),
            temperature: GEMINI_CONFIG.temperature,
            tools: [{ functionDeclarations: GEMINI_BOOKING_TOOLS }],
          },
        });

        const functionCalls = response.functionCalls;

        // Se o Gemini decidiu acionar uma ou mais funções
        if (functionCalls && functionCalls.length > 0) {
          // Adiciona a resposta do modelo (com as intenções de chamada) ao histórico
          if (response.candidates?.[0]?.content) {
            history.push(response.candidates[0].content);
          }

          // Executa cada função solicitada
          for (const call of functionCalls) {
            if (!call.name) continue;
            const functionName = call.name;
            const functionArgs = (call.args || {}) as Record<string, any>;

            // Injeta dados de contexto se não vierem preenchidos pelo modelo
            if (functionName === 'createAppointment') {
              if (!functionArgs.clientPhone) functionArgs.clientPhone = userPhone;
              if (!functionArgs.clientName && userPushName) functionArgs.clientName = userPushName;
            }

            console.log(`🤖 [Gemini Tool Calling] Executando: ${functionName} com args:`, functionArgs);

            // Executa a função correspondente
            const toolResult = await executeTool(functionName, functionArgs);

            // Adiciona o resultado da função de volta ao histórico no formato do Gemini
            history.push({
              role: 'user',
              parts: [
                {
                  functionResponse: {
                    id: call.id,
                    name: functionName,
                    response: {
                      result: toolResult,
                    },
                  },
                },
              ],
            });
          }

          // Continua o loop para o Gemini processar o resultado e gerar o texto final
          continue;
        }

        // Se o Gemini concluiu a geração e retornou o texto final ao usuário
        const finalContent = response.text || 'Desculpe, não consegui entender. Poderia repetir?';

        // Registra a mensagem final do modelo no histórico
        history.push({
          role: 'model',
          parts: [{ text: finalContent }],
        });

        return finalContent;
      }

      return 'Desculpe, encontrei uma complexidade inesperada ao processar sua solicitação. Como posso te ajudar?';
    } catch (error) {
      console.error('❌ [Gemini Service Error]:', error);
      // Limpa a sessão do usuário com falha para não corromper as próximas mensagens
      this.resetSession(userPhone);
      return 'Olá! Tive uma oscilação momentânea ao conectar com o servidor. Pode tentar me mandar a mensagem novamente?';
    }
  }
}

export const aiService = new AIService();
