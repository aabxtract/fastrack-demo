import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.discord;
  if (!creds || !creds.webhookUrl) {
    throw new Error('discord not connected. Run: fastrack connect discord');
  }
  return creds;
}

export async function connect(webhookUrl) {
  if (!webhookUrl || !/^https?:\/\//.test(webhookUrl)) {
    throw new Error('connect discord requires a webhook URL (Server Settings -> Integrations -> Webhooks)');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.discord = { webhookUrl };
  saveConfig(config);
  return { tool: 'discord' };
}

export async function sendMessage(message, options = {}) {
  if (!message) throw new Error('sendMessage requires a message');
  const creds = getCredentials();
  const body = { content: String(message).slice(0, 2000) };
  if (options.username) body.username = options.username;
  if (options.threadId) body.thread_id = options.threadId;

  const response = await axios.post(creds.webhookUrl, body, { timeout: 30000 });
  return { ok: response.status >= 200 && response.status < 300 };
}
