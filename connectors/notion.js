import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.notion;
  if (!creds || !creds.token || !creds.databaseId) {
    throw new Error('notion not connected. Run: fastrack connect notion');
  }
  return creds;
}

function client() {
  const creds = getCredentials();
  return axios.create({
    baseURL: API,
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
}

function contentToBlocks(content) {
  const text = String(content ?? '');
  if (!text.trim()) return [];

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const blocks = [];
  for (const paragraph of paragraphs) {
    // Notion paragraph blocks hold max 2000 characters per rich text segment
    for (let i = 0; i < paragraph.length; i += 2000) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: paragraph.slice(i, i + 2000) } }]
        }
      });
    }
  }
  return blocks;
}

function pageToSummary(page) {
  const titleProperty = Object.values(page.properties ?? {}).find(
    (prop) => prop.type === 'title'
  );
  const title = titleProperty?.title?.map((part) => part.plain_text).join('') ?? '';
  return {
    id: page.id,
    title,
    url: page.url,
    created_at: page.created_time,
    properties: page.properties
  };
}

export async function connect(token, databaseId) {
  if (!token || !databaseId) {
    throw new Error('connect notion requires token and databaseId');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.notion = { token, databaseId };
  saveConfig(config);
  return { tool: 'notion', databaseId };
}

export async function createPage(title, content = '') {
  const api = client();
  const creds = getCredentials();
  const body = {
    parent: { database_id: creds.databaseId },
    properties: {
      Name: {
        title: [{ type: 'text', text: { content: title } }]
      }
    }
  };
  const blocks = contentToBlocks(content);
  if (blocks.length > 0) body.children = blocks;

  const response = await api.post('/pages', body);
  return pageToSummary(response.data);
}

export async function updatePage(pageId, content) {
  if (!pageId) throw new Error('updatePage requires a pageId');
  const api = client();
  const response = await api.patch(`/pages/${pageId}`, {
    properties: {
      Name: {
        title: [{ type: 'text', text: { content: String(content ?? '') } }]
      }
    }
  });
  return pageToSummary(response.data);
}

export async function queryDatabase(filter = null) {
  const api = client();
  const creds = getCredentials();
  const body = {};
  if (filter) body.filter = filter;

  const pages = [];
  let cursor;
  do {
    if (cursor) body.start_cursor = cursor;
    const response = await api.post(`/databases/${creds.databaseId}/query`, body);
    pages.push(...response.data.results.map(pageToSummary));
    cursor = response.data.has_more ? response.data.next_cursor : undefined;
  } while (cursor);

  return pages;
}

export async function appendBlock(pageId, content) {
  if (!pageId) throw new Error('appendBlock requires a pageId');
  const blocks = contentToBlocks(content);
  if (blocks.length === 0) {
    throw new Error('appendBlock requires non-empty content');
  }
  const api = client();
  const response = await api.patch(`/blocks/${pageId}/children`, { children: blocks });
  return response.data.results.map((block) => ({ id: block.id, type: block.type }));
}
