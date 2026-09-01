import axios from 'axios';
import nodemailer from 'nodemailer';
import { loadConfig, saveConfig } from '../core/model-router.js';

const DEFAULT_BASE_URL = 'https://api.resend.com';
const GMAIL_SMTP = { host: 'smtp.gmail.com', port: 465 };

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.email;
  if (!creds) {
    throw new Error('email not connected. Run: fastrack connect email');
  }
  if (creds.provider === 'smtp') {
    if (!creds.user || !creds.appPassword) {
      throw new Error('email (smtp) is connected but missing user or app password. Reconnect: fastrack connect email');
    }
    return creds;
  }
  if (!creds.apiKey || !creds.fromEmail) {
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
    provider: 'resend',
    apiKey,
    fromEmail,
    defaultTo,
    ...(baseUrl ? { baseUrl } : {})
  };
  saveConfig(config);
  return { tool: 'email', provider: 'resend', fromEmail, defaultTo };
}

export async function connectSmtp({ user, appPassword, from, defaultTo = null, host, port, secure = true }) {
  if (!user || !appPassword) {
    throw new Error('connectSmtp requires user and appPassword');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.email = {
    provider: 'smtp',
    user,
    appPassword,
    fromEmail: from ?? user,
    defaultTo,
    host: host ?? GMAIL_SMTP.host,
    port: port ?? GMAIL_SMTP.port,
    secure
  };
  saveConfig(config);
  return { tool: 'email', provider: 'smtp', fromEmail: config.connectors.email.fromEmail, host: config.connectors.email.host };
}

async function sendViaResend(creds, payload) {
  const response = await axios.post(`${creds.baseUrl ?? DEFAULT_BASE_URL}/emails`, payload, {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  return { id: response.data?.id ?? null, to: payload.to };
}

async function sendViaSmtp(creds, payload) {
  const transporter = nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.secure !== false,
    auth: { user: creds.user, pass: creds.appPassword }
  });
  const info = await transporter.sendMail({
    from: creds.fromEmail,
    to: payload.to,
    subject: payload.subject,
    ...(payload.text ? { text: payload.text } : {}),
    ...(payload.html ? { html: payload.html } : {})
  });
  return { id: info.messageId ?? null, to: payload.to };
}

export async function sendEmail(to, subject, body, options = {}) {
  if (!body) throw new Error('sendEmail requires a body');
  const creds = getCredentials();
  const target = to ?? creds.defaultTo;
  if (!target) {
    throw new Error('No recipient. Pass a "to" address or set a default with: fastrack connect email');
  }

  const payload = {
    to: target,
    subject: subject ?? 'FASTRACK message'
  };
  if (options.html) payload.html = body;
  else payload.text = body;

  if (creds.provider === 'smtp') {
    return sendViaSmtp(creds, payload);
  }
  return sendViaResend(creds, { ...payload, from: creds.fromEmail });
}
