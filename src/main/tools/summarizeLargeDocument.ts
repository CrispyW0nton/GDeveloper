/**
 * summarize_large_document — Sprint 16
 * Answers specific questions from a long document/URL.
 * Fetches the document, extracts relevant sections, returns structured answer with citations.
 */

export interface SummarizeInput {
  url: string;
  question: string;
}

export interface SummarizeResult {
  success: boolean;
  url: string;
  question: string;
  answer: string;
  relevant_sections: string[];
  word_count: number;
  error?: string;
}

/**
 * Simple HTML to text conversion.
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
 * Split text into paragraphs/sections for retrieval.
 */
function splitIntoSections(text: string, maxSectionLen: number = 1000): string[] {
  const rawParagraphs = text.split(/\n\n+|\.\s{2,}/);
  const sections: string[] = [];
  let buffer = '';

  for (const p of rawParagraphs) {
    const trimmed = p.trim();
    if (!trimmed || trimmed.length < 10) continue;

    if (buffer.length + trimmed.length > maxSectionLen && buffer.length > 50) {
      sections.push(buffer.trim());
      buffer = trimmed;
    } else {
      buffer += (buffer ? '. ' : '') + trimmed;
    }
  }
  if (buffer.trim().length > 10) {
    sections.push(buffer.trim());
  }

  return sections;
}

/**
 * Score sections against the question using keyword overlap.
 */
function scoreSection(section: string, keywords: string[]): number {
  const lower = section.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      score += 1;
      // Bonus for multiple occurrences
      const matches = lower.split(kw).length - 1;
      score += Math.min(matches - 1, 3) * 0.5;
    }
  }
  // Bonus for length (longer sections with matches are likely more informative)
  if (score > 0) {
    score += Math.min(section.length / 5000, 1);
  }
  return score;
}

/**
 * Execute summarize_large_document: fetch URL, extract relevant sections, answer question.
 */
export async function executeSummarizeLargeDocument(input: SummarizeInput): Promise<SummarizeResult> {
  const { url, question } = input;

  if (!url) {
    return { success: false, url: '', question, answer: '', relevant_sections: [], word_count: 0, error: 'url is required' };
  }
  if (!question) {
    return { success: false, url, question: '', answer: '', relevant_sections: [], word_count: 0, error: 'question is required' };
  }

  try {
    // Fetch the document
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GDeveloper/1.0 (Electron)',
        'Accept': 'text/html, text/plain, application/json, application/pdf, */*',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false, url, question, answer: '', relevant_sections: [],
        word_count: 0, error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    let text: string;
    if (contentType.includes('html')) {
      text = htmlToText(rawText);
    } else {
      text = rawText;
    }

    // Truncate extremely large documents
    if (text.length > 500000) {
      text = text.substring(0, 500000);
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // Split into sections
    const sections = splitIntoSections(text);

    // Extract keywords from question
    const stopWords = new Set(['the', 'is', 'at', 'in', 'of', 'and', 'or', 'to', 'a', 'an', 'for', 'on', 'with', 'as', 'by', 'from', 'that', 'this', 'what', 'how', 'why', 'when', 'where', 'which', 'who', 'are', 'was', 'were', 'been', 'has', 'have', 'had', 'do', 'does', 'did']);
    const keywords = question.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);

    // Score and rank sections
    const scored = sections.map(s => ({
      text: s,
      score: scoreSection(s, keywords),
    })).sort((a, b) => b.score - a.score);

    // Take top relevant sections
    const topSections = scored.filter(s => s.score > 0).slice(0, 5);
    const relevantSections = topSections.map(s => s.text);

    // Build answer from relevant sections
    let answer: string;
    if (relevantSections.length > 0) {
      answer = `Based on the document at ${url} (${wordCount.toLocaleString()} words):\n\n` +
        relevantSections.map((s, i) => `[${i + 1}] ${s}`).join('\n\n');
    } else {
      // Fall back to first portion of document
      const firstContent = text.substring(0, 3000);
      answer = `No sections closely matching "${question}" were found. Document overview (${wordCount.toLocaleString()} words):\n\n${firstContent}...`;
      relevantSections.push(firstContent);
    }

    return {
      success: true,
      url,
      question,
      answer: answer.substring(0, 20000),
      relevant_sections: relevantSections.map(s => s.substring(0, 2000)),
      word_count: wordCount,
    };
  } catch (err) {
    return {
      success: false, url, question, answer: '', relevant_sections: [],
      word_count: 0, error: err instanceof Error ? err.message : String(err),
    };
  }
}
