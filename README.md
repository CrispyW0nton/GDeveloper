# GDeveloper

AI coding assistant as a desktop app. Chat with Claude, and it reads, writes, and runs code in your local projects.

Built with Electron + React + TypeScript. Matrix theme by default.

---

## Setup (5 minutes)

### Step 1 — Install prerequisites

You need two things installed:

- **Node.js 18+** — [Download here](https://nodejs.org/) (pick the LTS version)
- **Git** — [Download here](https://git-scm.com/downloads)

To check if you already have them, open a terminal and run:

```bash
node --version
git --version
```

If both show version numbers, you're good. Move on.

### Step 2 — Clone the repo

```bash
git clone https://github.com/CrispyW0nton/GDeveloper.git
cd GDeveloper
```

### Step 3 — Install dependencies

```bash
npm install
```

This takes a minute or two. Wait for it to finish.

### Step 4 — Start the app

```bash
npm run dev
```

A desktop window opens. That's GDeveloper.

### Step 5 — Add your API key

1. The app opens to **Settings**.
2. Get a Claude API key from [console.anthropic.com](https://console.anthropic.com/).
3. Paste the key into the API Key field.
4. Click **Validate**.
5. Green checkmark = you're set.

### Step 6 — Open a project

1. Go to the **Workspaces** tab (left sidebar).
2. Pick one:
   - **Open Folder** — select an existing project on your computer.
   - **Clone** — paste a GitHub URL and clone it.
   - **Scan** — auto-find Git repos on your machine.

### Step 7 — Start building

1. Go to the **Chat** tab.
2. Type what you want to build, fix, or change.
3. Claude reads your files, writes code, runs commands, and commits — right from the chat.

That's it. You're running.

---

## What GDeveloper does

It's a desktop app that gives Claude AI direct access to your codebase. You chat, it codes.

**Claude can:**
- Read and search your files
- Write new files or edit existing ones
- Run terminal commands
- Make git commits, push, pull, check status
- Research and analyze repos

**You get:**
- A chat interface with tool-use visibility (you see what Claude does)
- Built-in terminal (Ctrl+\` to toggle)
- Git toolbar for quick actions
- Plan mode (read-only research) and Build mode (full access)
- Theme customization studio with presets and backdrops
- Slash commands for common tasks
- MCP server support for 300+ extra tools
- GitHub OAuth integration
- SQLite-backed chat history and activity logs

---

## Slash commands

Type `/` in the chat input to see all commands. Here are the main ones:

| Command | What it does |
|---------|-------------|
| `/commit [message]` | Stage and commit. Skip the message for an AI-generated one. |
| `/push` | Push current branch to remote. |
| `/diff` | Show git diff in chat. |
| `/undo` | Soft reset last commit. |
| `/status` | Show branch info and file counts. |
| `/plan` | Switch to Plan mode (read-only, no writes). |
| `/build` | Switch to Build mode (full tool access). |
| `/tools` | List all available tools. |
| `/clear` | Clear chat display. |
| `/research <question>` | Run a deep research workflow. |
| `/compare-repos <path1> <path2>` | Compare two repos side by side. |

---

## Modes

- **Plan mode** — Claude can only read and search. Use this when you want analysis without changes.
- **Build mode** — Claude has full access to read, write, run commands, and commit. This is the default.

Switch with `/plan` and `/build`, or use the mode toggle in the header.

---

## Theme customization

Open **Settings > Theme Customization Studio** to:

- Edit colors for background, text, accents, borders, panels, terminal, overlays
- Adjust opacity for overlays and backdrops
- Pick a backdrop (Matrix rain, puddles animation, animated gradient, static noise, or none)
- Toggle Matrix rain on/off independently
- Save custom theme presets with names
- Duplicate, overwrite, or delete presets
- Live preview before applying
- Reset to Matrix default at any time

The Matrix theme is the default and can't be deleted. Your custom presets persist across restarts.

---

## Terminal

Press **Ctrl+\`** (backtick) to toggle the bottom terminal panel.

- Runs in your workspace directory
- Multiple tabs
- Auto-detects your shell
- Drag the top edge to resize

---

## Build for production

```bash
npm run build
npm run package
```

This creates a distributable installer.

---

## Tech stack

| | |
|--|--|
| Desktop | Electron 31 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS |
| Build tool | electron-vite |
| Database | SQLite (better-sqlite3) |
| AI | Claude via Anthropic API |
| Git | simple-git |
| MCP | @modelcontextprotocol/sdk |
| GitHub | Octokit |

---

## Project structure

```
src/
  main/               Electron main process
    commands/          Slash commands
    db/                SQLite database
    discovery/         Repo scanning
    environment/       Stack detection, Python env profiles
    migration/         Workspace migration
    research/          Deep research workflows
    providers/         Claude API provider
    tools/             Built-in coding tools
    mcp/               MCP server manager
    github/            GitHub OAuth
    orchestration/     System prompts
    security/          Encrypted settings
  preload/             IPC bridge
  renderer/            React UI
    components/
      chat/            Chat interface
      common/          Sidebar, Matrix rain, panels
      terminal/        Terminal panel
      workspace/       Workspace management, git toolbar
      github/          GitHub connection
      mcp/             MCP server management
      tasks/           Task ledger
      diff/            Diff viewer
      activity/        Activity log
      settings/        Settings + Theme Customization Studio
      background/      Backdrop renderer
    themes/            Token model, presets, theme context
    store/             App state
```

---

## License

All rights reserved.
