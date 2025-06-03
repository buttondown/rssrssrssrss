import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import LZString from 'lz-string';

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

// Initialize the RSS parser
const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'content'],
      ['dc:creator', 'creator'],
    ],
  },
});

// Helper functions for XML generation
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapCDATA(content: string): string {
  return `<![CDATA[${content}]]>`;
}

export async function GET(request: NextRequest) {
  // Get the URL parameters
  const searchParams = request.nextUrl.searchParams;
  let urls: string[] = [];
  
  // Check for compressed feeds parameter first
  const compressedFeeds = searchParams.get('feeds');
  if (compressedFeeds) {
    try {
      // Decompress using LZ-string and parse JSON
      const decompressed = LZString.decompressFromEncodedURIComponent(compressedFeeds);
      if (!decompressed) {
        throw new Error('Failed to decompress feeds');
      }
      urls = JSON.parse(decompressed);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid compressed feeds parameter' },
        { status: 400 }
      );
    }
  } else {
    // Fall back to old URL parameter format
    urls = searchParams.getAll('url');
  }

  // If no URLs are provided, return an error
  if (!urls || urls.length === 0) {
    return NextResponse.json(
      { error: 'No RSS feed URLs provided' },
      { status: 400 }
    );
  }

    // Fetch and parse all RSS feeds in parallel
    const feedPromises = urls.map(async (url) => {
      try {
        const feed = await parser.parseURL(url);
        return {
          ...feed,
          items: feed.items.map(item => ({
            ...item,
            sourceFeedTitle: feed.title,
            sourceFeedUrl: url
          }))
        };
      } catch (error) {
        console.error(`Error fetching feed from ${url}:`, error);
        return { items: [] };
      }
    });

    const feeds = await Promise.all(feedPromises);

    // Combine all items into a single array
    const allItems: CustomItem[] = [];
    feeds.forEach(feed => {
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
      title: 'Merged RSS Feed!',
      description: `Combined feed from ${feeds.filter(f => f.title).map(f => f.title).join(', ')}`,
      link: request.nextUrl.toString(),
      items: allItems.slice(0, 100)
    };

    // Generate XML using string concatenation
    const items = mergedFeed.items.map(item => {
      let itemXml = '    <item>\n';
      
      // Title
      itemXml += `      <title>${escapeXml(item.title || 'Untitled')}</title>\n`;
      
      // Link
      if (item.link) {
        itemXml += `      <link>${escapeXml(item.link)}</link>\n`;
      }
      
      // GUID
      itemXml += `      <guid>${escapeXml(item.guid || item.link || '')}</guid>\n`;
      
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
        const cleanContent = item.content.replace(/[^\x20-\x7E\n\r\t]/g, '');
        itemXml += `      <content:encoded>${wrapCDATA(cleanContent)}</content:encoded>\n`;
      } else if (item.contentSnippet) {
        itemXml += `      <description>${escapeXml(item.contentSnippet)}</description>\n`;
      }
      
      // Categories
      if (item.categories && item.categories.length > 0) {
        item.categories.forEach(category => {
          itemXml += `      <category>${escapeXml(category)}</category>\n`;
        });
      }
      
      // Source information
      if (item.sourceFeedTitle && item.sourceFeedUrl) {
        itemXml += `      <source url="${escapeXml(item.sourceFeedUrl)}">${escapeXml(item.sourceFeedTitle)}</source>\n`;
      }
      
      itemXml += '    </item>\n';
      return itemXml;
    }).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(mergedFeed.title || 'Merged RSS Feed!')}</title>
    <description>${escapeXml(mergedFeed.description || 'Combined feed from multiple sources')}</description>
    <link>${escapeXml(mergedFeed.link || request.nextUrl.toString())}</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>rssrssrss</generator>
${items}  </channel>
</rss>`;
      
      // Return the XML response
      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': 'max-age=600, s-maxage=600', // Cache for 10 minutes
        },
      }); 
}