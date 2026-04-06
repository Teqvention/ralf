/**
 * GitHub REST API client — replaces gh CLI usage.
 *
 * Requires GITHUB_TOKEN environment variable.
 */

const API_BASE = "https://api.github.com"

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

export async function setLabel(
  n: number,
  label: string,
  repo: string,
  allLabels: string[],
): Promise<void> {
  const { owner, name } = splitRepo(repo)

  // Get current labels on the issue
  const issue = (await apiRequest("GET", `/repos/${owner}/${name}/issues/${n}`)) as {
    labels: { name: string }[]
  }

  // Remove all workflow labels, add the new one
  const currentLabels = issue.labels.map((l) => l.name)
  const filtered = currentLabels.filter((l) => !allLabels.includes(l))
  filtered.push(label)

  try {
    await apiRequest("PATCH", `/repos/${owner}/${name}/issues/${n}`, {
      labels: filtered,
    })
  } catch {
    /* label might not exist yet */
  }
}

export async function closeIssue(n: number, repo: string): Promise<void> {
  const { owner, name } = splitRepo(repo)
  await apiRequest("PATCH", `/repos/${owner}/${name}/issues/${n}`, {
    state: "closed",
  })
}

export async function listIssuesByLabel(
  repo: string,
  label: string,
): Promise<{ number: number }[]> {
  const { owner, name } = splitRepo(repo)
  const data = (await apiRequest(
    "GET",
    `/repos/${owner}/${name}/issues?labels=${encodeURIComponent(label)}&per_page=100&state=all`,
  )) as { number: number }[]
  return data
}

export async function fetchSubIssues(
  n: number,
  repo: string,
): Promise<{ number: number; title: string }[]> {
  const { owner, name } = splitRepo(repo)
  const data = (await apiRequest(
    "GET",
    `/repos/${owner}/${name}/issues/${n}/sub_issues?per_page=100`,
  )) as { number: number; title: string }[]
  return data
}

export function hasToken(): boolean {
  return !!process.env.GITHUB_TOKEN
}
