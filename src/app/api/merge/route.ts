import LZString from "lz-string";
import { type NextRequest, NextResponse } from "next/server";
import Parser from "rss-parser";

// Types for RSS items
type CustomItem = {
	title?: string;
	link?: string;
	pubDate?: string;
	content?: string;
	contentSnippet?: string;
	creator?: string;
	isoDate?: string;
	guid?: string;
	categories?: string[];
	// Source tracking
	sourceFeedTitle?: string;
	sourceFeedUrl?: string;
	[key: string]: any; // For additional fields from RSS parser
};

type CustomFeed = {
	title?: string;
	description?: string;
	link?: string;
	items: CustomItem[];
	[key: string]: any; // For additional fields from RSS parser
};

// JSON Feed types
type JSONFeedItem = {
	id: string;
	url?: string;
	external_url?: string;
	title?: string;
	content_html?: string;
	content_text?: string;
	summary?: string;
	image?: string;
	banner_image?: string;
	date_published?: string;
	date_modified?: string;
	author?: {
		name?: string;
		url?: string;
		avatar?: string;
	};
	tags?: string[];
	language?: string;
	attachments?: Array<{
		url: string;
		mime_type: string;
		title?: string;
		size_in_bytes?: number;
		duration_in_seconds?: number;
	}>;
	[key: string]: any;
};

type JSONFeed = {
	version: string;
	title: string;
	home_page_url?: string;
	feed_url?: string;
	description?: string;
	user_comment?: string;
	next_url?: string;
	icon?: string;
	favicon?: string;
	authors?: Array<{
		name?: string;
		url?: string;
		avatar?: string;
	}>;
	language?: string;
	expired?: boolean;
	items: JSONFeedItem[];
	[key: string]: any;
};

// Initialize the RSS parser
const parser = new Parser({
	customFields: {
		item: [
			["content:encoded", "content"],
			["dc:creator", "creator"],
		],
	},
});

// Helper functions for JSON Feed detection and parsing
async function isJSONFeed(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { 
			headers: { 'Accept': 'application/json, application/feed+json, */*' } 
		});
		const contentType = response.headers.get('content-type') || '';
		
		if (contentType.includes('application/feed+json') || contentType.includes('application/json')) {
			const text = await response.text();
			const data = JSON.parse(text);
			return data.version && data.version.includes('jsonfeed.org');
		}
		
		return false;
	} catch {
		return false;
	}
}

