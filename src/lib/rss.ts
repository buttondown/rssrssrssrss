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

// Helper function to try parsing as JSON Feed, returns null if not a JSON Feed
async function tryParseAsJSONFeed(url: string): Promise<CustomFeed | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json, application/feed+json, */*" },
    });
    const contentType = response.headers.get("content-type") || "";

    if (
      contentType.includes("application/feed+json") ||
      contentType.includes("application/json")
    ) {
      const text = await response.text();
      const jsonFeed: JSONFeed = JSON.parse(text);

      if (!jsonFeed.version || !jsonFeed.version.includes("jsonfeed.org")) {
        return null;
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
        sourceFeedUrl: url,
      }));

      return {
        title: jsonFeed.title,
        description: jsonFeed.description,
        link: jsonFeed.home_page_url,
        items,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a feed from a URL (RSS or JSON Feed)
 */
export async function parseFeedFromUrl(url: string): Promise<{
  feed: CustomFeed | null;
  error: string | null;
}> {
  try {
    // Check if it's a JSON Feed first (single fetch)
    const jsonFeed = await tryParseAsJSONFeed(url);
    if (jsonFeed) {
      return { feed: jsonFeed, error: null };
    } else {
      // Fall back to RSS parsing
      const feed = await parser.parseURL(url);
      return {
        feed: {
          ...feed,
          items: feed.items.map((item: CustomItem) => ({
            ...item,
            sourceFeedTitle: feed.title,
            sourceFeedUrl: url,
          })),
        },
        error: null,
      };
    }
  } catch (error) {
    console.error(`Error fetching feed from ${url}:`, error);
    return {
      feed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
function escapeXml(unsafe: string): string {
  if (!unsafe) return "";

  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapCDATA(content: string): string {
  return `<![CDATA[${content}]]>`;
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
          // Handle categories that may be objects with _ property (from rss-parser when they have attributes)
          const categoryValue =
            typeof category === "string"
              ? category
              : category._ || String(category);
          itemXml += `      <category>${escapeXml(categoryValue)}</category>\n`;
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
      id: item.guid || item.link || crypto.randomUUID(),
      url: item.link,
      title: item.title,
      content_html: item.content,
      content_text: item.contentSnippet,
      date_published: item.isoDate || item.pubDate,
      author: item.creator ? { name: item.creator } : undefined,
      tags: item.categories
        ? item.categories.map((cat: any) =>
            typeof cat === "string" ? cat : cat._ || String(cat),
          )
        : undefined,
    })),
  };

  return JSON.stringify(jsonFeed, null, 2);
}
