import { edgeCache } from "@/lib/edge-cache";
import { encodeContent } from "@/lib/encoding";
import { Category, CustomFeed, CustomItem, JSONFeed } from "@/lib/types";
import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "content"],
      ["dc:creator", "creator"],
    ],
  },
});

const GENERATOR = "rssrssrssrss";
const FEED_TITLE = "Merged Feed";
// Not registered with Cloudflare yet, but hnrss.org returns a 429 if we don't provide any UA.
const USER_AGENT = "rssrssrssrss (https://rssrssrssrss.com)";
// A Worker can have six connections waiting for response headers, and queues
// the rest. Cache API calls count too, so keep one connection free for them.
const MAX_CONCURRENT_FETCHES = 5;
// Each upstream fetch gets this long once it has a connection.
const FETCH_TIMEOUT_MS = 10000;
// All feeds in a merge must load by then. A refresh in waitUntil is canceled
// 30 seconds after the response, so leave room to build and cache the merge.
const MERGE_DEADLINE_MS = 20000;
// Share each upstream feed across merged feeds for FEED_FRESH_SECONDS, and
// keep it for FEED_STALE_SECONDS more in case the feed fails to load later.
const FEED_FRESH_SECONDS = 600;
const FEED_STALE_SECONDS = 7 * 86400;
const CACHED_AT = "X-Cached-At";

/**
 * Try to discover RSS/Atom feed URLs from an HTML page by looking for
 * <link rel="alternate"> tags with feed content types.
 */
export function discoverFeedFromHtml(
  html: string,
  contentType: string,
  url: string,
): string | null {
  try {
    // Only try to discover feeds from HTML pages
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }

    // Look for <link rel="alternate" type="application/rss+xml" href="...">
    // or <link rel="alternate" type="application/atom+xml" href="...">
    // or <link rel="alternate" type="application/feed+json" href="...">
    const feedLinkRegex = /<link[^>]*rel=["']alternate["'][^>]*>/gi;
    const matches = html.match(feedLinkRegex);

    if (!matches) {
      return null;
    }

    for (const linkTag of matches) {
      const typeMatch = linkTag.match(/type=["']([^"']+)["']/i);
      const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);

      if (!typeMatch || !hrefMatch) {
        continue;
      }

      const type = typeMatch[1].toLowerCase();
      const href = hrefMatch[1];

      // Check if it's a feed type
      if (
        type.includes("application/rss+xml") ||
        type.includes("application/atom+xml") ||
        type.includes("application/feed+json") ||
        type.includes("application/json")
      ) {
        // Handle relative URLs
        if (href.startsWith("http://") || href.startsWith("https://")) {
          return href;
        } else if (href.startsWith("//")) {
          // Protocol-relative URL
          const baseUrl = new URL(url);
          return `${baseUrl.protocol}${href}`;
        } else if (href.startsWith("/")) {
          // Absolute path
          const baseUrl = new URL(url);
          return `${baseUrl.origin}${href}`;
        } else {
          // Relative path
          const baseUrl = new URL(url);
          const pathParts = baseUrl.pathname.split("/");
          pathParts.pop(); // Remove the current page
          return `${baseUrl.origin}${pathParts.join("/")}/${href}`;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// rss-parser's parseURL decodes latin1 when the server says so, and utf8 otherwise.
function decodeXml(body: Buffer, contentType: string): string {
  const charset = contentType
    .match(/(encoding|charset)\s*=\s*(\S+)/)?.[2]
    .toLowerCase();
  return body.toString(
    charset === "iso-8859-1" || charset === "latin1" ? "latin1" : "utf8",
  );
}

type FetchedFeed = { response: Response; body: Buffer };

export type FetchOptions = {
  concurrency?: number;
  fetchTimeoutMs?: number;
  deadlineMs?: number;
};

// Shared by every fetch in one merge.
type FetchSession = {
  limit: <T>(task: () => Promise<T>) => Promise<T>;
  fetchTimeoutMs: number;
  deadline: number;
};

// Run at most `max` tasks at once, in the order they were queued.
export function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active < max) {
      active++;
    } else {
      // A finishing task hands its slot straight to us.
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    }
  };
}

function createSession(options: FetchOptions = {}): FetchSession {
  return {
    limit: createLimiter(options.concurrency ?? MAX_CONCURRENT_FETCHES),
    fetchTimeoutMs: options.fetchTimeoutMs ?? FETCH_TIMEOUT_MS,
    deadline: Date.now() + (options.deadlineMs ?? MERGE_DEADLINE_MS),
  };
}

function timeoutError(): Error {
  return Object.assign(new Error("Request timed out"), {
    name: "TimeoutError",
  });
}

// Workers do not apply the abort signal to a slow response body, so also race a timer.
async function withDeadline<T>(
  promise: Promise<T>,
  deadline: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(timeoutError()),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a feed from its server. The timeout starts once a connection is free,
// so feeds queued behind slow servers do not time out while they wait.
async function fetchUpstream(
  url: string,
  session: FetchSession,
): Promise<FetchedFeed> {
  let deadline = session.deadline;
  const response = await session.limit(() => {
    deadline = Math.min(Date.now() + session.fetchTimeoutMs, session.deadline);
    if (deadline <= Date.now()) {
      return Promise.reject(timeoutError());
    }
    return withDeadline(
      fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "application/feed+json, application/json, application/rss+xml, application/atom+xml, text/html, */*",
        },
        signal: AbortSignal.timeout(deadline - Date.now()),
      }),
      deadline,
    );
  });
  const body = Buffer.from(
    await withDeadline(response.arrayBuffer(), deadline),
  );
  return { response, body };
}

