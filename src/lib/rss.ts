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

// Every feed fetch goes out with our UA. Some origins (e.g. Cloudflare bot
// protection) 403 generic or missing User-Agents, and re-fetching the same
// URL within one request looks bot-like, so we only fetch a URL once.
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept:
    "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, text/html, */*",
};

/**
 * Attach source feed metadata to every item.
 */
function withSource(feed: CustomFeed, sourceUrl?: string): CustomFeed {
  return {
    ...feed,
    items: feed.items.map((item: CustomItem) => ({
      ...item,
      sourceFeedTitle: feed.title,
      sourceFeedUrl: sourceUrl,
    })),
  };
}

function jsonFeedToCustomFeed(
  jsonFeed: JSONFeed,
  sourceUrl?: string,
): CustomFeed {
  return {
    title: jsonFeed.title,
    description: jsonFeed.description,
    link: jsonFeed.home_page_url,
    items: jsonFeed.items.map((item) => ({
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
    })),
  };
}

// Quiet parse helpers: no logging, null when the body isn't that feed type.
function tryParseJsonFeed(body: string, sourceUrl?: string): CustomFeed | null {
  try {
    const jsonFeed: JSONFeed = JSON.parse(body);
    if (!jsonFeed.version?.includes("jsonfeed.org")) return null;
    return jsonFeedToCustomFeed(jsonFeed, sourceUrl);
  } catch {
    return null;
  }
}

async function tryParseXmlFeed(
  body: string,
  sourceUrl?: string,
): Promise<CustomFeed | null> {
  try {
    return withSource(await parser.parseString(body), sourceUrl);
  } catch {
    return null;
  }
}

async function tryParseFeed(
  body: string,
  sourceUrl?: string,
): Promise<CustomFeed | null> {
  return (
    tryParseJsonFeed(body, sourceUrl) ??
    (await tryParseXmlFeed(body, sourceUrl))
  );
}

async function fetchFeedText(
  url: string,
): Promise<{ body: string } | { error: string }> {
  let response: Response;
  try {
    response = await fetch(url, { headers: FETCH_HEADERS });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!response.ok) {
    return { error: `Status code ${response.status}` };
  }
  return { body: await response.text() };
}

/**
 * Find a feed URL in an HTML page's <link rel="alternate"> tags.
 */
function findFeedUrlInHtml(url: string, html: string): string | null {
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

    if (
      !type.includes("application/rss+xml") &&
      !type.includes("application/atom+xml") &&
      !type.includes("application/feed+json") &&
      !type.includes("application/json")
    ) {
      continue;
    }

    if (href.startsWith("http://") || href.startsWith("https://")) {
      return href;
    }
    if (href.startsWith("//")) {
      return `${new URL(url).protocol}${href}`;
    }
    if (href.startsWith("/")) {
      return `${new URL(url).origin}${href}`;
    }
    const pathParts = new URL(url).pathname.split("/");
    pathParts.pop();
    return `${new URL(url).origin}${pathParts.join("/")}/${href}`;
  }

  return null;
}

/**
 * Try to discover RSS/Atom feed URLs from an HTML page by looking for
 * <link rel="alternate"> tags with feed content types.
 */
export async function discoverFeedFromHtml(
  url: string,
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html, application/xhtml+xml, */*",
      },
    });

    const contentType = response.headers.get("content-type") || "";

    // Only try to discover feeds from HTML pages
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }

    return findFeedUrlInHtml(url, await response.text());
  } catch {
    return null;
  }
}

/**
 * Parse a feed from a URL (RSS or JSON Feed)
 * If the URL is not a feed, try to discover a feed from the HTML page.
 */
export async function parseFeedFromUrl(url: string): Promise<{
  feed: CustomFeed | null;
  error: string | null;
}> {
  const fetched = await fetchFeedText(url);
  if ("error" in fetched) {
    return { feed: null, error: fetched.error };
  }

  const feed = await tryParseFeed(fetched.body, url);
  if (feed) {
    return { feed, error: null };
  }

  // Not a feed — the URL may be an HTML page, so look for a feed link in
  // the body we already have instead of fetching the page again.
  const feedUrl = findFeedUrlInHtml(url, fetched.body);
  if (!feedUrl) {
    return {
      feed: null,
      error: `Could not parse feed from ${url}: not a valid RSS, Atom, or JSON Feed`,
    };
  }

  const discovered = await fetchFeedText(feedUrl);
  if ("error" in discovered) {
    console.error(
      `Error fetching discovered feed from ${feedUrl} (original: ${url}): ${discovered.error}`,
    );
    return { feed: null, error: discovered.error };
  }

  const discoveredFeed = await tryParseFeed(discovered.body, feedUrl);
  if (discoveredFeed) {
    return { feed: discoveredFeed, error: null };
  }

  console.error(
    `Error parsing discovered feed from ${feedUrl} (original: ${url})`,
  );
  return {
    feed: null,
    error: `Could not parse feed from ${feedUrl}: not a valid RSS, Atom, or JSON Feed`,
  };
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
    return {
      feed: withSource(await parser.parseString(xml), sourceUrl),
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

    if (!jsonFeed.version?.includes("jsonfeed.org")) {
      return {
        feed: null,
        error: "Invalid JSON Feed: missing or invalid version",
      };
    }

    return { feed: jsonFeedToCustomFeed(jsonFeed, sourceUrl), error: null };
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
