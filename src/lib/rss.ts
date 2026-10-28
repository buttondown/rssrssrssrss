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
const FETCH_TIMEOUT_MS = 30000;
const FEED_CACHE_SECONDS = 600;

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

// Share each upstream feed across merged feeds for FEED_CACHE_SECONDS.
async function fetchWithEdgeCache(url: string): Promise<Response> {
  const cache = edgeCache();
  const cached = await cache?.match(url);
  if (cached) {
    return cached;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "application/feed+json, application/json, application/rss+xml, application/atom+xml, text/html, */*",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!cache || !response.ok) {
    return response;
  }

  const copy = new Response(await response.arrayBuffer(), response);
  copy.headers.delete("Set-Cookie");
  copy.headers.set("Cache-Control", `public, s-maxage=${FEED_CACHE_SECONDS}`);
  await cache.put(url, copy.clone());
  return copy;
}

// Workers do not apply the abort signal to a slow response body, so also race a timer.
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`Timed out after ${ms}ms`), {
            name: "TimeoutError",
          }),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse a feed from a URL (RSS or JSON Feed) with a single fetch.
 * If the URL is not a feed, try to discover a feed from the HTML page.
 */
export async function parseFeedFromUrl(
  url: string,
  allowDiscovery = true,
): Promise<{
  feed: CustomFeed | null;
  error: string | null;
}> {
  let response: Response;
  let body: Buffer;
  try {
    [response, body] = await withDeadline(
      fetchWithEdgeCache(url).then(
        async (r) => [r, Buffer.from(await r.arrayBuffer())] as const,
      ),
      FETCH_TIMEOUT_MS,
    );
  } catch (error) {
    console.error(`Error fetching feed from ${url}:`, error);
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        feed: null,
        error: `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
      };
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
    return parseFeedFromUrl(discoveredFeedUrl, false);
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
    guid: `error-${failed.url}-${Date.now()}`,
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
