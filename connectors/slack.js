import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

const API = 'https://slack.com/api';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.slack;
  if (!creds || !creds.token) {
    throw new Error('slack not connected. Run: fastrack connect slack');
  }
  return creds;
}

function client() {
  const creds = getCredentials();
  return axios.create({
    baseURL: API,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    timeout: 30000
  });
}

function assertOk(data) {
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? 'unknown_error'}`);
  }
  return data;
}

export async function connect(token, defaultChannel = null) {
  if (!token) {
    throw new Error('connect slack requires a token');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.slack = { token, defaultChannel };
  saveConfig(config);
  return { tool: 'slack', defaultChannel };
}

export async function sendMessage(channel, message) {
  const creds = getCredentials();
  const target = channel ?? creds.defaultChannel;
  if (!target) {
    throw new Error('No channel provided and no defaultChannel configured for slack');
  }
  const response = await client().post('/chat.postMessage', {
    channel: target,
    text: message
  });
  const data = assertOk(response.data);
  return { channel: target, ts: data.ts, url: data.message?.permalink ?? null };
}

export async function listChannels() {
  const response = await client().get('/conversations.list', {
    params: {
      types: 'public_channel,private_channel',
      limit: 200,
      exclude_archived: true
    }
  });
  const data = assertOk(response.data);
  return data.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    is_private: channel.is_private,
    purpose: channel.purpose?.value ?? null
  }));
}

export async function getRecentMessages(channel, limit = 10) {
  const creds = getCredentials();
  const target = channel ?? creds.defaultChannel;
  if (!target) {
    throw new Error('No channel provided and no defaultChannel configured for slack');
  }
  const response = await client().get('/conversations.history', {
    params: { channel: target, limit }
  });
  const data = assertOk(response.data);
  return (data.messages ?? []).map((message) => ({
    id: message.client_msg_id ?? message.ts,
    user: message.user ?? null,
    text: message.text,
    ts: message.ts
  }));
}
