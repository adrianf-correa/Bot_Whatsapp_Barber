import { GoogleGenAI } from '@google/genai';
import { env } from './env.js';

/**
 * Instância oficial configurada do SDK @google/genai para o Google Gemini.
 * Suporta modelos com Function / Tool Calling nativo (ex: gemini-2.5-flash, gemini-1.5-flash).
 */
export const gemini = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY || 'dummy-key-for-init',
});

export const GEMINI_CONFIG = {
  model: env.GEMINI_MODEL,
  temperature: 0.3, // Menor temperatura garante fidelidade ao tool calling e menor alucinação
} as const;
