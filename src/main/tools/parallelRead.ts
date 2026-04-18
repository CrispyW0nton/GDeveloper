/**
 * parallel_read — Sprint 16
 * Parallel URL-read tool: fetches content from multiple URLs concurrently.
 * Optionally answers per-URL questions using content extraction.
 *
 * Sprint 36 Fix 4: Also handles file:// URIs and workspace-relative paths.
 * On Windows, file:// URIs are converted using fileURLToPath from 'url'.
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { resolve, isAbsolute } from 'path';

export interface ReadTarget {
  url: string;
  question?: string;
}

export interface ParallelReadInput {
  urls: (ReadTarget | string)[];
}

export interface ReadResult {
  url: string;
  status: 'success' | 'error';
  content: string;
  title?: string;
  word_count?: number;
  question?: string;
  answer?: string;
  error?: string;
}

export interface ParallelReadResult {
  success: boolean;
  total_urls: number;
  completed: number;
  failed: number;
  results: ReadResult[];
  error?: string;
}

/**
 * Extract a rough text title from HTML.
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim().substring(0, 200) : '';
}

/**
 * Extract readable text from HTML (very simple — strip tags).
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sprint 36 Fix 4: Read a local file path (absolute or workspace-relative).
 * Handles file:// URIs cross-platform via fileURLToPath.
 */
async function readLocalFile(target: ReadTarget, workspacePath?: string): Promise<ReadResult> {
  const { url, question } = target;
  try {
    let filePath: string;
    if (url.startsWith('file://')) {
      filePath = fileURLToPath(url);
    } else if (isAbsolute(url)) {
      filePath = url;
    } else {
      // Workspace-relative path
      const base = workspacePath || process.cwd();
      filePath = resolve(base, url);
    }

    const rawText = await readFile(filePath, 'utf-8');
    const content = rawText.substring(0, 50000);
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    // Simple question answering
    let answer: string | undefined;
    if (question && content) {
      const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const paragraphs = content.split(/\n\n+/).filter(p => p.length > 30);
      const scored = paragraphs.map(p => {
        const pLower = p.toLowerCase();
        const score = keywords.filter(k => pLower.includes(k)).length;
        return { text: p, score };
      }).sort((a, b) => b.score - a.score);
      if (scored.length > 0 && scored[0].score > 0) {
        answer = scored.slice(0, 3).map(s => s.text.trim()).join('\n\n').substring(0, 2000);
      } else {
        answer = content.substring(0, 500) + '...';
      }
    }

    return {
      url,
      status: 'success',
      content: content.substring(0, 10000),
      title: filePath,
      word_count: wordCount,
      question,
      answer,
    };
  } catch (err) {
    return { url, status: 'error', content: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Determine if a target URL refers to a local path.
 */
function isLocalPath(url: string): boolean {
  if (url.startsWith('file://')) return true;
  if (isAbsolute(url)) return true;
  // Workspace-relative paths: don't start with http(s)://
  if (!url.startsWith('http://') && !url.startsWith('https://')) return true;
  return false;
}

/**
 * Fetch a single URL and extract content.
 */
async function readSingle(target: ReadTarget, workspacePath?: string): Promise<ReadResult> {
  // Sprint 36 Fix 4: Route local paths to file reader
  if (isLocalPath(target.url)) {
    return readLocalFile(target, workspacePath);
  }

  const { url, question } = target;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GDeveloper/1.0 (Electron)',
        'Accept': 'text/html, text/plain, application/json, */*',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { url, status: 'error', content: '', error: `HTTP ${response.status} ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    
    let content: string;
    let title: string | undefined;

    if (contentType.includes('json')) {
      content = rawText.substring(0, 50000);
    } else if (contentType.includes('html')) {
      title = extractTitle(rawText);
      content = htmlToText(rawText).substring(0, 50000);
    } else {
      content = rawText.substring(0, 50000);
    }

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    // Simple question answering by finding relevant paragraph
    let answer: string | undefined;
    if (question && content) {
      const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const paragraphs = content.split(/\.\s+/).filter(p => p.length > 30);
      const scored = paragraphs.map(p => {
        const pLower = p.toLowerCase();
        const score = keywords.filter(k => pLower.includes(k)).length;
        return { text: p, score };
      }).sort((a, b) => b.score - a.score);

      if (scored.length > 0 && scored[0].score > 0) {
        answer = scored.slice(0, 3).map(s => s.text.trim()).join('. ').substring(0, 2000);
      } else {
        answer = content.substring(0, 500) + '...';
      }
    }

    return {
      url,
      status: 'success',
      content: content.substring(0, 10000), // Truncate for display
      title,
      word_count: wordCount,
      question,
      answer,
    };
  } catch (err) {
    return { url, status: 'error', content: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute parallel URL reads with concurrency cap.
 * Sprint 36: Added optional workspacePath for resolving relative paths.
 */
export async function executeParallelRead(input: ParallelReadInput, workspacePath?: string): Promise<ParallelReadResult> {
  if (!input.urls || !Array.isArray(input.urls) || input.urls.length === 0) {
    return { success: false, total_urls: 0, completed: 0, failed: 0, results: [], error: 'urls array is required' };
  }

  // Normalize targets
  const targets: ReadTarget[] = input.urls.map(u =>
    typeof u === 'string' ? { url: u } : u
  );

  if (targets.length > 10) {
    return { success: false, total_urls: targets.length, completed: 0, failed: 0, results: [], error: 'Maximum 10 URLs allowed' };
  }

  // Concurrent fetch with cap of 4
  const CONCURRENCY = 4;
  const allResults: ReadResult[] = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(t => readSingle(t, workspacePath)));

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        allResults.push(r.value);
      } else {
        allResults.push({ url: 'unknown', status: 'error', content: '', error: r.reason?.message || 'Fetch failed' });
      }
    }
  }

  const completed = allResults.filter(r => r.status === 'success').length;
  const failed = allResults.filter(r => r.status === 'error').length;

  return {
    success: completed > 0,
    total_urls: targets.length,
    completed,
    failed,
    results: allResults,
  };
}