async function readCached(response: Response): Promise<FetchedFeed> {
  return { response, body: Buffer.from(await response.arrayBuffer()) };
}

// Serve each upstream feed from the edge cache while it is fresh. Once it is
// stale, fetch it again, but fall back to the stale copy if that fails, so one
// slow or flaky server does not put an error item in every merged feed.
async function fetchWithEdgeCache(
  url: string,
  session: FetchSession,
): Promise<FetchedFeed> {
  const cache = edgeCache();
  const cached = await cache?.match(url);
  if (!cache || !cached) {
    const fetched = await fetchUpstream(url, session);
    if (cache && fetched.response.ok) {
      await putInCache(cache, url, fetched);
    }
    return fetched;
  }

  const age = (Date.now() - Number(cached.headers.get(CACHED_AT))) / 1000;
  if (age <= FEED_FRESH_SECONDS) {
    return readCached(cached);
  }

  try {
    const fetched = await fetchUpstream(url, session);
    if (fetched.response.ok) {
      await cached.body?.cancel();
      await putInCache(cache, url, fetched);
      return fetched;
    }
    console.warn(
      `Serving stale copy of ${url}: status ${fetched.response.status}`,
    );
  } catch (error) {
    console.warn(`Serving stale copy of ${url}:`, error);
  }
  return readCached(cached);
}

async function putInCache(cache: Cache, url: string, fetched: FetchedFeed) {
  const copy = new Response(new Uint8Array(fetched.body), fetched.response);
  copy.headers.delete("Set-Cookie");
  copy.headers.set(
    "Cache-Control",
    `public, s-maxage=${FEED_FRESH_SECONDS + FEED_STALE_SECONDS}`,
  );
  copy.headers.set(CACHED_AT, String(Date.now()));
  await cache.put(url, copy);
}

/**
 * Fetch and parse several feeds, sharing one connection limit and deadline.
 */
export async function parseFeedsFromUrls(
  urls: string[],
  options?: FetchOptions,
): Promise<
  Array<{ feed: CustomFeed | null; error: string | null; url: string }>
> {
  const session = createSession(options);
  return Promise.all(
    urls.map(async (url) => ({
      ...(await parseFeedFromUrl(url, true, session)),
      url,
    })),
  );
}

/**
 * Parse a feed from a URL (RSS or JSON Feed) with a single fetch.
 * If the URL is not a feed, try to discover a feed from the HTML page.
 */
