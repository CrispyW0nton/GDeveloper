import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';

export const PROJECT_RULE_FILENAMES = [
  'AGENTS.md',
  '.gdrules',
  '.cursorrules',
  '.clinerules',
];

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
  'dist-electron',
  'dist-renderer',
  'dist-package',
  '.venv',
  'venv',
  '__pycache__',
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
]);

const SYMBOL_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.cpp',
  '.c',
  '.h',
  '.hpp',
]);

const CONFIG_FILENAMES = new Set([
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'electron.vite.config.ts',
  'README.md',
  'BUILDING.md',
  'Dockerfile',
  'docker-compose.yml',
]);

const MAX_FILE_SIZE = 256 * 1024;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_RULE_CHARS = 16000;
const DEFAULT_MAX_PROMPT_CHARS = 14000;
const DEFAULT_MAX_CHUNKS = 6;
const DEFAULT_CHUNK_LINES = 80;
const DEFAULT_CHUNK_OVERLAP = 10;
const DEFAULT_MAX_RAG_CHARS = 10000;

export interface ProjectRuleFile {
  filename: string;
  path: string;
  content: string;
  truncated: boolean;
}

export interface RepoMapEntry {
  path: string;
  language: string;
  symbols: string[];
  imports: string[];
  score: number;
}

export interface RepoMap {
  root: string;
  scannedFiles: number;
  includedFiles: number;
  generatedAt: string;
  entries: RepoMapEntry[];
}

export interface CodeChunk {
  id: string;
  path: string;
  language: string;
  startLine: number;
  endLine: number;
  symbols: string[];
  imports: string[];
  text: string;
}

export interface RelevantCodeChunk extends CodeChunk {
  score: number;
  matchedTerms: string[];
}

export interface ProjectContext {
  rules: ProjectRuleFile[];
  repoMap: RepoMap;
}

export interface ProjectContextOptions {
  maxFiles?: number;
  maxDepth?: number;
  maxRuleChars?: number;
  maxPromptChars?: number;
  maxChunks?: number;
  chunkLines?: number;
  chunkOverlap?: number;
  maxRagChars?: number;
}

export function loadProjectRuleFiles(workspacePath: string, maxRuleChars = DEFAULT_MAX_RULE_CHARS): ProjectRuleFile[] {
  const root = resolve(workspacePath);
  const rules: ProjectRuleFile[] = [];

  for (const filename of PROJECT_RULE_FILENAMES) {
    const absolutePath = resolve(root, filename);
    if (!absolutePath.startsWith(root) || !existsSync(absolutePath)) continue;

    try {
      const stat = statSync(absolutePath);
      if (!stat.isFile()) continue;
      const raw = readFileSync(absolutePath, 'utf-8');
      const truncated = raw.length > maxRuleChars;
      rules.push({
        filename,
        path: relative(root, absolutePath),
        content: truncated ? raw.slice(0, maxRuleChars) : raw,
        truncated,
      });
    } catch {
      // Project rules are advisory context; unreadable files should not block chat.
    }
  }

  return rules;
}

export function buildRepoMap(workspacePath: string, options: ProjectContextOptions = {}): RepoMap {
  const root = resolve(workspacePath);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const entries: RepoMapEntry[] = [];
  let scannedFiles = 0;

  function walk(dirPath: string, depth: number): void {
    if (depth > maxDepth || scannedFiles >= maxFiles) return;

    let dirEntries: string[];
    try {
      dirEntries = readdirSync(dirPath);
    } catch {
      return;
    }

    for (const name of dirEntries.sort((a, b) => a.localeCompare(b))) {
      if (scannedFiles >= maxFiles) break;
      if (IGNORED_DIRS.has(name)) continue;

      const fullPath = join(dirPath, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_SIZE) continue;
      if (IGNORED_FILES.has(name)) continue;

      scannedFiles++;
      const relPath = normalizePath(relative(root, fullPath));
      const ext = extname(name).toLowerCase();
      const base = basename(name);
      const isConfig = CONFIG_FILENAMES.has(base);
      if (!SYMBOL_EXTENSIONS.has(ext) && !isConfig) continue;

      let content = '';
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const symbols = extractSymbols(relPath, content).slice(0, 12);
      const imports = extractImports(content).slice(0, 8);
      if (symbols.length === 0 && !isConfig) continue;

      entries.push({
        path: relPath,
        language: languageForExtension(ext, base),
        symbols,
        imports,
        score: scoreRepoMapEntry(relPath, symbols, isConfig),
      });
    }
  }

  walk(root, 0);

  entries.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  return {
    root,
    scannedFiles,
    includedFiles: entries.length,
    generatedAt: new Date().toISOString(),
    entries,
  };
}

