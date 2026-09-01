import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';

export const FASTRACK_DIR = process.env.FASTRACK_HOME ?? path.join(os.homedir(), '.fastrack');
export const CONFIG_PATH = path.join(FASTRACK_DIR, 'fastrack.config.json');

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

const DEFAULT_CONFIG = {
  models: [],
  activeModel: null,
  connectors: {},
  preferences: {
    autoSelect: true,
    simpleModelThreshold: 500
  }
};

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
      ...raw,
      preferences: {
        ...DEFAULT_CONFIG.preferences,
        ...(raw.preferences ?? {})
      }
    };
  } catch (err) {
    throw new Error(`Config file at ${CONFIG_PATH} is not valid JSON: ${err.message}`);
  }
}

export function saveConfig(config) {
  fs.mkdirSync(FASTRACK_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

// Zero-config onboarding: with no models configured, a GROQ_API_KEY env var
// gives you a working model immediately — nothing is persisted to disk.
function withEnvModel(config) {
  if (config.models && config.models.length > 0) return config;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return config;
  return {
    ...config,
    models: [
      {
        provider: 'groq',
        apiKey,
        model: process.env.FASTRACK_MODEL ?? DEFAULT_GROQ_MODEL,
        baseUrl: GROQ_BASE_URL
      }
    ],
    activeModel: 'groq'
  };
}

const NO_MODEL_ERROR = 'No model configured. Run: fastrack init (or set GROQ_API_KEY for a free Groq model)';

const COMPLEX_KEYWORDS = [
  'build', 'create workflow', 'debug', 'analyze', 'compare', 'design',
  'refactor', 'integrate', 'troubleshoot', 'optimize', 'architect',
  'investigate', 'diagnose', 'plan', 'review'
];

const SIMPLE_KEYWORDS = [
  'summarize', 'summarise', 'format', 'draft', 'list', 'translate',
  'shorten', 'rewrite', 'count'
];

export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function detectTaskType(prompt) {
  const lower = String(prompt).toLowerCase();
  const isComplex = COMPLEX_KEYWORDS.some((keyword) => lower.includes(keyword));
  if (isComplex) return 'complex';

  const isSimple = SIMPLE_KEYWORDS.some((keyword) => lower.includes(keyword));
  if (isSimple) return 'simple';

  return estimateTokens(lower) < 100 ? 'simple' : 'complex';
}

const SMART_MODEL_HINTS = ['opus', 'pro', 'gpt-4', 'claude', 'o1', 'o3', 'frontier'];
const FAST_MODEL_HINTS = ['mini', 'flash', 'nano', 'lite', 'haiku', 'small'];

function modelScore(model) {
  const lower = String(model).toLowerCase();
  if (FAST_MODEL_HINTS.some((hint) => lower.includes(hint))) return 1;
  if (SMART_MODEL_HINTS.some((hint) => lower.includes(hint))) return 3;
  return 2;
}

function pickModel(models, taskType) {
  if (models.length === 0) {
    throw new Error(NO_MODEL_ERROR);
  }
  if (models.length === 1) return models[0];

  const scored = [...models].sort((a, b) => modelScore(a.model) - modelScore(b.model));
  return taskType === 'simple' ? scored[0] : scored[scored.length - 1];
}

export function addModel(provider, apiKey, modelName, extra = {}) {
  if (!provider || !apiKey || !modelName) {
    throw new Error('addModel requires provider, apiKey and modelName');
  }
  const allowed = ['openai', 'anthropic', 'google', 'groq', 'custom'];
  if (!allowed.includes(provider)) {
    throw new Error(`Unknown provider "${provider}". Allowed: ${allowed.join(', ')}`);
  }
  if (provider === 'custom' && !extra.baseUrl) {
    throw new Error('Provider "custom" requires a baseUrl (OpenAI-compatible endpoint)');
  }

  const config = loadConfig();
  const existing = config.models.findIndex(
    (m) => m.provider === provider && m.model === modelName
  );

  const entry = { provider, apiKey, model: modelName };
  if (provider === 'groq') {
    entry.baseUrl = extra.baseUrl ?? GROQ_BASE_URL;
  } else if (extra.baseUrl) {
    entry.baseUrl = extra.baseUrl;
  }

  if (existing >= 0) {
    config.models[existing] = entry;
  } else {
    config.models.push(entry);
  }

  if (!config.activeModel) {
    config.activeModel = provider;
  }

  saveConfig(config);
  return entry;
}

export function setActiveModel(provider) {
  const config = loadConfig();
  const match = config.models.find((m) => m.provider === provider);
  if (!match) {
    throw new Error(`No ${provider} model configured. Add one first with: fastrack model add`);
  }
  config.activeModel = provider;
  saveConfig(config);
  return match;
}

export function getActiveModel() {
  const config = withEnvModel(loadConfig());
  if (!config.activeModel || config.models.length === 0) {
    throw new Error(NO_MODEL_ERROR);
  }
  const match = config.models.find((m) => m.provider === config.activeModel);
  if (!match) {
    throw new Error(`Active model "${config.activeModel}" is configured but has no entry. Run: fastrack init`);
  }
  return match;
}

export function autoSelectModel(prompt) {
  const config = withEnvModel(loadConfig());
  if (!config.models || config.models.length === 0) {
    throw new Error(NO_MODEL_ERROR);
  }

  const useAuto = config.preferences?.autoSelect !== false;
  const taskType = detectTaskType(prompt);
  const threshold = config.preferences?.simpleModelThreshold ?? 500;
  const tokens = estimateTokens(prompt);

  if (useAuto && (taskType === 'simple' ? tokens < threshold : true)) {
    return { ...pickModel(config.models, taskType), taskType, tokens };
  }
  return { ...getActiveModel(), taskType, tokens };
}

function apiErrorMessage(err, fallback) {
  const detail =
    err?.response?.data?.error?.message ??
    err?.response?.data?.message ??
    err?.message ??
    fallback;
  const status = err?.response?.status;
  return status ? `${fallback} (HTTP ${status}): ${detail}` : `${fallback}: ${detail}`;
}

async function callOpenAICompatible(model, prompt, options) {
  const baseUrl = model.baseUrl
    ? model.baseUrl.replace(/\/+$/, '')
    : 'https://api.openai.com/v1';

  let response;
  try {
    response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: model.model,
        messages: [
          ...(options.system ? [{ role: 'system', content: options.system }] : []),
          { role: 'user', content: prompt }
        ],
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 4096
      },
      {
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: options.timeout ?? 120000
      }
    );
  } catch (err) {
    throw new Error(apiErrorMessage(err, `Model request failed (${model.provider}/${model.model})`));
  }

  const choice = response.data?.choices?.[0];
  return choice?.message?.content ?? '';
}

