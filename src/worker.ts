import { edgeCache } from "@/lib/edge-cache";
import {
  generateJSONFeed,
  generateRSS,
  mergeFeeds,
  parseFeedsFromUrls,
} from "@/lib/rss";
import LZString from "lz-string";

const GENERATOR = "rssrssrssrss";

const HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control":
    "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
};

// Matches the s-maxage and stale-while-revalidate in HEADERS.
const FRESH_SECONDS = 3600;
const STALE_SECONDS = 86400;
// Retry sooner when some feeds failed to load.
const FRESH_SECONDS_WITH_FAILURES = 600;
const FRESH_UNTIL = "X-Fresh-Until";

type Context = { waitUntil(promise: Promise<unknown>): void };

export default {
  async fetch(
    request: Request,
    _env?: unknown,
    ctx?: Context,
  ): Promise<Response> {
    if (new URL(request.url).pathname !== "/api/merge") {
      return new Response("Not found", { status: 404 });
    }
    return handleMerge(request, ctx);
  },
};

// Cloudflare does not cache Worker responses at the edge, and the Cache API
// has no stale-while-revalidate, so serve stale copies and refresh them here.
async function handleMerge(request: Request, ctx?: Context) {
  const cache = edgeCache();
  if (!cache) {
    return (await merge(request)).response;
  }

  const cached = await cache.match(request.url);
  if (!cached) {
    return mergeAndCache(request, cache);
  }

  if (Date.now() > Number(cached.headers.get(FRESH_UNTIL))) {
    ctx?.waitUntil(mergeAndCache(request, cache));
  }
  const response = new Response(cached.body, cached);
  response.headers.set("Cache-Control", HEADERS["Cache-Control"]);
  response.headers.delete(FRESH_UNTIL);
  return response;
}

async function mergeAndCache(request: Request, cache: Cache) {
  const { response, failures } = await merge(request);
  if (response.ok) {
    const freshSeconds =
      failures > 0 ? FRESH_SECONDS_WITH_FAILURES : FRESH_SECONDS;
    const copy = new Response(response.clone().body, response);
    copy.headers.set(
      "Cache-Control",
      `public, s-maxage=${FRESH_SECONDS + STALE_SECONDS}`,
    );
    copy.headers.set(FRESH_UNTIL, String(Date.now() + freshSeconds * 1000));
    await cache.put(request.url, copy);
  }
  return response;
}

// Returns the merged feed and how many of its feeds failed to load.
async function merge(
  request: Request,
): Promise<{ response: Response; failures: number }> {
  // Get the URL parameters
  const searchParams = new URL(request.url).searchParams;
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
        return errorResponse(
          {
            error:
              "The payload you've pasted is all lowercase, which is a common issue with Safari copy/paste. Please try again with a different browser.",
            payload: compressedFeeds,
          },
          { status: 400 },
        );
      }
      return errorResponse(
        {
          error: `${GENERATOR} cannot parse that payload. Are you sure you copied/pasted it correctly?`,
          payload: compressedFeeds,
        },
        { status: 400 },
      );
    }
  } else {
    // Fall back to old URL parameter format
    urls = searchParams.getAll("url");
  }

  // If no URLs are provided, return an error
  if (!urls || urls.length === 0) {
    return errorResponse(
      { error: "No RSS feed URLs provided" },
      { status: 400 },
    );
  }

  // Fetch and parse all feeds (RSS and JSON) in parallel
  const results = await parseFeedsFromUrls(urls);
  const failures = results.filter(({ error }) => error).length;

  // Merge all feeds into a single feed
  const mergedFeed = mergeFeeds(results, request.url);

  // Check if JSON format is requested
  if (format === "json" || format === "jsonfeed") {
    const jsonOutput = generateJSONFeed(mergedFeed, request.url);

    const response = new Response(jsonOutput, {
      headers: {
        "Content-Type": "application/feed+json; charset=utf-8",
        "Cache-Control": HEADERS["Cache-Control"],
      },
    });
    return { response, failures };
  }

  // Generate XML using string concatenation (default RSS output)
  const xml = generateRSS(mergedFeed, request.url);

  // Return the XML response
  return { response: new Response(xml, { headers: HEADERS }), failures };
}

function errorResponse(body: unknown, init: ResponseInit) {
  return { response: Response.json(body, init), failures: 0 };
}
