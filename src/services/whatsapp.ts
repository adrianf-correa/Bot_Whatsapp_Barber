import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  type WASocket,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import { aiService } from './ai.js';

/**
 * Caminho para armazenamento persistente das chaves criptográficas da sessão.
 */
const AUTH_DIR = path.resolve(process.cwd(), 'auth_info_baileys');

/**
 * Instância ativa do socket do WhatsApp
 */
let sock: WASocket | null = null;

/**
 * Conjunto de IDs de mensagens enviadas pelo próprio código do bot.
 * Utilizado para prevenir loops infinitos sem bloquear mensagens manuais do próprio usuário (Note to Self).
 */
const botSentMessageIds = new Set<string>();

/**
 * Extrai texto de forma abrangente e resiliente de qualquer envelope de mensagem do WhatsApp:
 * - Conversas simples
 * - Mensagens estendidas (respostas, links)
 * - Mensagens efêmeras / temporárias
 * - Mensagens de visualização única (View Once v1 e v2)
 * - Mensagens com legenda (fotos, vídeos, documentos)
 */
function extractTextMessage(msg: any): string | null {
  if (!msg || !msg.message) return null;

  const m = msg.message;

  const content =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.ephemeralMessage?.message?.conversation ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text ||
    m.viewOnceMessage?.message?.conversation ||
    m.viewOnceMessage?.message?.extendedTextMessage?.text ||
    m.viewOnceMessageV2?.message?.conversation ||
    m.viewOnceMessageV2?.message?.extendedTextMessage?.text ||
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption;

  return content && typeof content === 'string' && content.trim().length > 0
    ? content.trim()
    : null;
}

/**
 * Inicializa a conexão com os servidores do WhatsApp via Baileys.
 */