async function parseJSONFeed(url: string): Promise<CustomFeed> {
	const response = await fetch(url, { 
		headers: { 'Accept': 'application/json, application/feed+json, */*' } 
	});
	const jsonFeed: JSONFeed = await response.json();
	
	// Convert JSON Feed items to CustomItem format
	const items: CustomItem[] = jsonFeed.items.map(item => ({
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
		title: mergedFeed.title || "Merged RSS Feed!",
		description: mergedFeed.description,
		home_page_url: mergedFeed.link,
		feed_url: requestUrl,
		items: mergedFeed.items.map(item => ({
			id: item.guid || item.link || crypto.randomUUID(),
			url: item.link,
			title: item.title,
			content_html: item.content,
			content_text: item.contentSnippet,
			date_published: item.isoDate || item.pubDate,
			author: item.creator ? { name: item.creator } : undefined,
			tags: item.categories,
		}))
	};
	
	return JSON.stringify(jsonFeed, null, 2);
}

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
			return NextResponse.json(
				{ error: "Invalid compressed feeds parameter" },
				{ status: 400 },
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
			{ status: 400 },
		);
	}

	// Fetch and parse all feeds (RSS and JSON) in parallel
	const feedPromises = urls.map(async (url) => {
		try {
			// Check if it's a JSON Feed first
			if (await isJSONFeed(url)) {
				return await parseJSONFeed(url);
			} else {
				// Fall back to RSS parsing
				const feed = await parser.parseURL(url);
				return {
					...feed,
					items: feed.items.map((item) => ({
						...item,
						sourceFeedTitle: feed.title,
						sourceFeedUrl: url,
					})),
				};
			}
		} catch (error) {
			console.error(`Error fetching feed from ${url}:`, error);
			return { items: [] };
		}
	});

	const feeds = await Promise.all(feedPromises);

	// Combine all items into a single array
	const allItems: CustomItem[] = [];
	feeds.forEach((feed) => {
		if (feed.items && feed.items.length > 0) {
			allItems.push(...feed.items);
		}
	});

	// Sort items by date (newest first)
	allItems.sort((a, b) => {
		const dateA = a.isoDate ? new Date(a.isoDate) : new Date(a.pubDate || 0);
		const dateB = b.isoDate ? new Date(b.isoDate) : new Date(b.pubDate || 0);
		return dateB.getTime() - dateA.getTime();
	});

	// Create a merged feed
	const mergedFeed: CustomFeed = {
		title: "Merged RSS Feed!",
		description: `Combined feed from ${feeds
			.filter((f) => f.title)
			.map((f) => f.title)
			.join(", ")}`,
		link: request.nextUrl.toString(),
		items: allItems.slice(0, 100),
	};

	// Check if JSON format is requested
	if (format === "json" || format === "jsonfeed") {
		const jsonOutput = generateJSONFeed(mergedFeed, request.nextUrl.toString());
		
		return new NextResponse(jsonOutput, {
			headers: {
				"Content-Type": "application/feed+json; charset=utf-8",
				"Cache-Control": "max-age=600, s-maxage=600", // Cache for 10 minutes
			},
		});
	}

	// Generate XML using string concatenation (default RSS output)
	const items = mergedFeed.items
		.map((item) => {
			let itemXml = "    <item>\n";

			// Title
			itemXml += `      <title>${escapeXml(item.title || "Untitled")}</title>\n`;

			// Link
			if (item.link) {
				itemXml += `      <link>${escapeXml(item.link)}</link>\n`;
			}

			// GUID
			itemXml += `      <guid>${escapeXml(item.guid || item.link || "")}</guid>\n`;

			// Publication date
			if (item.pubDate) {
				itemXml += `      <pubDate>${escapeXml(item.pubDate)}</pubDate>\n`;
			} else if (item.isoDate) {
				itemXml += `      <pubDate>${escapeXml(item.isoDate)}</pubDate>\n`;
			}

			// Creator (DC namespace)
			if (item.creator) {
				itemXml += `      <dc:creator>${wrapCDATA(item.creator)}</dc:creator>\n`;
			}

			// Content or description
			if (item.content) {
				const cleanContent = item.content.replace(/[^\x20-\x7E\n\r\t]/g, "");
				itemXml += `      <content:encoded>${wrapCDATA(cleanContent)}</content:encoded>\n`;
			} else if (item.contentSnippet) {
				itemXml += `      <description>${escapeXml(item.contentSnippet)}</description>\n`;
			}

			// Categories
			if (item.categories && item.categories.length > 0) {
				item.categories.forEach((category) => {
					itemXml += `      <category>${escapeXml(category)}</category>\n`;
				});
			}

			// Source information
			if (item.sourceFeedTitle && item.sourceFeedUrl) {
				itemXml += `      <source url="${escapeXml(item.sourceFeedUrl)}">${escapeXml(item.sourceFeedTitle)}</source>\n`;
			}

			itemXml += "    </item>\n";
			return itemXml;
		})
		.join("");

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(mergedFeed.title || "Merged RSS Feed!")}</title>
    <description>${escapeXml(mergedFeed.description || "Combined feed from multiple sources")}</description>
    <link>${escapeXml(mergedFeed.link || request.nextUrl.toString())}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>rssrssrss</generator>
${items}  </channel>
</rss>`;

	// Return the XML response
	return new NextResponse(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "max-age=600, s-maxage=600", // Cache for 10 minutes
		},
	});
}
