import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.telegram;
  if (!creds || !creds.botToken || !creds.chatId) {
    throw new Error('telegram not connected. Run: fastrack connect telegram');
  }
  return creds;
}

export async function connect(botToken, chatId) {
  if (!botToken || !chatId) {
    throw new Error('connect telegram requires botToken and chatId');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.telegram = { botToken, chatId };
  saveConfig(config);
  return { tool: 'telegram', chatId };
}

export async function sendMessage(message, chatId = null) {
  const creds = getCredentials();
  const response = await axios.post(
    `https://api.telegram.org/bot${creds.botToken}/sendMessage`,
    {
      chat_id: chatId ?? creds.chatId,
      text: String(message).slice(0, 4096),
      parse_mode: 'Markdown'
    },
    { timeout: 30000 }
  );
  if (!response.data?.ok) {
    throw new Error(`Telegram API error: ${response.data?.description ?? 'unknown'}`);
  }
  return { ok: true, message_id: response.data.result?.message_id };
}
