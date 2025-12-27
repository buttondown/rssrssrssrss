import LZString from "lz-string";
import { type NextRequest, NextResponse } from "next/server";
import {
  parseFeedFromUrl,
  mergeFeeds,
  generateRSS,
  generateJSONFeed,
} from "@/lib/rss";

const GENERATOR = "rssrssrssrss";

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
          error: `${GENERATOR} cannot parse that payload. Are you sure you copied/pasted it correctly?`,
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
    const result = await parseFeedFromUrl(url);
    return { ...result, url };
  });

  const results = await Promise.all(feedPromises);

  // Merge all feeds into a single feed
  const mergedFeed = mergeFeeds(results, request.nextUrl.toString());

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
  const xml = generateRSS(mergedFeed, request.nextUrl.toString());

  // Return the XML response
  return new NextResponse(xml, {
    headers: HEADERS,
  });
}
