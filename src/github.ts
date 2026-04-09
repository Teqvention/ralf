/**
 * GitHub API client — REST for issues, GraphQL for Projects V2 status.
 *
 * Requires GITHUB_TOKEN environment variable.
 */

const API_BASE = "https://api.github.com"
const GRAPHQL_URL = "https://api.github.com/graphql"

function getToken(): string {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required")
  }
  return token
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/")
  return { owner, name }
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined
  return res.json()
}

async function graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json() as { data?: T; errors?: { message: string }[] }
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL: ${json.errors.map((e) => e.message).join(", ")}`)
  }
  if (!json.data) {
    throw new Error("GitHub GraphQL: no data in response")
  }
  return json.data
}

// --- Public API ---

export interface Issue {
  title: string
  body: string
}

export async function fetchIssue(n: number, repo: string): Promise<Issue> {
  const { owner, name } = splitRepo(repo)
  const data = (await apiRequest("GET", `/repos/${owner}/${name}/issues/${n}`)) as {
    title: string
    body: string | null
  }
  return { title: data.title, body: data.body ?? "" }
}

export async function closeIssue(n: number, repo: string): Promise<void> {
  const { owner, name } = splitRepo(repo)
  await apiRequest("PATCH", `/repos/${owner}/${name}/issues/${n}`, {
    state: "closed",
  })
}

export async function fetchSubIssues(
  n: number,
  repo: string,
): Promise<{ number: number; title: string; body: string; state: string }[]> {
  const { owner, name } = splitRepo(repo)
  const data = (await apiRequest(
    "GET",
    `/repos/${owner}/${name}/issues/${n}/sub_issues?per_page=100`,
  )) as { number: number; title: string; body: string | null; state: string }[]
  return data.map((d) => ({ number: d.number, title: d.title, body: d.body ?? "", state: d.state }))
}

export function hasToken(): boolean {
  return !!process.env.GITHUB_TOKEN
}

// --- Projects V2 GraphQL Status API ---

/**
 * Find the Project V2 node ID for a given project number owned by the repo owner.
 * Checks both user and org projects.
 */
export async function findProjectId(owner: string, projectNumber: number): Promise<string> {
  // Try org first
  try {
    const orgData = await graphql<{
      organization: { projectV2: { id: string } }
    }>(
      `query($owner: String!, $number: Int!) {
        organization(login: $owner) {
          projectV2(number: $number) { id }
        }
      }`,
      { owner, number: projectNumber },
    )
    return orgData.organization.projectV2.id
  } catch {
    // Fall back to user
    const userData = await graphql<{
      user: { projectV2: { id: string } }
    }>(
      `query($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) { id }
        }
      }`,
      { owner, number: projectNumber },
    )
    return userData.user.projectV2.id
  }
}

/**
 * Find the Status field ID and its option IDs for a project.
 */
export async function getStatusField(
  projectId: string,
): Promise<{ fieldId: string; options: { id: string; name: string }[] }> {
  const data = await graphql<{
    node: {
      fields: {
        nodes: {
          id: string
          name: string
          options?: { id: string; name: string }[]
        }[]
      }
    }
  }>(
    `query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }`,
    { projectId },
  )
  const statusField = data.node.fields.nodes.find(
    (f) => f.name === "Status" && f.options,
  )
  if (!statusField || !statusField.options) {
    throw new Error("No 'Status' single-select field found in project")
  }
  return { fieldId: statusField.id, options: statusField.options }
}

/**
 * Find the project item ID for a given issue in a project.
 */
export async function findProjectItemId(
  projectId: string,
  issueNumber: number,
  repo: string,
): Promise<string | null> {
  const { owner, name } = splitRepo(repo)

  // Get the issue node ID first
  const issueData = await graphql<{
    repository: { issue: { id: string } }
  }>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) { id }
      }
    }`,
    { owner, repo: name, number: issueNumber },
  )
  const issueNodeId = issueData.repository.issue.id

  // Search project items for this issue
  const itemsData = await graphql<{
    node: {
      items: {
        nodes: { id: string; content: { id: string } | null }[]
        pageInfo: { hasNextPage: boolean; endCursor: string }
      }
    }
  }>(
    `query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes {
              id
              content {
                ... on Issue { id }
                ... on PullRequest { id }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }`,
    { projectId },
  )

  const match = itemsData.node.items.nodes.find(
    (item) => item.content?.id === issueNodeId,
  )
  return match?.id ?? null
}

/**
 * Add an issue to a project if not already there, return the item ID.
 */
export async function addIssueToProject(
  projectId: string,
  issueNumber: number,
  repo: string,
): Promise<string> {
  const existing = await findProjectItemId(projectId, issueNumber, repo)
  if (existing) return existing

  const { owner, name } = splitRepo(repo)
  const issueData = await graphql<{
    repository: { issue: { id: string } }
  }>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) { id }
      }
    }`,
    { owner, repo: name, number: issueNumber },
  )

  const addData = await graphql<{
    addProjectV2ItemById: { item: { id: string } }
  }>(
    `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
    { projectId, contentId: issueData.repository.issue.id },
  )
  return addData.addProjectV2ItemById.item.id
}

/**
 * Set the Status field on a project item.
 */
export async function setStatus(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): Promise<void> {
  await graphql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }`,
    { projectId, itemId, fieldId, optionId },
  )
}

/**
 * High-level: set the status of an issue by status name.
 * Caches project/field metadata after first call.
 */
let _projectCache: {
  projectId: string
  fieldId: string
  options: { id: string; name: string }[]
} | null = null

export async function setIssueStatus(
  issueNumber: number,
  statusName: string,
  repo: string,
  projectNumber: number,
): Promise<void> {
  const { owner } = splitRepo(repo)

  if (!_projectCache) {
    const projectId = await findProjectId(owner, projectNumber)
    const { fieldId, options } = await getStatusField(projectId)
    _projectCache = { projectId, fieldId, options }
  }

  const { projectId, fieldId, options } = _projectCache
  const option = options.find((o) => o.name === statusName)
  if (!option) {
    throw new Error(
      `Status "${statusName}" not found in project. Available: ${options.map((o) => o.name).join(", ")}`,
    )
  }

  const itemId = await addIssueToProject(projectId, issueNumber, repo)
  await setStatus(projectId, itemId, fieldId, option.id)
}

/**
 * Get count of issues per status in a project.
 */
export async function getStatusCounts(
  repo: string,
  projectNumber: number,
): Promise<Record<string, number>> {
  const { owner } = splitRepo(repo)
  const projectId = await findProjectId(owner, projectNumber)
  const { fieldId } = await getStatusField(projectId)

  const data = await graphql<{
    node: {
      items: {
        nodes: {
          fieldValues: {
            nodes: {
              field?: { id: string }
              name?: string
            }[]
          }
        }[]
      }
    }
  }>(
    `query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes {
              fieldValues(first: 10) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    field { id }
                    name
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { projectId },
  )

  const counts: Record<string, number> = {}
  for (const item of data.node.items.nodes) {
    const statusValue = item.fieldValues.nodes.find(
      (fv) => fv.field?.id === fieldId,
    )
    const name = statusValue?.name ?? "(no status)"
    counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}

/**
 * Reset the project cache (useful for testing or when switching projects).
 */
export function resetProjectCache(): void {
  _projectCache = null
}
