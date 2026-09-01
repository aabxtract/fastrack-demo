import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

function getWebhooks() {
  const config = loadConfig();
  return config.connectors?.webhooks ?? {};
}

export async function connect(name, url, headers = {}) {
  if (!name || !url) {
    throw new Error('connect webhook requires name and url');
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Error('Webhook url must start with http:// or https://');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.webhooks = config.connectors.webhooks ?? {};
  config.connectors.webhooks[name] = { url, headers };
  saveConfig(config);
  return { tool: 'webhook', name, url };
}

export async function send(target, payload = {}) {
  let url;
  let headers = {};

  if (/^https?:\/\//.test(target)) {
    url = target;
  } else {
    const hook = getWebhooks()[target];
    if (!hook) {
      const available = Object.keys(getWebhooks()).join(', ') || '(none)';
      throw new Error(`webhook "${target}" not connected. Run: fastrack connect webhook (saved: ${available})`);
    }
    url = hook.url;
    headers = hook.headers ?? {};
  }

  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json', ...headers },
    timeout: 30000
  });
  return { target, status: response.status };
}

export async function sendMessage(target, message) {
  return send(target, { text: message, content: message });
}