export function buildProjectContext(workspacePath: string, options: ProjectContextOptions = {}): ProjectContext {
  return {
    rules: loadProjectRuleFiles(workspacePath, options.maxRuleChars),
    repoMap: buildRepoMap(workspacePath, options),
  };
}

export function buildCodeChunks(workspacePath: string, options: ProjectContextOptions = {}): CodeChunk[] {
  const root = resolve(workspacePath);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const chunkLines = options.chunkLines ?? DEFAULT_CHUNK_LINES;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const chunks: CodeChunk[] = [];
  let scannedFiles = 0;

  function walk(dirPath: string, depth: number): void {
    if (depth > maxDepth || scannedFiles >= maxFiles) return;

    let dirEntries: string[];
    try {
      dirEntries = readdirSync(dirPath);
    } catch {
      return;
    }

    for (const name of dirEntries.sort((a, b) => a.localeCompare(b))) {
      if (scannedFiles >= maxFiles) break;
      if (IGNORED_DIRS.has(name)) continue;

      const fullPath = join(dirPath, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_SIZE) continue;
      if (IGNORED_FILES.has(name)) continue;

      const ext = extname(name).toLowerCase();
      if (!SYMBOL_EXTENSIONS.has(ext)) continue;
      scannedFiles++;

      let content = '';
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const relPath = normalizePath(relative(root, fullPath));
      const language = languageForExtension(ext, basename(name));
      const fileSymbols = extractSymbols(relPath, content).slice(0, 20);
      const fileImports = extractImports(content).slice(0, 12);
      const lines = content.split(/\r?\n/);
      const step = Math.max(1, chunkLines - chunkOverlap);

      for (let start = 0; start < lines.length; start += step) {
        const endExclusive = Math.min(lines.length, start + chunkLines);
        const text = lines.slice(start, endExclusive).join('\n').trim();
        if (!text) continue;

        const startLine = start + 1;
        const endLine = endExclusive;
        chunks.push({
          id: `${relPath}:${startLine}-${endLine}`,
          path: relPath,
          language,
          startLine,
          endLine,
          symbols: fileSymbols,
          imports: fileImports,
          text,
        });

        if (endExclusive >= lines.length) break;
      }
    }
  }

  walk(root, 0);
  return chunks;
}

