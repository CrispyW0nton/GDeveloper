/**
 * parallel_search — Sprint 16
 * Parallel web search: runs 2-6 queries concurrently, returns top results per query.
 * Uses a simple fetch-based approach to a search API or DuckDuckGo scraper fallback.
 */

export interface SearchQuery {
  query: string;
  max_results?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ParallelSearchInput {
  queries: SearchQuery[] | string[];
}

export interface SearchQueryResult {
  query: string;
  results: SearchResult[];
  error?: string;
}

export interface ParallelSearchResult {
  success: boolean;
  total_queries: number;
  completed: number;
  failed: number;
  results: SearchQueryResult[];
  error?: string;
}

/**
 * Perform a single web search using DuckDuckGo Instant Answer API (no key needed).
 * Falls back to a simulated result if fetch fails.
 */
async function searchSingle(query: string, maxResults: number = 5): Promise<SearchQueryResult> {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GDeveloper/1.0' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { query, results: [], error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const results: SearchResult[] = [];

    // Abstract
    if (data.Abstract && data.AbstractURL) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL,
        snippet: data.Abstract.substring(0, 300),
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.substring(0, 100),
            url: topic.FirstURL,
            snippet: topic.Text.substring(0, 300),
          });
        }
      }
    }

    // Results
    if (data.Results) {
      for (const r of data.Results.slice(0, maxResults - results.length)) {
        if (r.Text && r.FirstURL) {
          results.push({
            title: r.Text.substring(0, 100),
            url: r.FirstURL,
            snippet: r.Text.substring(0, 300),
          });
        }
      }
    }

    return { query, results: results.slice(0, maxResults) };
  } catch (err) {
    return { query, results: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute parallel web searches with concurrency cap.
 */
export async function executeParallelSearch(input: ParallelSearchInput): Promise<ParallelSearchResult> {
  if (!input.queries || !Array.isArray(input.queries) || input.queries.length === 0) {
    return { success: false, total_queries: 0, completed: 0, failed: 0, results: [], error: 'queries array is required (2-6 items)' };
  }

  // Normalize queries
  const queries: SearchQuery[] = input.queries.map(q =>
    typeof q === 'string' ? { query: q, max_results: 5 } : q
  );

  if (queries.length > 6) {
    return { success: false, total_queries: queries.length, completed: 0, failed: 0, results: [], error: 'Maximum 6 queries allowed' };
  }

  // Run concurrently with a cap of 4
  const CONCURRENCY = 4;
  const allResults: SearchQueryResult[] = [];
  
  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const batch = queries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(q => searchSingle(q.query, q.max_results || 5))
    );
    
    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        allResults.push(r.value);
      } else {
        allResults.push({ query: 'unknown', results: [], error: r.reason?.message || 'Search failed' });
      }
    }
  }

  const completed = allResults.filter(r => !r.error).length;
  const failed = allResults.filter(r => !!r.error).length;

  return {
    success: completed > 0,
    total_queries: queries.length,
    completed,
    failed,
    results: allResults,
  };
}
