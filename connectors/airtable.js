import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.airtable;
  if (!creds || !creds.token || !creds.baseId || !creds.tableName) {
    throw new Error('airtable not connected. Run: fastrack connect airtable');
  }
  return creds;
}

function client() {
  const creds = getCredentials();
  return axios.create({
    baseURL: `https://api.airtable.com/v0/${creds.baseId}/${encodeURIComponent(creds.tableName)}`,
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    timeout: 30000
  });
}

export async function connect(token, baseId, tableName) {
  if (!token || !baseId || !tableName) {
    throw new Error('connect airtable requires token, baseId and tableName');
  }
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.airtable = { token, baseId, tableName };
  saveConfig(config);
  return { tool: 'airtable', baseId, tableName };
}

export async function createRecord(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new Error('createRecord requires a fields object');
  }
  const response = await client().post('', { records: [{ fields }], typecast: true });
  const record = response.data.records[0];
  return { id: record.id, fields: record.fields, url: record.fields?.url ?? null };
}

export async function listRecords(options = {}) {
  const response = await client().get('', {
    params: {
      maxRecords: options.maxRecords ?? 20,
      filterByFormula: options.filterByFormula ?? undefined,
      sort: options.sort ?? undefined
    }
  });
  return response.data.records.map((record) => ({
    id: record.id,
    fields: record.fields,
    created_at: record.createdTime
  }));
}

export async function updateRecord(recordId, fields) {
  if (!recordId || !fields) throw new Error('updateRecord requires recordId and fields');
  const response = await client().patch('', {
    records: [{ id: recordId, fields }],
    typecast: true
  });
  const record = response.data.records[0];
  return { id: record.id, fields: record.fields };
}

export async function findRecordsByField(field, value) {
  const formula = `({${field}} = "${String(value).replace(/"/g, '\\"')}")`;
  return listRecords({ filterByFormula: formula });
}
