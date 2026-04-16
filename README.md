# GDeveloper

**Matrix-themed AI coding platform** built with Electron, React, and TypeScript. Chat with Claude to read, write, and manage code in your local repositories -- all from a cyberpunk desktop app with a real-time Matrix rain background.

## What it does

GDeveloper connects Claude AI to your local workspace and gives it tools to read files, write code, run commands, and manage git -- so you can describe what you want built and watch it happen.

**Key capabilities:**
- Chat with Claude that can read, write, and edit files in your project
- 11 built-in coding tools (read_file, write_file, patch_file, list_files, search_files, run_command, git_status, git_diff, git_log, git_create_branch, git_commit)
- MCP server connectivity for 312+ additional tools
- Slash commands for git operations (`/commit`, `/push`, `/diff`, `/undo`, `/status`)
- Plan/Build execution modes -- research first, then implement
- VS Code-style bottom terminal panel (Ctrl+`)
- Clone wizard, workspace registry, git toolbar
- GitHub OAuth integration for repo management
- SQLite-backed persistence for chat history, tasks, and activity

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- npm 9+
- A [Claude API key](https://console.anthropic.com/) from Anthropic

### Install and Run

```bash
# Clone the repo
git clone https://github.com/CrispyW0nton/GDeveloper.git
cd GDeveloper

# Install dependencies
npm install

# Start in development mode (Electron window)
npm run dev
```

### First-time Setup

1. **Add your API key** -- The app opens to Settings. Paste your Claude API key and click Validate.
2. **Open a workspace** -- Go to Workspaces tab. Either clone a repo or open an existing local folder.
3. **Start chatting** -- The Chat tab is now active. Type what you want to build or fix. The AI can read your files, write code, and run commands.

### Build for Production

```bash
npm run build        # Compiles TypeScript and bundles
npm run package      # Creates installer (.exe on Windows)
```

## Slash Commands

Type `/` in the chat input to see all available commands:

| Command | What it does |
|---------|-------------|
| `/commit [message]` | Stage all changes and commit. Omit the message for an AI-generated conventional commit. |
| `/push` | Push current branch to remote. |
| `/diff` | Show current git diff inline in chat. |
| `/undo` | Soft reset the last commit (with confirmation). |
| `/status` | Show branch, tracking info, and file counts. |
| `/plan` | Switch to Plan mode -- read-only tools, research focus. |
| `/build` | Switch to Build mode -- all tools enabled. |
| `/tools` | List all available tools (local + MCP). |
| `/clear` | Clear the chat display. |

## Plan / Build Modes

- **Plan mode** (`/plan`): The AI can only read, search, and analyze your codebase. Write tools are disabled. Use this for research and planning before making changes.
- **Build mode** (`/build`): The AI has full access to read, write, edit files, run commands, and make commits. This is the default mode.

A mode indicator is shown in the chat header.

## Terminal

Press **Ctrl+`** (backtick) to toggle the bottom terminal panel. It stays visible across all tabs.

- Run commands in your workspace directory
- Multiple terminal tabs with independent histories
- Shell selector (auto-detects available shells)
- Resizable by dragging the top edge

## Project Structure

```
src/
  main/               Electron main process
    commands/          Slash command registry
    db/                SQLite database (chat, tasks, activity, workspaces)
    providers/         Claude API provider
    tools/             11 local coding tools
    mcp/               MCP server manager
    github/            GitHub OAuth + API
    orchestration/     System prompts
    ipc/               IPC channel definitions
  preload/             Secure IPC bridge
  renderer/            React UI
    components/
      chat/            Chat workspace, slash dropdown, suggestions, follow-ups
      common/          Sidebar, Matrix rain, bottom panel
      terminal/        Terminal panel with tabs
      workspace/       Clone wizard, git toolbar, commit panel
      github/          GitHub connection panel
      mcp/             MCP server management
      tasks/           Task ledger
      diff/            Diff viewer
      activity/        Activity log
      settings/        API key and settings
    store/             App state management
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Electron 31 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS + custom Matrix theme |
| Build | electron-vite |
| Database | better-sqlite3 (SQLite) |
| AI | Claude (via Anthropic API) |
| Git | simple-git |
| MCP | @modelcontextprotocol/sdk |
| GitHub | Octokit |

## License

All rights reserved.
