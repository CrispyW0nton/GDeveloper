/**
 * GitHub Integration Layer
 * Handles GitHub App auth, repo listing, file ops, branching, commits, PRs
 */

import { IGitHubGateway } from '../domain/interfaces';
import { Repository } from '../domain/entities';

// ─── Demo Repositories ───
const DEMO_REPOS: Repository[] = [
  {
    id: 'repo-1',
    fullName: 'gdeveloper/web-app',
    defaultBranch: 'main',
    isPrivate: false,
    description: 'Full-stack TypeScript web application',
    language: 'TypeScript',
    installationId: 1
  },
  {
    id: 'repo-2',
    fullName: 'gdeveloper/api-server',
    defaultBranch: 'main',
    isPrivate: true,
    description: 'REST API backend with Express',
    language: 'TypeScript',
    installationId: 1
  },
  {
    id: 'repo-3',
    fullName: 'gdeveloper/mobile-app',
    defaultBranch: 'develop',
    isPrivate: false,
    description: 'React Native mobile application',
    language: 'TypeScript',
    installationId: 1
  },
  {
    id: 'repo-4',
    fullName: 'gdeveloper/infra',
    defaultBranch: 'main',
    isPrivate: true,
    description: 'Infrastructure as Code with Terraform',
    language: 'HCL',
    installationId: 1
  },
  {
    id: 'repo-5',
    fullName: 'gdeveloper/design-system',
    defaultBranch: 'main',
    isPrivate: false,
    description: 'Shared component library and design tokens',
    language: 'TypeScript',
    installationId: 1
  }
];

// Demo file tree
const DEMO_FILES: Record<string, string> = {
  'src/index.ts': `import express from 'express';\nconst app = express();\napp.get('/', (req, res) => res.json({ status: 'ok' }));\napp.listen(3000);`,
  'src/auth/login.ts': `export async function login(email: string, password: string) {\n  // TODO: implement JWT authentication\n  return { token: 'demo-token', user: { email } };\n}`,
  'src/auth/register.ts': `export async function register(email: string, password: string) {\n  // TODO: implement user registration\n  return { success: true, user: { email } };\n}`,
  'package.json': `{\n  "name": "web-app",\n  "version": "1.0.0",\n  "scripts": { "dev": "tsx src/index.ts", "build": "tsc", "test": "vitest" }\n}`,
  'tsconfig.json': `{\n  "compilerOptions": { "target": "ES2022", "module": "ESNext", "strict": true }\n}`,
  'README.md': '# Web App\\n\\nFull-stack TypeScript web application.'
};

export class GitHubAdapter implements IGitHubGateway {
  private token: string | null = null;
  private connected = false;

  async authenticate(token: string): Promise<void> {
    this.token = token;
    this.connected = true;
    // In production: validate token with GitHub API
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listInstallationRepos(_installationId: number): Promise<Repository[]> {
    // In production: use Octokit to list repos
    return DEMO_REPOS;
  }

  async getAllRepos(): Promise<Repository[]> {
    return DEMO_REPOS;
  }

  async getFileContent(repo: string, path: string, _branch: string): Promise<string> {
    return DEMO_FILES[path] || `// File: ${path}\n// Content from ${repo}`;
  }

  async createBranch(repo: string, branch: string, _baseSha: string): Promise<void> {
    console.log(`[GitHub] Created branch ${branch} on ${repo}`);
  }

  async createCommit(
    repo: string,
    branch: string,
    message: string,
    files: Array<{ path: string; content: string }>
  ): Promise<string> {
    const sha = `sha-${Date.now().toString(36)}`;
    console.log(`[GitHub] Commit ${sha} on ${repo}/${branch}: ${message} (${files.length} files)`);
    return sha;
  }

  async createPullRequest(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<{ number: number; url: string }> {
    const prNum = Math.floor(Math.random() * 100) + 1;
    return {
      number: prNum,
      url: `https://github.com/${repo}/pull/${prNum}`
    };
  }

  async listBranches(_repo: string): Promise<string[]> {
    return ['main', 'develop', 'ai/auth-setup', 'ai/user-api'];
  }

  async getLatestSha(_repo: string, _branch: string): Promise<string> {
    return `sha-${Date.now().toString(36)}`;
  }

  async getFileTree(_repo: string, _branch: string): Promise<string[]> {
    return Object.keys(DEMO_FILES);
  }
}

let githubInstance: GitHubAdapter | null = null;

export function getGitHub(): GitHubAdapter {
  if (!githubInstance) {
    githubInstance = new GitHubAdapter();
  }
  return githubInstance;
}
