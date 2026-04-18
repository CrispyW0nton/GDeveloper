/**
 * GitHub Source Fetcher — Sprint 27 (Block 6)
 * Fetches exact line ranges from GitHub URLs for source-verified research output.
 *
 * Supports:
 *   - https://github.com/owner/repo/blob/branch/path#L10-L20
 *   - https://raw.githubusercontent.com/owner/repo/branch/path
 *   - GitHub API for private repos (if token available)
 */

import { getGitHub } from '../github';

export interface SourceSnippet {
  url: string;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  content: string;
  fetchedAt: string;
}

/**
 * Parse a GitHub URL to extract owner, repo, branch, path, and line range.
 */
export function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
} | null {
  // https://github.com/owner/repo/blob/branch/path/to/file#L10-L20
  const blobMatch = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/
  );
  if (blobMatch) {
    return {
      owner: blobMatch[1],
      repo: blobMatch[2],
      branch: blobMatch[3],
      filePath: blobMatch[4].split('#')[0],
      startLine: blobMatch[5] ? parseInt(blobMatch[5], 10) : undefined,
      endLine: blobMatch[6] ? parseInt(blobMatch[6], 10) : undefined,
    };
  }

  // https://raw.githubusercontent.com/owner/repo/branch/path
  const rawMatch = url.match(
    /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
  );
  if (rawMatch) {
    return {
      owner: rawMatch[1],
      repo: rawMatch[2],
      branch: rawMatch[3],
      filePath: rawMatch[4],
    };
  }

  return null;
}

/**
 * Fetch file content from GitHub (public or via token).
 */
export async function fetchGitHubSource(url: string): Promise<SourceSnippet | null> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) return null;

  const { owner, repo, branch, filePath, startLine, endLine } = parsed;
  let content: string;

  try {
    // Try the GitHub API first (works for both public and private repos)
    const gh = getGitHub();
    if (gh.isConnected()) {
      try {
        content = await gh.getFileContent(`${owner}/${repo}`, filePath, branch);
      } catch {
        // Fallback to raw URL
        content = await fetchRaw(owner, repo, branch, filePath);
      }
    } else {
      content = await fetchRaw(owner, repo, branch, filePath);
    }
  } catch (err) {
    console.warn(`[Research] Failed to fetch ${url}:`, err);
    return null;
  }

  // Extract line range if specified
  if (startLine !== undefined) {
    const lines = content.split('\n');
    const start = Math.max(0, startLine - 1);
    const end = endLine !== undefined ? endLine : startLine;
    content = lines.slice(start, end).join('\n');
  }

  return {
    url,
    owner,
    repo,
    branch,
    filePath,
    startLine,
    endLine,
    content,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchRaw(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
): Promise<string> {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const response = await fetch(rawUrl, {
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${rawUrl}`);
  }

  return response.text();
}

/**
 * Format source snippets as Markdown for research output.
 */
export function formatSourceSnippets(snippets: SourceSnippet[]): string {
  if (snippets.length === 0) return '';

  const lines: string[] = ['### Source References'];
  for (const s of snippets) {
    const range = s.startLine
      ? s.endLine
        ? `L${s.startLine}-L${s.endLine}`
        : `L${s.startLine}`
      : '';
    lines.push(`\n**[${s.repo}/${s.filePath}${range ? '#' + range : ''}](${s.url})**`);
    lines.push('```');
    lines.push(s.content.substring(0, 2000));
    if (s.content.length > 2000) lines.push('... (truncated)');
    lines.push('```');
  }

  return lines.join('\n');
}
