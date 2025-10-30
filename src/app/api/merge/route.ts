import LZString from "lz-string";
import { encodeContent } from "@/lib/encoding";
import { type NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";
import { CustomFeed, CustomItem, JSONFeed } from "@/lib/types";

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

// Helper functions for JSON Feed detection and parsing
async function isJSONFeed(url: string): Promise<boolean> {
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
      const data = JSON.parse(text);
      return data.version && data.version.includes("jsonfeed.org");
    }

    return false;
  } catch {
    return false;
  }
}

async function parseJSONFeed(url: string): Promise<CustomFeed> {
  const response = await fetch(url, {
    headers: { Accept: "application/json, application/feed+json, */*" },
  });
  const jsonFeed: JSONFeed = await response.json();

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

// Helper functions for XML generation
function escapeXml(unsafe: string): string {
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

// Helper function to generate JSON Feed output
function generateJSONFeed(mergedFeed: CustomFeed, requestUrl: string): string {
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
      tags: item.categories,
    })),
  };

  return JSON.stringify(jsonFeed, null, 2);
}

const HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "max-age=600, s-maxage=600", // Cache for 10 minutes
};

export async function GET(request: NextRequest) {
  // Get the URL parameters
  const searchParams = request.nextUrl.searchParams;
  let urls: string[] = [];
  const format = searchParams.get("format") || "rss"; // Default to RSS

  // Check for compressed feeds parameter first
  const compressedFeeds = searchParams.get("feeds");
  if (compressedFeeds) {
    try {
      // Decompress using LZ-string and parse JSON
      const decompressed =
        LZString.decompressFromEncodedURIComponent(compressedFeeds);
      if (!decompressed) {
        throw new Error("Failed to decompress feeds");
      }
      urls = JSON.parse(decompressed);
    } catch (error) {
      // Per #7, an all-lowercase payload can hint at a Safari issue with copy/pasting and we tweak the error message to help.
      if (compressedFeeds.toLowerCase() === compressedFeeds) {
        return NextResponse.json(
          {
            error:
              "The payload you've pasted is all lowercase, which is a common issue with Safari copy/paste. Please try again with a different browser.",
            payload: compressedFeeds,
          },
          { status: 400 }
        );
      }
      return NextResponse.json(
        {
          error:
            `${GENERATOR} cannot parse that payload. Are you sure you copied/pasted it correctly?`,
          payload: compressedFeeds,
        },
        { status: 400 }
      );
    }
  } else {
    // Fall back to old URL parameter format
    urls = searchParams.getAll("url");
  }

  // If no URLs are provided, return an error
  if (!urls || urls.length === 0) {
    return NextResponse.json(
      { error: "No RSS feed URLs provided" },
      { status: 400 }
    );
  }

  // Fetch and parse all feeds (RSS and JSON) in parallel
  const feedPromises = urls.map(async (url) => {
    try {
      // Check if it's a JSON Feed first
      if (await isJSONFeed(url)) {
        return { feed: await parseJSONFeed(url), error: null, url };
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
          url,
        };
      }
    } catch (error) {
      console.error(`Error fetching feed from ${url}:`, error);
      return {
        feed: null,
        error: error instanceof Error ? error.message : String(error),
        url,
      };
    }
  });

  const results = await Promise.all(feedPromises);

  // Combine all items into a single array, and collect failed feeds
  const allItems: CustomItem[] = [];
  const failedFeeds: Array<{ url: string; error: string }> = [];

  results.forEach(({ feed, error, url }) => {
    if (error) {
      failedFeeds.push({ url, error });
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
  const mergedFeed: CustomFeed = {
    title: FEED_TITLE,
    description: `Combined feed from ${successfulFeedTitles.join(", ")}${
      failedFeeds.length > 0 ? ` (${failedFeeds.length} feed(s) failed to load)` : ""
    }`,
    link: request.nextUrl.toString(),
    items: allItemsWithErrors.slice(0, 100),
  };

  // Check if JSON format is requested
  if (format === "json" || format === "jsonfeed") {
    const jsonOutput = generateJSONFeed(mergedFeed, request.nextUrl.toString());

    return new NextResponse(jsonOutput, {
      headers: {
        "Content-Type": "application/feed+json; charset=utf-8",
        "Cache-Control": "max-age=600, s-maxage=600",
      },
    });
  }

  // Generate XML using string concatenation (default RSS output)
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
        item.guid || item.link || ""
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
          item.creator
        )}</dc:creator>\n`;
      }

      // Content or description
      if (item.content) {
        // Note that we don't need to encode this because we're wrapping it in CData.
        // Per #11, encoding it just removes smart quotes and things of that nature unnecessarily.
        itemXml += `      <content:encoded>${wrapCDATA(
          item.content
        )}</content:encoded>\n`;
      } else if (item.contentSnippet) {
        itemXml += `      <description>${escapeXml(
          encodeContent(item.contentSnippet)
        )}</description>\n`;
      }

      // Categories
      if (item.categories && item.categories.length > 0) {
        item.categories.forEach((category) => {
          itemXml += `      <category>${escapeXml(category)}</category>\n`;
        });
      }

      // Source information
      if (item.sourceFeedTitle && item.sourceFeedUrl) {
        itemXml += `      <source url="${escapeXml(
          item.sourceFeedUrl
        )}">${escapeXml(item.sourceFeedTitle)}</source>\n`;
      }

      itemXml += "    </item>\n";
      return itemXml;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(mergedFeed.title || FEED_TITLE)}</title>
    <description>${escapeXml(
      mergedFeed.description || "Combined feed from multiple sources"
    )}</description>
    <link>${escapeXml(mergedFeed.link || request.nextUrl.toString())}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>${GENERATOR}</generator>
${items}  </channel>
</rss>`;

  // Return the XML response
  return new NextResponse(xml, {
    headers: HEADERS,
  });
}
