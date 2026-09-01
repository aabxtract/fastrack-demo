import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

const DEFAULT_BASE_URL = 'https://api.resend.com';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.email;
  if (!creds || !creds.apiKey || !creds.fromEmail) {
    throw new Error('email not connected. Run: fastrack connect email');
  }
  return creds;
}

export async function connect(apiKey, fromEmail, defaultTo = null, baseUrl = null) {
  if (!apiKey || !fromEmail) {
    throw new Error('connect email requires apiKey and fromEmail');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.email = {
    apiKey,
    fromEmail,
    defaultTo,
    ...(baseUrl ? { baseUrl } : {})
  };
  saveConfig(config);
  return { tool: 'email', fromEmail, defaultTo };
}

export async function sendEmail(to, subject, body, options = {}) {
  if (!body) throw new Error('sendEmail requires a body');
  const creds = getCredentials();
  const target = to ?? creds.defaultTo;
  if (!target) {
    throw new Error('No recipient. Pass a "to" address or set a default with: fastrack connect email');
  }

  const payload = {
    from: creds.fromEmail,
    to: target,
    subject: subject ?? 'FASTRACK message'
  };
  if (options.html) payload.html = body;
  else payload.text = body;

  const response = await axios.post(`${creds.baseUrl ?? DEFAULT_BASE_URL}/emails`, payload, {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  return { id: response.data?.id ?? null, to: target };
}
