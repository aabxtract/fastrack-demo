import axios from 'axios';
import { loadConfig, saveConfig } from '../core/model-router.js';

const API = 'https://api.linear.app/graphql';

function getCredentials() {
  const config = loadConfig();
  const creds = config.connectors?.linear;
  if (!creds || !creds.token) {
    throw new Error('linear not connected. Run: fastrack connect linear');
  }
  return creds;
}

async function gql(query, variables = {}) {
  const creds = getCredentials();
  const response = await axios.post(
    API,
    { query, variables },
    {
      headers: { Authorization: creds.token, 'Content-Type': 'application/json' },
      timeout: 30000
    }
  );
  if (response.data?.errors?.length) {
    throw new Error(`Linear API error: ${response.data.errors[0].message}`);
  }
  return response.data.data;
}

export async function connect(token) {
  if (!token) throw new Error('connect linear requires an API token (Settings -> API)');
  const config = loadConfig();
  config.connectors = config.connectors ?? {};
  config.connectors.linear = { token };
  saveConfig(config);
  return { tool: 'linear' };
}

export async function listTeams() {
  const data = await gql(`query { teams { nodes { id name key } } }`);
  return data.teams.nodes;
}

export async function listWorkflowStates(teamId) {
  const data = await gql(
    `query($teamId: String!) { workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name type } } }`,
    { teamId }
  );
  return data.workflowStates.nodes;
}

export async function listIssues(limit = 10) {
  const data = await gql(
    `query($first: Int!) { issues(first: $first, orderBy: updatedAt) {
       nodes { id identifier title url updatedAt
         state { name type }
         assignee { name }
         team { name }
       }
     } }`,
    { first: limit }
  );
  return data.issues.nodes;
}

export async function createIssue({ title, description, teamId, assigneeId, priority }) {
  if (!title) throw new Error('createIssue requires a title');
  if (!teamId) throw new Error('createIssue requires teamId (use listTeams to find it)');
  const data = await gql(
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) {
       success issue { id identifier title url }
     } }`,
    {
      input: {
        title,
        description,
        teamId,
        ...(assigneeId ? { assigneeId } : {}),
        ...(priority != null ? { priority } : {})
      }
    }
  );
  return data.issueCreate.issue;
}

export async function updateIssueState(issueId, stateId) {
  const data = await gql(
    `mutation($input: IssueUpdateInput!) { issueUpdate(input: $input) { success } }`,
    { input: { id: issueId, stateId } }
  );
  return { ok: data.issueUpdate.success };
}

export async function addComment(issueId, body) {
  const data = await gql(
    `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
    { input: { issueId, body } }
  );
  return { ok: data.commentCreate.success };
}
