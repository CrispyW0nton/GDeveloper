# GDeveloper

Your AI coding assistant, on your desktop. Chat with Claude and it reads, writes, and runs code in your local projects.

**Built with:** Electron + React + TypeScript | **Default theme:** Matrix

---

## Start Here (5 minutes)

> **TL;DR** — Install Node.js + Git, clone this repo, run `npm install && npm run dev`, paste your Claude API key, open a project, start chatting.

### 1. Prerequisites

You need two things:

- **Node.js 18+** — [Download LTS](https://nodejs.org/)
- **Git** — [Download](https://git-scm.com/downloads)

Already have them? Check:

```bash
node --version   # should print v18+ or v20+
git --version    # should print 2.x
```

### 2. Install & Launch

```bash
git clone https://github.com/CrispyW0nton/GDeveloper.git
cd GDeveloper
npm install        # takes 1-2 min
npm run dev        # opens the app
```

### 3. Add Your API Key

1. The app opens to **Settings** (or click the gear icon)
2. Get a Claude API key from [console.anthropic.com](https://console.anthropic.com/)
3. Paste it in, click **Save & Validate**
4. Green checkmark = you're good

### 4. Open a Project

Go to **Workspaces** in the sidebar. Three ways to add a project:

| Method | When to use |
|--------|------------|
| **Open Folder** | You already have a project on your computer |
| **Clone** | Paste a GitHub URL to clone a new repo |
| **Scan** | Auto-find Git repos on your machine |

### 5. Start Chatting

Go to the **Chat** tab. Type what you want. Examples:

- `Explain the architecture of this project`
- `Fix the bug in the login form`
- `Add a dark mode toggle to the settings page`
- `Write tests for the auth module`

Claude reads your files, writes code, runs commands, and commits — right from the chat.

**That's it. You're running.**

---

## What Can GDeveloper Do?

### Claude can...

| Capability | Example |
|-----------|---------|
| Read & search files | "Find all files that import React" |
| Write & edit code | "Add error handling to the API routes" |
| Run terminal commands | "Run the test suite" |
| Git operations | "Commit these changes with a good message" |
| Deep research | "Research the best auth library for this stack" |
| Compare repos | "Compare this repo with the upstream fork" |

### You get...

- **Chat with tool visibility** — see exactly what Claude reads, writes, and runs
- **Built-in terminal** — press `Ctrl+`` to toggle, runs in your project directory
- **Git toolbar** — pull, push, commit, branch, stash — all from the UI
- **Two modes** — Plan (read-only research) and Build (full access)
- **Theme studio** — customize colors, backdrops, effects, save presets
- **26 slash commands** — type `/` in chat to see them all
- **MCP server support** — connect 300+ extra tools
- **GitHub OAuth** — connect your account for repo access
- **Activity log** — full audit trail of everything that happens
- **SQLite-backed** — chat history, tasks, and logs persist across restarts

---

## Modes: Plan vs Build

GDeveloper has two execution modes. Switch with `/plan` and `/build`, or use the header toggle.

| | Plan Mode | Build Mode |
|---|-----------|------------|
| **Purpose** | Research & analysis | Full implementation |
| **Can read files** | Yes | Yes |
| **Can write files** | No | Yes |
| **Can run commands** | No | Yes |
| **Can commit** | No | Yes |
| **When to use** | "Analyze this before changing anything" | "Go ahead and implement it" |

> **Tip:** Start in Plan mode when you're unsure. Review the plan, then switch to Build.

---

## Slash Commands

Type `/` in the chat input to see all 26 commands. Here's a quick reference:

### Getting Started

| Command | What it does |
|---------|-------------|
| `/tools` | List all available tools (local + MCP) |
| `/plan` | Switch to Plan mode (read-only) |
| `/build` | Switch to Build mode (full access) |
| `/clear` | Clear the chat display |

### Git

| Command | What it does |
|---------|-------------|
| `/commit [msg]` | Stage all + commit. Skip msg for AI-generated message |
| `/push` | Push current branch to remote |
| `/diff` | Show git diff inline in chat |
| `/undo` | Soft reset last commit (keeps changes) |
| `/status` | Branch info, ahead/behind, file counts |

### Research & Analysis

| Command | What it does |
|---------|-------------|
| `/research <question>` | Deep multi-step research workflow |
| `/research-continue <follow-up>` | Refine or continue last research |
| `/compare-repos <path1> <path2>` | Side-by-side repo comparison |
| `/verify-last` | Truthfulness check: compare agent claims vs actual git state |

### Worktrees (Advanced)

Worktrees let you work on multiple branches simultaneously without stashing or switching.

| Command | What it does |
|---------|-------------|
| `/worktree-list` | List all worktrees |
| `/worktree-add <path> [branch]` | Create a new worktree |
| `/worktree-remove <path>` | Remove a linked worktree |
| `/worktree-isolate <description>` | Create isolated worktree for a task |
| `/worktree-handoff [path] [branch]` | Get merge/cherry-pick info for handoff |
| `/worktree-lock <path>` | Lock a worktree (prevent pruning) |
| `/worktree-unlock <path>` | Unlock a worktree |
| `/worktree-prune` | Clean up stale worktree references |
| `/worktree-repair` | Fix broken worktree links |
| `/compare-worktrees <p1> <p2>` | Compare two worktrees |

### Workflow (Stubs)

| Command | What it does |
|---------|-------------|
| `/pr` | Create a pull request (coming soon) |
| `/handoff` | Generate developer handoff package (coming soon) |
| `/plan-generate` | Generate a development roadmap (coming soon) |

---

## Worktrees: What & Why

> **New to worktrees?** They're a Git feature that lets you check out multiple branches at the same time, each in its own folder. No more `git stash` juggling.

**When to use worktrees:**

- You're working on a feature but need to hotfix something on `main`
- You want AI to experiment in isolation without risking your current work
- You're comparing two branches side by side
- You want parallel development across multiple features

**How it works in GDeveloper:**

1. Go to **Workspaces > Worktrees** tab
2. Click **+ Add Worktree** or **Isolate Task**
3. Each worktree gets its own folder and branch
4. Switch between them in the Worktree Manager
5. When done, use `/worktree-handoff` to get merge instructions

---

## MCP: What Is It?

> **MCP** (Model Context Protocol) lets you connect Claude to external tools — databases, APIs, file systems, cloud services. Think of it as plugins for the AI.

**How to use:**

1. Go to the **MCP** tab in the sidebar
2. Click **Add Server** and enter the server config (name, command, args)
3. Once connected, Claude can use those tools alongside the built-in ones
4. Use `/tools` to see everything available

**Example MCP servers:** filesystem, GitHub, Slack, databases, web search, and [hundreds more](https://github.com/modelcontextprotocol/servers).

---

## Theme Customization

Open **Settings > Theme Customization Studio** to personalize GDeveloper:

- Edit colors for background, text, accents, borders, panels, terminal, overlays
- Pick a backdrop: Matrix rain, puddles, animated gradient, static noise, or none
- Adjust opacity and intensity
- Save and name custom presets
- Live preview before applying
- Reset to Matrix default anytime

The Matrix theme is the default and can't be deleted. Your presets persist across restarts.

---

## Terminal

Press **Ctrl+\`** (backtick) to toggle the bottom terminal panel.

- Runs in your workspace directory
- Multiple tabs supported
- Auto-detects your shell
- Drag the top edge to resize

---

## Verification & Trust

GDeveloper includes a truthfulness verification system. Run `/verify-last` to:

- Compare git status against agent-reported activity
- Cross-check DB-recorded diffs with actual file changes
- See a truthfulness score (percentage of files that match)
- Get recommendations for resolving discrepancies

This helps you verify that the AI did what it said it did.

---

## Example Prompts

Not sure what to ask? Here are some starters:

### Understanding a Codebase
- "Explain the architecture of this project"
- "What does the main entry point do?"
- "Find all API endpoints and list them"
- "What testing framework is used, and where are the tests?"

### Fixing Bugs
- "There's a bug where the login form doesn't validate email addresses. Find and fix it."
- "The app crashes when the user clicks Submit with empty fields. Debug this."
- "Why is the API returning 500 errors on the /users endpoint?"

### Building Features
- "Add a dark mode toggle that persists across page reloads"
- "Create a REST API endpoint for user registration with validation"
- "Implement search functionality with debouncing"

### Git & Workflow
- "Commit these changes with a descriptive message"
- "What changed since the last release?"
- "Create a new branch called feature/notifications and switch to it"

### Research
- "/research best practices for React error boundaries"
- "/research compare Prisma vs Drizzle for this project's needs"
- "/compare-repos ./my-app ../reference-app architecture"

### MCP & Tools
- "/tools" — see what's available
- "Use the filesystem MCP to read the config from /etc/nginx/nginx.conf"

---

## Build for Production

```bash
npm run build      # compile
npm run package    # create installer
```

Creates a distributable installer for your platform.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 31 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS |
| Build | electron-vite |
| Database | SQLite (better-sqlite3) |
| AI | Claude via Anthropic API |
| Git | simple-git |
| MCP | @modelcontextprotocol/sdk |
| GitHub | Octokit |

---

## Project Structure

```
src/
  main/                 Electron main process
    commands/            Slash command registry + worktree commands
    db/                  SQLite database (chat, tasks, activity, diffs)
    discovery/           Repo scanning and import
    environment/         Stack detection, Python env profiles
    git/                 Git worktree engine
    migration/           Workspace migration utilities
    research/            Deep research workflows
    providers/           Claude API provider
    tools/               Built-in coding tools (20 tools)
    mcp/                 MCP server manager
    github/              GitHub OAuth integration
    orchestration/       System prompts and context
    security/            Encrypted settings (OS keychain)
    worktree/            AI task isolation engine
  preload/               IPC bridge (renderer <-> main)
  renderer/              React UI
    components/
      chat/              Chat interface, suggestions, follow-ups, tool cards
      common/            Sidebar, Matrix rain, bottom panel
      terminal/          Terminal panel (xterm.js)
      workspace/         Workspace management, git toolbar
      worktree/          Worktree Manager UI
      github/            GitHub connection
      mcp/               MCP server management + Forge
      tasks/             Task ledger
      diff/              Diff viewer (DB diffs + live git diff)
      activity/          Activity log with timeline
      settings/          Settings + Theme Customization Studio
      background/        Backdrop renderer
      sandbox/           Sandbox monitor
    themes/              Token model, presets, theme context
    store/               App state management
```

---

## FAQ

**Q: Is my API key safe?**
A: Yes. Keys are encrypted via Electron safeStorage (your OS keychain). They never leave the main process — the UI only sees masked values.

**Q: Can the AI delete my files?**
A: In Build mode, yes — but destructive operations like push, delete, and deploy always require confirmation. Use Plan mode for safe exploration.

**Q: What models are supported?**
A: Claude (Sonnet, Opus, Haiku) via Anthropic API. OpenAI-compatible endpoints also work. Select your model in Settings.

**Q: Does it work offline?**
A: The app itself runs locally, but you need internet for the AI API calls. Git operations work offline as usual.

**Q: Where is my data stored?**
A: SQLite database in your app data directory. Chat history, task plans, activity logs, and diff records all persist across restarts.

---

## Known Dev-Only Warnings

When running `npm run dev`, the browser console will show:

> Electron Security Warning (Insecure Content-Security-Policy)
> This renderer process has ... 'unsafe-eval' enabled.

This is expected. The dev CSP includes `'unsafe-eval'` because Vite's HMR
requires it to hot-reload React components. The warning itself notes it
does not appear in packaged builds, which use the strict CSP without
`'unsafe-eval'`. No action required.

Do not alter the CSP to silence this warning — doing so would break HMR.

---

## License

All rights reserved.
