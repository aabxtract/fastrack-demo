import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.jira;
  if (!creds || !creds.siteUrl || !creds.email || !creds.apiToken) {
    throw new Error('jira not connected. Run: fastrack connect jira');
  }
  return creds;
}

function client() {
  const creds = getCredentials();
  const site = creds.siteUrl.replace(/\/+$/, '');
  return axios.create({
    baseURL: `${site}/rest/api/2`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
}

export async function connect(siteUrl, email, apiToken) {
  if (!siteUrl || !email || !apiToken) {
    throw new Error('connect jira requires siteUrl (https://yourcompany.atlassian.net), email and apiToken');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.jira = { siteUrl, email, apiToken };
  saveConfig(config);
  return { tool: 'jira', siteUrl };
}

export async function createIssue({ project, summary, description, issueType = 'Task', assignee }) {
  if (!project || !summary) {
    throw new Error('createIssue requires project and summary');
  }
  const response = await client().post('/issue', {
    fields: {
      project: { key: project },
      summary,
      description: description ?? '',
      issuetype: { name: issueType },
      ...(assignee ? { assignee: { name: assignee } } : {})
    }
  });
  return { key: response.data.key, id: response.data.id, url: null };
}

export async function getIssue(key) {
  const response = await client().get(`/issue/${key}`);
  const fields = response.data.fields;
  return {
    key: response.data.key,
    summary: fields.summary,
    description: fields.description,
    status: fields.status?.name,
    assignee: fields.assignee?.name ?? null,
    created: fields.created,
    updated: fields.updated
  };
}

export async function search(jql, limit = 10) {
  const response = await client().get('/search', { params: { jql, maxResults: limit } });
  return response.data.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name,
    assignee: issue.fields.assignee?.name ?? null,
    updated: issue.fields.updated
  }));
}

export async function addComment(key, body) {
  if (!key || !body) throw new Error('addComment requires key and body');
  const response = await client().post(`/issue/${key}/comment`, { body });
  return { id: response.data.id, key };
}

export async function transitionIssue(key, transitionId) {
  const response = await client().post(`/issue/${key}/transitions`, {
    transition: { id: transitionId }
  });
  return { key, ok: response.status === 204 };
}

export async function listTransitions(key) {
  const response = await client().get(`/issue/${key}/transitions`);
  return response.data.transitions.map((t) => ({ id: t.id, name: t.name }));
}
