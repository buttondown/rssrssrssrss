import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';
import * as xml2js from 'xml2js';

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

export async function GET(request: NextRequest) {
  // Get the URL parameters
  const searchParams = request.nextUrl.searchParams;
  const urls = searchParams.getAll('url');

  // If no URLs are provided, return an error
  if (!urls || urls.length === 0) {
    return NextResponse.json(
      { error: 'No RSS feed URLs provided' },
      { status: 400 }
    );
  }

  try {
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
      title: 'Merged RSS Feed',
      description: `Combined feed from ${feeds.filter(f => f.title).map(f => f.title).join(', ')}`,
      link: request.nextUrl.toString(),
      items: allItems
    };

    // Convert the feed to XML
    const builder = new xml2js.Builder({
      rootName: 'rss',
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: true, indent: '  ', newline: '\n' },
      attrkey: '@',
      cdata: true,
      headless: false,
      allowSurrogateChars: true
    });
    
    const rssObj = {
      '@': {
        'version': '2.0',
        'xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
        'xmlns:dc': 'http://purl.org/dc/elements/1.1/'
      },
      'channel': {
        'title': mergedFeed.title || 'Merged RSS Feed',
        'description': mergedFeed.description || `Combined feed from multiple sources`,
        'link': mergedFeed.link || request.nextUrl.toString(),
        'lastBuildDate': new Date().toUTCString(),
        'generator': 'RSS Merge',
        'item': mergedFeed.items.map(item => {
          const rssItem: any = {
            'title': item.title || 'Untitled',
            'link': item.link || '',
            'guid': item.guid || item.link || '',
          };
          
          if (item.pubDate) {
            rssItem.pubDate = item.pubDate;
          }

          if (item.creator) {
            // Handle DC creator with CDATA
            rssItem['dc:creator'] = item.creator;
          }
          
          if (item.content) {
            // Handle content with CDATA
            rssItem['content:encoded'] = item.content;
          } else if (item.contentSnippet) {
            rssItem.description = item.contentSnippet;
          }
          
          if (item.categories && item.categories.length > 0) {
            rssItem.category = item.categories;
          }
          
          // Add source information
          if (item.sourceFeedTitle && item.sourceFeedUrl) {
            rssItem.source = {
              '@': { url: item.sourceFeedUrl },
              '#': item.sourceFeedTitle
            };
          }
          
          return rssItem;
        })
      }
    };

    try {
      const xml = builder.buildObject(rssObj);
      
      // Return the XML response
      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Cache-Control': 'max-age=600, s-maxage=600', // Cache for 10 minutes
        },
      });
    } catch (xmlError) {
      console.error('Error building XML:', xmlError);
      
      // Try a more aggressive sanitization approach
      try {
        // Create a simplified object with minimal content
        const simpleRssObj = {
          '@': {
            'version': '2.0'
          },
          'channel': {
            'title': 'Merged RSS Feed',
            'description': 'Combined feed from multiple sources',
            'link': request.nextUrl.toString(),
            'item': mergedFeed.items.map(item => ({
              'title': (item.title || 'Untitled').replace(/[^\w\s.,;:!?'"()[\]{}-]/g, ''),
              'link': item.link || '',
              'description': item.contentSnippet ? item.contentSnippet.replace(/[^\w\s.,;:!?'"()[\]{}-]/g, '') : undefined
            }))
          }
        };
        
        const simpleXml = builder.buildObject(simpleRssObj);
        return new NextResponse(simpleXml, {
          headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'max-age=600, s-maxage=600',
          },
        });
      } catch (fallbackError) {
        console.error('Fallback XML generation failed:', fallbackError);
        return NextResponse.json(
          { error: `Error generating RSS XML: ${xmlError.message}` },
          { status: 500 }
        );
      }
    }
  } catch (error) {
    console.error('Error processing RSS feeds:', error);
    // Add more detailed error information
    const errorMessage = error instanceof Error 
      ? `Error processing RSS feeds: ${error.name}: ${error.message}` 
      : 'Error processing RSS feeds: Unknown error';
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}