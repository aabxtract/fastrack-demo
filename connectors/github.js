import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

const API = 'https://api.github.com';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.github;
  if (!creds || !creds.token || !creds.owner || !creds.repo) {
    throw new Error('github not connected. Run: fastrack connect github');
  }
  return creds;
}

function client() {
  const creds = getCredentials();
  return axios.create({
    baseURL: API,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
}

export async function connect(token, owner, repo) {
  if (!token || !owner || !repo) {
    throw new Error('connect github requires token, owner and repo');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.github = { token, owner, repo };
  saveConfig(config);
  return { tool: 'github', owner, repo };
}

export async function listOpenPRs() {
  const api = client();
  const creds = getCredentials();
  const response = await api.get(`/repos/${creds.owner}/${creds.repo}/pulls`, {
    params: { state: 'open', per_page: 30 }
  });
  return response.data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login ?? null,
    created_at: pr.created_at,
    url: pr.html_url
  }));
}

export async function listIssues(options = {}) {
  const api = client();
  const creds = getCredentials();
  const response = await api.get(`/repos/${creds.owner}/${creds.repo}/issues`, {
    params: {
      state: options.state ?? 'open',
      labels: options.labels?.join(',') ?? undefined,
      per_page: options.limit ?? 30
    }
  });
  return response.data
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      assignee: issue.assignee?.login ?? null,
      labels: issue.labels.map((label) => label.name),
      created_at: issue.created_at,
      url: issue.html_url
    }));
}

export async function assignIssue(issueNumber, assignee) {
  if (!assignee) throw new Error('assignIssue requires an assignee');
  const api = client();
  const creds = getCredentials();
  const response = await api.post(
    `/repos/${creds.owner}/${creds.repo}/issues/${issueNumber}/assignees`,
    { assignees: [assignee] }
  );
  return { number: issueNumber, assignee, url: response.data?.html_url ?? null };
}

export async function createComment(issueNumber, body) {
  if (!body) throw new Error('createComment requires a body');
  const api = client();
  const creds = getCredentials();
  const response = await api.post(
    `/repos/${creds.owner}/${creds.repo}/issues/${issueNumber}/comments`,
    { body }
  );
  return { number: issueNumber, comment_url: response.data?.html_url ?? null };
}

export async function getRecentCommits(limit = 5) {
  const api = client();
  const creds = getCredentials();
  const response = await api.get(`/repos/${creds.owner}/${creds.repo}/commits`, {
    params: { per_page: limit }
  });
  return response.data.map((commit) => ({
    sha: commit.sha,
    message: commit.commit?.message?.split('\n')[0] ?? '',
    author: commit.commit?.author?.name ?? null,
    date: commit.commit?.author?.date ?? null,
    url: commit.html_url
  }));
}
