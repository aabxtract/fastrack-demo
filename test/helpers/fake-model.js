import http from 'node:http';

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

export function createFakeModelServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    let messages = [];
    try {
      messages = JSON.parse(await readBody(req)).messages ?? [];
    } catch {
      // fall through with empty messages
    }

    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    if (user.includes('FORCE_FAIL')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'forced failure for testing' } }));
      return;
    }

    let content;
    if (system.includes('intent parser')) {
      if (user.includes('echo')) {
        content = JSON.stringify({
          action: 'create_workflow',
          tools_needed: [],
          trigger: { type: 'once', schedule: null, event: null },
          steps: [
            { tool: 'model', action: 'generate_text', params: { prompt: 'Echo: {{input}}' } }
          ],
          assignee: null,
          description: 'Echo the input back'
        });
      } else {
        content = JSON.stringify({
          action: 'create_workflow',
          tools_needed: ['github', 'notion'],
          trigger: { type: 'recurring', schedule: 'every morning at 9am', event: null },
          steps: [
            { tool: 'github', action: 'list_open_prs', params: {} },
            { tool: 'model', action: 'generate_text', params: { prompt: 'Summarize: {{previous}}' } },
            { tool: 'notion', action: 'create_page', params: { title: 'PR Summary', content: '{{previous}}' } }
          ],
          assignee: null,
          description: 'Summarize open PRs into Notion every morning'
        });
      }
    } else if (system.includes('workflow fixer')) {
      content = JSON.stringify({ explanation: 'adjusted params', params: {} });
    } else if (system.includes('workflow optimizer')) {
      content = JSON.stringify({
        observation: 'steps look fine',
        steps: [{ tool: 'model', action: 'generate_text', params: { prompt: 'Echo: {{input}}' } }]
      });
    } else if (system.includes('status report writer')) {
      content = 'FAKE REPORT\n\n## Executive summary\nEverything on track.\n\n## Development progress\n2 PRs open.';
    } else if (system.includes('meeting notes digester')) {
      content = JSON.stringify({
        summary: 'FAKE SUMMARY: synced on launch plan.',
        decisions: ['Ship on Friday'],
        action_items: [{ task: 'Draft launch announcement', assignee: 'Ana', due: 'Wednesday' }],
        topics: ['launch'],
        risks: ['Review not assigned yet']
      });
    } else if (system.includes('workflow planner')) {
      content = JSON.stringify({
        workflows: [
          {
            action: 'create_workflow',
            tools_needed: [],
            trigger: { type: 'once', schedule: null, event: null },
            steps: [{ tool: 'model', action: 'generate_text', params: { prompt: 'Draft: {{input}}' } }],
            assignee: 'Ana',
            description: 'Draft the launch announcement'
          }
        ]
      });
    } else if (system.includes('cron expression') || user.includes('cron')) {
      content = '0 9 * * *';
    } else {
      content = `FAKE OUTPUT: ${String(user).slice(0, 300)}`;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // Don't let the server keep the test process alive after tests finish
      server.unref();
      resolve({ server, port: server.address().port });
    });
  });
}
