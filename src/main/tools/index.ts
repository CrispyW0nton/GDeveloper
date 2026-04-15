/**
 * Sandbox Tool Registry & Permission Model
 * Categories: file-ops, code-search, git, github-api, shell, package-manager, test-lint-build, browser, mcp, artifact
 * Permission Tiers: read-only (auto), write (auto in trusted), high-risk (approval required)
 */

import { ToolDefinition, ToolResult } from '../domain/entities';
import { PermissionTier, ToolCategory } from '../domain/enums';
import { IToolRegistry } from '../domain/interfaces';

class ToolRegistry implements IToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private pendingApprovals: Map<string, (approved: boolean) => void> = new Map();
  private approvalCallback?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;

  constructor() {
    this.registerBuiltinTools();
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: string): ToolDefinition[] {
    return this.getAll().filter(t => t.category === category);
  }

  setApprovalCallback(cb: (toolName: string, input: Record<string, unknown>) => Promise<boolean>): void {
    this.approvalCallback = cb;
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: '', error: `Tool not found: ${name}` };
    }

    // Permission check
    if (tool.permissionTier === PermissionTier.HIGH_RISK) {
      if (this.approvalCallback) {
        const approved = await this.approvalCallback(name, input);
        if (!approved) {
          return { success: false, output: '', error: `Permission denied for high-risk tool: ${name}` };
        }
      }
    }

    try {
      const startTime = Date.now();
      const result = await tool.execute(input);
      const duration = Date.now() - startTime;
      return result;
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private registerBuiltinTools(): void {
    // ─── File Operations ───
    this.register({
      name: 'read_file',
      description: 'Read the contents of a file at the given path',
      category: ToolCategory.FILE_OPS,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to repo root' }
        },
        required: ['path']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Contents of ${input.path}:\n// File content would be read here`
      })
    });

    this.register({
      name: 'write_file',
      description: 'Write content to a file, creating or overwriting it',
      category: ToolCategory.FILE_OPS,
      permissionTier: PermissionTier.WRITE,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'File content' }
        },
        required: ['path', 'content']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `File written: ${input.path} (${String(input.content).length} bytes)`
      })
    });

    this.register({
      name: 'list_directory',
      description: 'List files and directories at the given path',
      category: ToolCategory.FILE_OPS,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Directory listing of ${input.path}:\nsrc/\npackage.json\ntsconfig.json\nREADME.md`
      })
    });

    this.register({
      name: 'edit_file',
      description: 'Apply a targeted edit to an existing file',
      category: ToolCategory.FILE_OPS,
      permissionTier: PermissionTier.WRITE,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_text: { type: 'string' },
          new_text: { type: 'string' }
        },
        required: ['path', 'old_text', 'new_text']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Edited ${input.path}: replaced text`
      })
    });

    // ─── Code Search (ripgrep) ───
    this.register({
      name: 'search_code',
      description: 'Search code using ripgrep patterns across the repository',
      category: ToolCategory.CODE_SEARCH,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex)' },
          path: { type: 'string', description: 'Path to search within' },
          include: { type: 'string', description: 'File pattern filter' }
        },
        required: ['pattern']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Search results for "${input.pattern}":\nsrc/index.ts:3: matching line`
      })
    });

    // ─── Git Operations ───
    this.register({
      name: 'git_status',
      description: 'Show the working tree status',
      category: ToolCategory.GIT,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: { type: 'object', properties: {} },
      source: 'builtin',
      execute: async () => ({
        success: true,
        output: 'On branch main\nnothing to commit, working tree clean'
      })
    });

    this.register({
      name: 'git_diff',
      description: 'Show changes between commits, working tree, etc.',
      category: ToolCategory.GIT,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } }
      },
      source: 'builtin',
      execute: async () => ({
        success: true,
        output: 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts'
      })
    });

    this.register({
      name: 'git_create_branch',
      description: 'Create a new git branch',
      category: ToolCategory.GIT,
      permissionTier: PermissionTier.WRITE,
      inputSchema: {
        type: 'object',
        properties: { branch: { type: 'string' } },
        required: ['branch']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Created branch: ${input.branch}`
      })
    });

    this.register({
      name: 'git_commit',
      description: 'Create a commit with staged changes',
      category: ToolCategory.GIT,
      permissionTier: PermissionTier.WRITE,
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Committed: ${input.message}\nSHA: abc123def`
      })
    });

    // ─── GitHub API ───
    this.register({
      name: 'github_create_pr',
      description: 'Create a pull request on GitHub',
      category: ToolCategory.GITHUB_API,
      permissionTier: PermissionTier.HIGH_RISK,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          head: { type: 'string' },
          base: { type: 'string' }
        },
        required: ['title', 'head', 'base']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `PR created: #42 "${input.title}"\nhttps://github.com/repo/pull/42`
      })
    });

    this.register({
      name: 'github_push',
      description: 'Push changes to remote repository',
      category: ToolCategory.GITHUB_API,
      permissionTier: PermissionTier.HIGH_RISK,
      inputSchema: {
        type: 'object',
        properties: { branch: { type: 'string' } },
        required: ['branch']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Pushed to origin/${input.branch}`
      })
    });

    // ─── Shell Execution ───
    this.register({
      name: 'bash_execute',
      description: 'Execute a bash command in the workspace',
      category: ToolCategory.SHELL,
      permissionTier: PermissionTier.WRITE,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Bash command to execute' },
          timeout: { type: 'number', description: 'Timeout in ms' }
        },
        required: ['command']
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `$ ${input.command}\n[Command output]`
      })
    });

    // ─── Package Managers ───
    this.register({
      name: 'npm_install',
      description: 'Install npm packages',
      category: ToolCategory.PACKAGE_MANAGER,
      permissionTier: PermissionTier.WRITE,
      inputSchema: {
        type: 'object',
        properties: {
          packages: { type: 'string', description: 'Packages to install' }
        }
      },
      source: 'builtin',
      execute: async (input) => ({
        success: true,
        output: `Installed: ${input.packages || 'all dependencies'}`
      })
    });

    // ─── Test/Lint/Build ───
    this.register({
      name: 'run_tests',
      description: 'Run the test suite',
      category: ToolCategory.TEST_LINT_BUILD,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: {
        type: 'object',
        properties: { pattern: { type: 'string' } }
      },
      source: 'builtin',
      execute: async () => ({
        success: true,
        output: 'Test Suites: 3 passed, 3 total\nTests: 12 passed, 12 total'
      })
    });

    this.register({
      name: 'run_lint',
      description: 'Run the linter',
      category: ToolCategory.TEST_LINT_BUILD,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: { type: 'object', properties: {} },
      source: 'builtin',
      execute: async () => ({
        success: true,
        output: 'ESLint: 0 errors, 2 warnings'
      })
    });

    this.register({
      name: 'run_build',
      description: 'Run the build process',
      category: ToolCategory.TEST_LINT_BUILD,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: { type: 'object', properties: {} },
      source: 'builtin',
      execute: async () => ({
        success: true,
        output: 'Build succeeded in 4.2s'
      })
    });

    this.register({
      name: 'run_typecheck',
      description: 'Run TypeScript type checking',
      category: ToolCategory.TEST_LINT_BUILD,
      permissionTier: PermissionTier.READ_ONLY,
      inputSchema: { type: 'object', properties: {} },
      source: 'builtin',
      execute: async () => ({
        success: true,
        output: 'TypeScript: No errors found'
      })
    });
  }
}

// Singleton
let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}

export { ToolRegistry };
