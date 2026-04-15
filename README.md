# GDeveloper - Matrix AI Coding Platform

A native Windows desktop AI coding application built with **Electron + TypeScript + React**, featuring a Matrix-themed UI with live wallpaper background, GitHub integration, MCP (Model Context Protocol) server management, and multi-prompt orchestration engine.

## Features

- **Matrix-Themed UI** - Dark neon-green interface with looping Matrix video background, CRT scanline overlay, glass panels, glowing animations
- **Clean Architecture** - Domain / Use Cases / Adapters / Infrastructure layers with dependency injection
- **Multi-Prompt Orchestration** - Hidden prompt system with 7 roles (system, planner, executor, verifier, repair, summarizer, compactor) and task state machine
- **MCP Server Management** - Add, connect, browse tools, enable/disable per-tool, supports stdio/http/sse transports
- **GitHub Integration** - GitHub App OAuth, repo listing/selection, branch creation, commits, pull requests
- **Sandbox Tool Registry** - 15+ built-in tools with 3-tier permissions (read-only, write, high-risk requiring approval)
- **Task Ledger** - Full state machine (CREATED -> SCOPED -> PLANNED -> EXECUTING -> VERIFYING -> COMMIT_READY -> PR_READY -> DONE/BLOCKED)
- **Secure Settings** - Encrypted API key storage via OS keychain, scoped repo isolation
- **Windows .exe Build** - electron-builder NSIS installer packaging

## Architecture

```
src/
├── main/                          # Electron Main Process
│   ├── domain/
│   │   ├── entities/              # Task, TaskLedger, MCPServerConfig, ToolDefinition, etc.
│   │   ├── enums/                 # TaskStatus, PermissionTier, PromptRole, MCPTransport
│   │   └── interfaces/            # ILLMProvider, IGitHubGateway, IToolRegistry, IMCPClientManager
│   ├── db/                        # SQLite schema (12 tables) + database manager
│   ├── security/                  # Encrypted API key storage
│   ├── providers/                 # ClaudeProvider + ProviderRegistry
│   ├── github/                    # GitHub adapter (OAuth, repos, branches, commits, PRs)
│   ├── orchestration/             # State machine, budget controls, loop detection
│   │   └── prompts/               # 7 prompt role templates
│   ├── tools/                     # Tool registry with permission tiers
│   ├── mcp/                       # MCP client manager (stdio/http/sse)
│   └── ipc/                       # IPC channel definitions
├── preload/                       # Electron preload script (contextBridge)
└── renderer/                      # React UI
    ├── components/
    │   ├── common/Sidebar          # Navigation with matrix rain effect
    │   ├── settings/SettingsPanel  # API key config, orchestration prefs, permissions
    │   ├── github/GitHubPanel      # GitHub App connection & repo selection
    │   ├── chat/ChatWorkspace      # AI coding chat with orchestration phases
    │   ├── mcp/MCPServersPanel     # MCP server management & tool browser
    │   ├── tasks/TaskLedgerPanel   # Task state machine & acceptance criteria
    │   ├── diff/DiffViewer         # File diffs + verification results
    │   └── activity/ActivityLog    # Branch/commit/PR timeline
    ├── store/                      # State management
    └── styles/globals.css          # Matrix theme CSS
```

## Quick Start

### Prerequisites
- Node.js 18+ (https://nodejs.org/)
- npm 9+

### Development (Web Preview)
```bash
npm install
npm run dev:web
# Opens at http://localhost:3000
```

### Development (Electron)
```bash
npm install
npm run dev
# Opens native Electron window
```

### Build Windows .exe
```bash
# Option 1: Use the build script
build_windows.bat

# Option 2: Manual
npm install
npm run build
npm run package
# Output: dist-package/GDeveloper Setup *.exe
```

## Matrix Video Background

Place your Matrix video wallpaper at `resources/matrix-bg.mp4`. The video plays as a subtle looping background behind the CRT scanline overlay.

## MVP Vertical Slice

1. **Launch app** -> Settings tab -> Add Claude API key
2. **GitHub tab** -> Connect -> Select repository
3. **MCP Servers tab** -> Connect Filesystem Server -> View discovered tools
4. **Chat tab** -> Ask AI to implement a feature -> Watch orchestration phases (planning -> scoping -> executing -> verifying)
5. **Task Ledger** -> Track state machine transitions and acceptance criteria
6. **Diff View** -> See file changes + verification results (tests/lint/typecheck/build)
7. **Activity** -> View branches, commits, PR timeline

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Electron 31 |
| UI | React 18 + TypeScript 5.5 |
| Styling | Tailwind CSS 3.4 + custom Matrix theme |
| Build | electron-vite + electron-builder |
| Database | better-sqlite3 (local SQLite) |
| AI Provider | Anthropic Claude SDK |
| GitHub | Octokit (App + REST) |
| MCP | Model Context Protocol TypeScript SDK |
| Packaging | NSIS (.exe installer) |

## Key References

- [Model Context Protocol Spec](https://modelcontextprotocol.io/specification/2025-06-18)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Electron](https://www.electronjs.org/)
- [electron-builder](https://www.electron.build/)
- [electron-vite](https://electron-vite.org/)
- [Unreal-MCP-Ghost](https://github.com/CrispyW0nton/Unreal-MCP-Ghost)

## License

Private - All rights reserved.