async function callAnthropic(model, prompt, options) {
  let response;
  try {
    response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: model.model,
        max_tokens: options.maxTokens ?? 4096,
        ...(options.system ? { system: options.system } : {}),
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': model.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: options.timeout ?? 120000
      }
    );
  } catch (err) {
    throw new Error(apiErrorMessage(err, `Model request failed (${model.provider}/${model.model})`));
  }

  const text = response.data?.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return text ?? '';
}

async function callGoogle(model, prompt, options) {
  let response;
  try {
    response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent`,
      {
        ...(options.system
          ? { system_instruction: { parts: [{ text: options.system }] } }
          : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.4,
          maxOutputTokens: options.maxTokens ?? 4096
        }
      },
      {
        headers: {
          'x-goog-api-key': model.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: options.timeout ?? 120000
      }
    );
  } catch (err) {
    throw new Error(apiErrorMessage(err, `Model request failed (${model.provider}/${model.model})`));
  }

  const text = response.data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .join('');
  return text ?? '';
}

export async function callModel(prompt, options = {}) {
  const config = withEnvModel(loadConfig());
  const model = options.provider
    ? (config.models.find((m) => m.provider === options.provider) ?? getActiveModel())
    : getActiveModel();

  switch (model.provider) {
    case 'openai':
    case 'custom':
    case 'groq':
      return callOpenAICompatible(model, prompt, options);
    case 'anthropic':
      return callAnthropic(model, prompt, options);
    case 'google':
      return callGoogle(model, prompt, options);
    default:
      throw new Error(`Unknown provider "${model.provider}"`);
  }
}

export async function compareModels(prompt) {
  const config = withEnvModel(loadConfig());
  if (!config.models || config.models.length === 0) {
    throw new Error(NO_MODEL_ERROR);
  }

  const results = await Promise.all(
    config.models.map(async (model) => {
      const start = Date.now();
      try {
        const response = await callModel(prompt, { provider: model.provider });
        return { provider: model.provider, model: model.model, response, duration: Date.now() - start };
      } catch (err) {
        return {
          provider: model.provider,
          model: model.model,
          response: null,
          duration: Date.now() - start,
          error: err.message
        };
      }
    })
  );

  return results;
}

export function listModels() {
  const config = loadConfig();
  return config.models.map(({ provider, model, baseUrl }) => ({
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {})
  }));
}