export async function startWhatsAppBot(): Promise<WASocket> {
  // 1. Carrega as credenciais da sessão local
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // 2. Criação do socket com configuração otimizada e browser reconhecido
  const clientSocket = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), // Perfil oficial mais estável para conexões Web
    syncFullHistory: false, // Evita travar sincronizando históricos antigos
    markOnlineOnConnect: true,
    defaultQueryTimeoutMs: 60000,
  });

  sock = clientSocket;

  // 3. Salva credenciais atualizadas
  clientSocket.ev.on('creds.update', saveCreds);

  // 4. Gerenciamento do ciclo de vida da conexão
  clientSocket.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    // Exibe o QR Code no terminal quando gerado
    if (qr) {
      console.log('\n📱 ========================================================');
      console.log('⚡ ESCANEIE O QR CODE ABAIXO COM O SEU WHATSAPP:');
      console.log('========================================================\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.warn(
        `⚠️ Conexão encerrada. Código de status: ${statusCode}. Motivo: ${lastDisconnect?.error?.message}`
      );

      if (shouldReconnect) {
        console.log('🔄 Tentando reconectar aos servidores do WhatsApp em 5 segundos...');
        setTimeout(() => {
          startWhatsAppBot();
        }, 5000);
      } else {
        console.error(
          '❌ Sessão desconectada. Exclua a pasta "auth_info_baileys" e reinicie para escanear um novo QR Code.'
        );
      }
    } else if (connection === 'open') {
      const userJid = clientSocket.user?.id || '';
      const userPhone = userJid.split(':')[0].split('@')[0];

      console.log('\n🟢 ========================================================');
      console.log('✅ BOT DE WHATSAPP CONECTADO COM SUCESSO!');
      console.log(`📱 Número Conectado: +${userPhone}`);
      console.log('🤖 IA (Google Gemini 3.1 Flash Lite) pronta para atender.');
      console.log('🧪 COMO TESTAR:');
      console.log('   1. De outro celular: envie qualquer mensagem para este número.');
      console.log('   2. Deste mesmo celular: abra o chat "Você" (conversa consigo mesmo) e envie uma mensagem!');
      console.log('========================================================\n');
    }
  });

  // 5. Escuta de mensagens recebidas
  clientSocket.ev.on('messages.upsert', async ({ messages }) => {
    // Processa tanto notificações em tempo real ('notify') quanto sincronizadas ('append')
    for (const msg of messages) {
      if (!msg.key || !msg.key.remoteJid) continue;

      const remoteJid = msg.key.remoteJid;
      const messageId = msg.key.id || '';

      // 1. Previne loop infinito: se este ID foi enviado pelo bot nesta sessão, ignora
      if (messageId && botSentMessageIds.has(messageId)) {
        botSentMessageIds.delete(messageId);
        continue;
      }

      // 2. Filtra status/stories do WhatsApp
      if (remoteJid === 'status@broadcast') continue;

      // 3. Filtra grupos para foco em atendimento individual (permite @s.whatsapp.net e @lid)
      if (remoteJid.endsWith('@g.us')) {
        continue;
      }

      // 4. Identifica o número do próprio bot para permitir testes na conversa "Você" (Note to Self)
      const myFullJid = clientSocket.user?.id || '';
      const myPhoneNumber = myFullJid.split(':')[0].split('@')[0];
      const isSelfChat = remoteJid.includes(myPhoneNumber);

      // Se a mensagem partiu do próprio número conectado:
      if (msg.key.fromMe) {
        // Se NÃO for na conversa consigo mesmo, o usuário está conversando privadamente com outra pessoa
        if (!isSelfChat) {
          continue;
        }
        // Se FOR na conversa consigo mesmo, o usuário está testando o bot no próprio aparelho!
        console.log('🧪 [Modo de Teste]: Mensagem enviada na conversa consigo mesmo ("Você").');
      }

      // 5. Extrai o conteúdo de texto da mensagem
      const messageContent = extractTextMessage(msg);
      if (!messageContent) {
        continue;
      }

      const clientName = msg.pushName || (isSelfChat ? 'Você (Teste)' : 'Cliente');
      const cleanPhone = remoteJid.split('@')[0];

      console.log(
        `\n📩 [Mensagem Recebida] de ${clientName} (${cleanPhone}): "${messageContent}"`
      );

      try {
        // Exibe "digitando..." no WhatsApp do cliente
        clientSocket.sendPresenceUpdate('composing', remoteJid).catch(() => {});

        // Processa com o Google Gemini + Tool Calling (SQLite)
        const replyText = await aiService.processMessage(
          cleanPhone,
          clientName,
          messageContent
        );

        // Remove o "digitando..."
        clientSocket.sendPresenceUpdate('paused', remoteJid).catch(() => {});

        // Envia a resposta de volta
        const sent = await clientSocket.sendMessage(remoteJid, {
          text: replyText,
        });

        // Registra o ID da mensagem para evitar loop se o WhatsApp renotificar
        if (sent?.key?.id) {
          botSentMessageIds.add(sent.key.id);
          setTimeout(() => {
            if (sent.key.id) botSentMessageIds.delete(sent.key.id);
          }, 30000);
        }

        console.log(`📤 [Resposta Enviada com Sucesso] para ${cleanPhone}`);
      } catch (error) {
        console.error(`❌ [Erro ao responder ${remoteJid}]:`, error);

        try {
          const fallback = await clientSocket.sendMessage(remoteJid, {
            text: 'Olá! Tive uma breve oscilação de rede ao consultar os dados. Poderia reenviar sua mensagem?',
          });
          if (fallback?.key?.id) {
            botSentMessageIds.add(fallback.key.id);
          }
        } catch (sendError) {
          console.error('❌ Falha ao enviar mensagem de contingência:', sendError);
        }
      }
    }
  });

  return clientSocket;
}

/**
 * Finaliza a conexão do socket de forma limpa.
 */
export async function stopWhatsAppBot(): Promise<void> {
  if (sock) {
    console.log('🛑 Encerrando conexão do WhatsApp...');
    sock.end(undefined);
    sock = null;
  }
}
