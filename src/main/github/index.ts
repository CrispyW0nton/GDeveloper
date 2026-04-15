/**
 * GitHub Integration Layer
 * Real GitHub API integration using Octokit REST
 * Supports PAT (Personal Access Token) authentication
 * Lists real repos, branches, files; creates branches, commits, PRs
 */

import { Octokit } from '@octokit/rest';
import { IGitHubGateway } from '../domain/interfaces';
import { Repository } from '../domain/entities';

export class GitHubAdapter implements IGitHubGateway {
  private octokit: Octokit | null = null;
  private token: string | null = null;
  private connected = false;
  private authenticatedUser: string | null = null;

  async authenticate(token: string): Promise<void> {
    this.octokit = new Octokit({ auth: token });

    // Validate token by fetching authenticated user
    try {
      const { data: user } = await this.octokit.users.getAuthenticated();
      this.authenticatedUser = user.login;
      this.token = token;
      this.connected = true;
      console.log(`[GitHub] Authenticated as ${user.login}`);
    } catch (error) {
      this.octokit = null;
      this.connected = false;
      throw new Error(`GitHub authentication failed: ${error instanceof Error ? error.message : 'Invalid token'}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getUsername(): string | null {
    return this.authenticatedUser;
  }

  async disconnect(): Promise<void> {
    this.octokit = null;
    this.token = null;
    this.connected = false;
    this.authenticatedUser = null;
  }

  async getAllRepos(): Promise<Repository[]> {
    if (!this.octokit) throw new Error('Not authenticated');

    try {
      const repos: Repository[] = [];
      // Fetch user's repos (paginated, up to 100)
      const { data } = await this.octokit.repos.listForAuthenticatedUser({
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
        type: 'all'
      });

      for (const repo of data) {
        repos.push({
          id: repo.id.toString(),
          fullName: repo.full_name,
          defaultBranch: repo.default_branch || 'main',
          isPrivate: repo.private,
          description: repo.description || undefined,
          language: repo.language || undefined,
          cloneUrl: repo.clone_url || undefined
        });
      }

      return repos;
    } catch (error) {
      console.error('[GitHub] Failed to list repos:', error);
      throw error;
    }
  }

  async listInstallationRepos(_installationId: number): Promise<Repository[]> {
    return this.getAllRepos();
  }

  async getFileContent(repoFullName: string, path: string, branch: string): Promise<string> {
    if (!this.octokit) throw new Error('Not authenticated');

    const [owner, repo] = repoFullName.split('/');
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch
      });

      if ('content' in data && data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      throw new Error(`Not a file: ${path}`);
    } catch (error) {
      if ((error as any).status === 404) {
        throw new Error(`File not found: ${path}`);
      }
      throw error;
    }
  }

  async getFileTree(repoFullName: string, branch: string): Promise<string[]> {
    if (!this.octokit) throw new Error('Not authenticated');

    const [owner, repo] = repoFullName.split('/');
    try {
      const { data } = await this.octokit.git.getTree({
        owner,
        repo,
        tree_sha: branch,
        recursive: 'true'
      });

      return data.tree
        .filter(item => item.type === 'blob' && item.path)
        .map(item => item.path!);
    } catch (error) {
      console.error('[GitHub] Failed to get file tree:', error);
      return [];
    }
  }

  async listBranches(repoFullName: string): Promise<string[]> {
    if (!this.octokit) throw new Error('Not authenticated');

    const [owner, repo] = repoFullName.split('/');
    try {
      const { data } = await this.octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100
      });
      return data.map(b => b.name);
    } catch (error) {
      console.error('[GitHub] Failed to list branches:', error);
      return [];
    }
  }

  async getLatestSha(repoFullName: string, branch: string): Promise<string> {
    if (!this.octokit) throw new Error('Not authenticated');

    const [owner, repo] = repoFullName.split('/');
    const { data } = await this.octokit.repos.getBranch({
      owner,
      repo,
      branch
    });
    return data.commit.sha;
  }

  async createBranch(repoFullName: string, branch: string, baseSha: string): Promise<void> {
    if (!this.octokit) throw new Error('Not authenticated');

    const [owner, repo] = repoFullName.split('/');
    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: baseSha
    });
    console.log(`[GitHub] Created branch ${branch} on ${repoFullName}`);
  }

  async createCommit(
    repoFullName: string,
    branch: string,
    message: string,
    files: Array<{ path: string; content: string }>
  ): Promise<string> {
    if (!this.octokit) throw new Error('Not authenticated');

    const [owner, repo] = repoFullName.split('/');

    // Get latest commit SHA on this branch
    const { data: ref } = await this.octokit.git.getRef({
      owner, repo, ref: `heads/${branch}`
    });
    const latestCommitSha = ref.object.sha;

    // Get the tree SHA of the latest commit
    const { data: commit } = await this.octokit.git.getCommit({
      owner, repo, commit_sha: latestCommitSha
    });
    const baseTreeSha = commit.tree.sha;

    // Create blobs for each file
    const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];
    for (const file of files) {
      const { data: blob } = await this.octokit.git.createBlob({
        owner, repo,
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64'
      });
      tree.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      });
    }

    // Create new tree
    const { data: newTree } = await this.octokit.git.createTree({
      owner, repo,
      base_tree: baseTreeSha,
      tree
    });

    // Create commit
    const { data: newCommit } = await this.octokit.git.createCommit({
      owner, repo,
      message,
      tree: newTree.sha,
      parents: [latestCommitSha]
    });

    // Update branch reference
    await this.octokit.git.updateRef({
      owner, repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha
    });

    console.log(`[GitHub] Commit ${newCommit.sha.slice(0, 7)} on ${repoFullName}/${branch}: ${message}`);
    return newCommit.sha;
  }

  async createPullRequest(
    repoFullName: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<{ number: number; url: string }> {
    if (!this.octokit) throw new Error('Not authenticated');

    const [owner, repo] = repoFullName.split('/');
    const { data: pr } = await this.octokit.pulls.create({
      owner, repo, title, body, head, base
    });

    console.log(`[GitHub] PR #${pr.number} created: ${pr.html_url}`);
    return {
      number: pr.number,
      url: pr.html_url
    };
  }
}

let githubInstance: GitHubAdapter | null = null;

export function getGitHub(): GitHubAdapter {
  if (!githubInstance) {
    githubInstance = new GitHubAdapter();
  }
  return githubInstance;
}
