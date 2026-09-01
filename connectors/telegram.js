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

export async function getMe(botToken) {
  const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`, { timeout: 15000 });
  if (!response.data?.ok) {
    throw new Error(`Telegram API error: ${response.data?.description ?? 'invalid bot token'}`);
  }
  return { username: response.data.result.username, name: response.data.result.first_name };
}

export async function resolveChatId(botToken, { attempts = 10, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const response = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`, { timeout: 15000 });
    if (response.data?.ok) {
      const chats = (response.data.result || []).map((u) => u.message?.chat).filter(Boolean);
      if (chats.length) {
        const chat = chats[chats.length - 1];
        return { chatId: String(chat.id), name: chat.first_name || chat.title || chat.username || 'chat' };
      }
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
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