export function retrieveRelevantCodeChunks(
  workspacePath: string,
  query: string,
  options: ProjectContextOptions = {}
): RelevantCodeChunk[] {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return [];

  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const chunks = buildCodeChunks(workspacePath, options);
  const scored: RelevantCodeChunk[] = [];

  for (const chunk of chunks) {
    const haystack = [
      chunk.path,
      chunk.language,
      chunk.symbols.join(' '),
      chunk.imports.join(' '),
      chunk.text,
    ].join('\n').toLowerCase();

    let score = 0;
    const matchedTerms: string[] = [];
    for (const term of terms) {
      const pathBoost = chunk.path.toLowerCase().includes(term) ? 8 : 0;
      const symbolBoost = chunk.symbols.some(symbol => symbol.toLowerCase().includes(term)) ? 10 : 0;
      const importBoost = chunk.imports.some(specifier => specifier.toLowerCase().includes(term)) ? 4 : 0;
      const occurrences = countOccurrences(haystack, term);
      if (occurrences > 0 || pathBoost || symbolBoost || importBoost) {
        matchedTerms.push(term);
        score += occurrences + pathBoost + symbolBoost + importBoost;
      }
    }

    if (score > 0) {
      scored.push({ ...chunk, score, matchedTerms });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine);
  return scored.slice(0, maxChunks);
}

export function formatProjectRulesForPrompt(rules: ProjectRuleFile[]): string {
  if (rules.length === 0) return '';

  const sections = rules.map(rule => {
    const suffix = rule.truncated ? '\n[truncated]' : '';
    return `### ${rule.path}\n${rule.content.trim()}${suffix}`;
  });

  return [
    '## Persistent Project Rules',
    `Loaded ${rules.length} rule file(s): ${rules.map(r => r.path).join(', ')}.`,
    'Treat these as workspace-specific operating instructions. If they conflict with higher-priority system or safety rules, follow the higher-priority rule and explain the conflict briefly.',
    sections.join('\n\n'),
  ].join('\n');
}

export function formatRepoMapForPrompt(repoMap: RepoMap, maxPromptChars = DEFAULT_MAX_PROMPT_CHARS): string {
  if (repoMap.entries.length === 0) return '';

  const lines = [
    '## Repo Map v1',
    `Scanned ${repoMap.scannedFiles} file(s); selected ${repoMap.includedFiles} symbol-bearing/config file(s). Use this as a navigation map before opening files.`,
  ];

  for (const entry of repoMap.entries) {
    const symbols = entry.symbols.length > 0 ? entry.symbols.join(', ') : '(config/root file)';
    const imports = entry.imports.length > 0 ? ` | imports: ${entry.imports.join(', ')}` : '';
    lines.push(`- ${entry.path} [${entry.language}]: ${symbols}${imports}`);

    if (lines.join('\n').length >= maxPromptChars) {
      lines.push('- ...repo map truncated for prompt budget');
      break;
    }
  }

  return lines.join('\n');
}

export function formatProjectContextForPrompt(context: ProjectContext, options: ProjectContextOptions = {}): string {
  const sections = [
    formatProjectRulesForPrompt(context.rules),
    formatRepoMapForPrompt(context.repoMap, options.maxPromptChars),
  ].filter(Boolean);

  return sections.join('\n\n');
}

export function formatRelevantCodeChunksForPrompt(
  chunks: RelevantCodeChunk[],
  maxChars = DEFAULT_MAX_RAG_CHARS
): string {
  if (chunks.length === 0) return '';

  const lines = [
    '## Relevant Code Context',
    `Retrieved ${chunks.length} chunk(s) for the current request. Use these snippets as starting evidence, then open files before editing.`,
  ];

  for (const chunk of chunks) {
    const header = `### ${chunk.path}:${chunk.startLine}-${chunk.endLine} [${chunk.language}] score=${chunk.score} matches=${chunk.matchedTerms.join(', ')}`;
    const body = trimChunkText(chunk.text, 1600);
    lines.push(`${header}\n\`\`\`${chunk.language}\n${body}\n\`\`\``);

    if (lines.join('\n').length >= maxChars) {
      lines.push('...relevant code context truncated for prompt budget');
      break;
    }
  }

  return lines.join('\n\n');
}

function extractSymbols(path: string, content: string): string[] {
  const ext = extname(path).toLowerCase();
  const symbols = new Set<string>();

  const patterns: RegExp[] = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    patterns.push(
      /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+const\s+([A-Za-z_$][\w$]*)/g,
      /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /\bclass\s+([A-Za-z_$][\w$]*)/g
    );
  } else if (ext === '.py') {
    patterns.push(/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm, /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/gm);
  } else if (ext === '.go') {
    patterns.push(/\bfunc\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/g, /\btype\s+([A-Za-z_]\w*)\s+(?:struct|interface)/g);
  } else if (ext === '.rs') {
    patterns.push(/\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/g, /\b(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g);
  } else if (['.java', '.cs', '.cpp', '.c', '.h', '.hpp'].includes(ext)) {
    patterns.push(/\b(?:class|interface|struct|enum)\s+([A-Za-z_]\w*)/g);
  }

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) symbols.add(match[1]);
      if (symbols.size >= 20) break;
    }
  }

  return Array.from(symbols);
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*from\s+([A-Za-z0-9_./-]+)\s+import\s+/gm,
    /^\s*import\s+([A-Za-z0-9_./-]+)/gm,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) imports.add(match[1]);
      if (imports.size >= 12) break;
    }
  }

  return Array.from(imports);
}

function scoreRepoMapEntry(path: string, symbols: string[], isConfig: boolean): number {
  let score = symbols.length * 3;
  if (isConfig) score += 18;
  if (path.startsWith('src/')) score += 12;
  if (path.includes('/orchestration/') || path.includes('/providers/') || path.includes('/tools/')) score += 8;
  if (path.includes('/test') || path.startsWith('tests/')) score += 4;
  if (basename(path).toLowerCase().includes('index')) score += 3;
  return score;
}

function languageForExtension(ext: string, base: string): string {
  if (CONFIG_FILENAMES.has(base)) return 'config';
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c-header',
    '.hpp': 'cpp-header',
  };
  return map[ext] || 'text';
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function tokenizeQuery(query: string): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto',
    'what', 'when', 'where', 'which', 'while', 'about', 'please', 'would',
    'could', 'should', 'need', 'needs', 'make', 'build', 'fix', 'add',
    'update', 'change', 'continue', 'development', 'phase', 'roadmap',
  ]);

  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .map(term => term.trim())
      .filter(term => term.length >= 3 && !stopWords.has(term))
  )).slice(0, 24);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function trimChunkText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + '\n// ...chunk truncated';
}