export async function parseFeedFromUrl(
  url: string,
  allowDiscovery = true,
  session: FetchSession = createSession(),
): Promise<{
  feed: CustomFeed | null;
  error: string | null;
}> {
  let response: Response;
  let body: Buffer;
  try {
    ({ response, body } = await fetchWithEdgeCache(url, session));
  } catch (error) {
    console.error(`Error fetching feed from ${url}:`, error);
    if (error instanceof Error && error.name === "TimeoutError") {
      return { feed: null, error: "Request timed out" };
    }
    // undici wraps network errors as "fetch failed"; the cause has the useful message.
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;
    return {
      feed: null,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }

  const contentType = response.headers.get("content-type") || "";
  const text = new TextDecoder().decode(body);

  if (
    contentType.includes("application/feed+json") ||
    contentType.includes("application/json")
  ) {
    const { feed } = await parseFeedFromJsonFeed(text, url);
    if (feed) {
      return { feed, error: null };
    }
  }

  const result =
    response.status >= 300
      ? { feed: null, error: `Status code ${response.status}` }
      : await parseFeedFromXml(decodeXml(body, contentType), url);
  if (result.feed || !allowDiscovery) {
    return result;
  }

  const discoveredFeedUrl = discoverFeedFromHtml(text, contentType, url);
  if (discoveredFeedUrl) {
    return parseFeedFromUrl(discoveredFeedUrl, false, session);
  }
  return result;
}

/**
 * Parse a feed from an XML string (RSS)
 */
export async function parseFeedFromXml(
  xml: string,
  sourceUrl?: string,
): Promise<{
  feed: CustomFeed | null;
  error: string | null;
}> {
  try {
    const feed = await parser.parseString(xml);
    return {
      feed: {
        ...feed,
        items: feed.items.map((item: CustomItem) => ({
          ...item,
          sourceFeedTitle: feed.title,
          sourceFeedUrl: sourceUrl,
        })),
      },
      error: null,
    };
  } catch (error) {
    console.error(`Error parsing feed XML:`, error);
    return {
      feed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse a feed from a JSON Feed string
 */
export async function parseFeedFromJsonFeed(
  jsonFeedString: string,
  sourceUrl?: string,
): Promise<{
  feed: CustomFeed | null;
  error: string | null;
}> {
  try {
    const jsonFeed: JSONFeed = JSON.parse(jsonFeedString);

    if (!jsonFeed.version || !jsonFeed.version.includes("jsonfeed.org")) {
      return {
        feed: null,
        error: "Invalid JSON Feed: missing or invalid version",
      };
    }

    // Convert JSON Feed items to CustomItem format
    const items: CustomItem[] = jsonFeed.items.map((item) => ({
      title: item.title,
      link: item.url || item.external_url,
      pubDate: item.date_published,
      content: item.content_html,
      contentSnippet: item.content_text || item.summary,
      creator: item.author?.name,
      isoDate: item.date_published,
      guid: item.id,
      categories: item.tags,
      sourceFeedTitle: jsonFeed.title,
      sourceFeedUrl: sourceUrl,
    }));

    return {
      feed: {
        title: jsonFeed.title,
        description: jsonFeed.description,
        link: jsonFeed.home_page_url,
        items,
      },
      error: null,
    };
  } catch (error) {
    console.error(`Error parsing JSON Feed:`, error);
    return {
      feed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Merge multiple feeds into a single feed
 */
export function mergeFeeds(
  results: Array<{
    feed: CustomFeed | null;
    error: string | null;
    url?: string;
  }>,
  requestUrl?: string,
): CustomFeed {
  // Combine all items into a single array, and collect failed feeds
  const allItems: CustomItem[] = [];
  const failedFeeds: Array<{ url: string; error: string }> = [];

  results.forEach(({ feed, error, url }) => {
    if (error) {
      failedFeeds.push({ url: url || "unknown", error });
    } else if (feed && feed.items && feed.items.length > 0) {
      allItems.push(...feed.items);
    }
  });

  // Create error items for failed feeds and add them to the beginning
  const errorItems: CustomItem[] = failedFeeds.map((failed) => ({
    title: `⚠️ Failed to load feed: ${failed.url}`,
    link: failed.url,
    pubDate: new Date().toUTCString(),
    isoDate: new Date().toISOString(),
    contentSnippet: `Error: ${failed.error}`,
    content: `<p>Failed to load this feed:</p><p><code>${escapeXml(failed.url)}</code></p><p>Error: ${escapeXml(failed.error)}</p>`,
    // Keep the guid stable so readers show one error item per failing feed,
    // not a new one every time they poll.
    guid: `error-${failed.url}`,
  }));

  // Sort regular items by date (newest first), keep error items at top
  allItems.sort((a, b) => {
    const dateA = a.isoDate ? new Date(a.isoDate) : new Date(a.pubDate || 0);
    const dateB = b.isoDate ? new Date(b.isoDate) : new Date(b.pubDate || 0);
    return dateB.getTime() - dateA.getTime();
  });

  // Combine error items (at the top) with sorted regular items
  const allItemsWithErrors: CustomItem[] = [...errorItems, ...allItems];

  // Get feed titles from successful feeds for the description
  const successfulFeedTitles = results
    .filter(({ feed }) => feed && feed.title)
    .map(({ feed }) => feed?.title)
    .filter(Boolean) as string[];

  // Create a merged feed
  return {
    title: FEED_TITLE,
    description: `Combined feed from ${successfulFeedTitles.join(", ")}${
      failedFeeds.length > 0
        ? ` (${failedFeeds.length} feed(s) failed to load)`
        : ""
    }`,
    link: requestUrl,
    items: allItemsWithErrors.slice(0, 100),
  };
}

// Helper functions for XML generation
// Helper to safely coerce a value to a string.
// Handles cases where rss-parser returns an object (e.g., { $: { isPermaLink: "false" }, _: "actual-guid" })
// when XML elements have attributes.
function safeString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);

  if (typeof value === "object") {
    // rss-parser stores the text content in _ and attributes in $
    const v = value as Record<string, unknown>;
    if (typeof v._ === "string") return v._;
    if (v._ != null) return String(v._);
    // If there's no _ property, the element might be attribute-only (malformed)
    return "";
  }

  return String(value);
}

function escapeXml(unsafe: unknown): string {
  const str = safeString(unsafe);
  if (!str) return "";

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapCDATA(content: unknown): string {
  const str = safeString(content);
  return `<![CDATA[${str}]]>`;
}

/**
 * Generate RSS XML from a merged feed
 */
export function generateRSS(
  mergedFeed: CustomFeed,
  requestUrl?: string,
): string {
  const items = mergedFeed.items
    .map((item) => {
      let itemXml = "    <item>\n";

      // Title
      if (item.title) {
        itemXml += `      <title>${escapeXml(item.title)}</title>\n`;
      } else {
        itemXml += `      <title />\n`;
      }

      // Link
      if (item.link) {
        itemXml += `      <link>${escapeXml(item.link)}</link>\n`;
      }

      // GUID
      itemXml += `      <guid>${escapeXml(
        item.guid || item.link || "",
      )}</guid>\n`;

      // Publication date
      if (item.pubDate) {
        itemXml += `      <pubDate>${escapeXml(item.pubDate)}</pubDate>\n`;
      } else if (item.isoDate) {
        itemXml += `      <pubDate>${escapeXml(item.isoDate)}</pubDate>\n`;
      }

      // Creator (DC namespace)
      if (item.creator) {
        itemXml += `      <dc:creator>${wrapCDATA(
          item.creator,
        )}</dc:creator>\n`;
      }

      // Content or description
      if (item.content) {
        // Note that we don't need to encode this because we're wrapping it in CData.
        // Per #11, encoding it just removes smart quotes and things of that nature unnecessarily.
        itemXml += `      <content:encoded>${wrapCDATA(
          item.content,
        )}</content:encoded>\n`;
      } else if (item.contentSnippet) {
        itemXml += `      <description>${escapeXml(
          encodeContent(item.contentSnippet),
        )}</description>\n`;
      }

      // Categories
      if (item.categories && item.categories.length > 0) {
        item.categories.forEach((category: Category) => {
          itemXml += `      <category>${escapeXml(category)}</category>\n`;
        });
      }

      // Source information
      if (item.sourceFeedTitle && item.sourceFeedUrl) {
        itemXml += `      <source url="${escapeXml(
          item.sourceFeedUrl,
        )}">${escapeXml(item.sourceFeedTitle)}</source>\n`;
      }

      itemXml += "    </item>\n";
      return itemXml;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(mergedFeed.title || FEED_TITLE)}</title>
    <description>${escapeXml(
      mergedFeed.description || "Combined feed from multiple sources",
    )}</description>
    <link>${escapeXml(mergedFeed.link || requestUrl || "")}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>${GENERATOR}</generator>
${items}  </channel>
</rss>`;
}

/**
 * Generate JSON Feed output from a merged feed
 */
export function generateJSONFeed(
  mergedFeed: CustomFeed,
  requestUrl?: string,
): string {
  const jsonFeed: JSONFeed = {
    version: "https://jsonfeed.org/version/1.1",
    title: mergedFeed.title || FEED_TITLE,
    description: mergedFeed.description,
    home_page_url: mergedFeed.link,
    feed_url: requestUrl,
    items: mergedFeed.items.map((item) => ({
      id: safeString(item.guid) || safeString(item.link) || crypto.randomUUID(),
      url: item.link,
      title: item.title,
      content_html: item.content,
      content_text: item.contentSnippet,
      date_published: item.isoDate || item.pubDate,
      author: item.creator ? { name: item.creator } : undefined,
      tags: item.categories
        ? item.categories.map((cat) => safeString(cat))
        : undefined,
    })),
  };

  return JSON.stringify(jsonFeed, null, 2);
}
