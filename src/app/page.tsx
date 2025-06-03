'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import LZString from 'lz-string';

type FeedItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  sourceFeedTitle?: string;
  image?: string;
};

export default function Home() {
  const [feedList, setFeedList] = useState<string>('');
  const [mergedUrl, setMergedUrl] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [previewItems, setPreviewItems] = useState<FeedItem[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const sampleFeeds = [
    { name: 'Tech News Bundle', feeds: ['https://hnrss.org/frontpage', 'https://feeds.arstechnica.com/arstechnica/features', 'https://www.theverge.com/rss/index.xml'] },
    { name: 'Development Blogs', feeds: ['https://overreacted.io/rss.xml', 'https://jvns.ca/atom.xml', 'https://kentcdodds.com/blog/rss.xml'] },
    { name: 'Design & UX', feeds: ['https://www.smashingmagazine.com/feed/', 'https://alistapart.com/main/feed/', 'https://www.nngroup.com/feed/rss/'] }
  ];

  const getFeedsFromList = () => {
    return feedList
      .split('\n')
      .map(feed => feed.trim())
      .filter(feed => feed !== '');
  };

  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  };

  const validateFeeds = () => {
    const feedUrls = getFeedsFromList();
    
    if (feedUrls.length === 0) {
      setErrorMessage('Please enter at least one RSS feed URL');
      return false;
    }
    
    const invalidFeeds = feedUrls.filter(feed => !isValidUrl(feed));
    if (invalidFeeds.length > 0) {
      setErrorMessage(`Invalid URL${invalidFeeds.length > 1 ? 's' : ''}: ${invalidFeeds.join(', ')}`);
      return false;
    }
    
    return true;
  };

  const fetchPreview = async () => {
    const feeds = getFeedsFromList();
    const validFeeds = feeds.filter(feed => isValidUrl(feed));
    if (validFeeds.length === 0) {
      setPreviewItems([]);
      return;
    }

    setIsLoadingPreview(true);
    try {
      // Compress feeds using LZ-string for better compression
      const feedsData = JSON.stringify(validFeeds);
      const compressedFeeds = LZString.compressToEncodedURIComponent(feedsData);
      
      const response = await fetch(`/api/merge?feeds=${compressedFeeds}`);
      if (!response.ok) {
        throw new Error('Failed to fetch preview');
      }
      
      const text = (await response.text()).replaceAll('content:encoded', 'content');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');
      console.log(xmlDoc);
      
      const items = Array.from(xmlDoc.querySelectorAll('item')).slice(0, 25).map(item => {
        const getTextContent = (tagName: string) => 
          item.querySelector(tagName)?.textContent || undefined;

        return {
          title: getTextContent('title'),
          link: getTextContent('link'),
          pubDate: getTextContent('pubDate'),
          content: getTextContent('content'),
          sourceFeedTitle: item.querySelector('source')?.textContent || undefined,
          image: parser.parseFromString(getTextContent('encoded') || '', 'text/html').querySelector('img')?.getAttribute('src') || undefined
        };
      });
      
      setPreviewItems(items);
      setMergedUrl(`${window.location.origin}/api/merge?feeds=${compressedFeeds}`);
    } catch (error) {
      console.error('Error fetching preview:', error);
      setPreviewItems([]);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    const feeds = getFeedsFromList();
    const validFeeds = feeds.filter(feed => isValidUrl(feed));
    if (validFeeds.length > 0) {
      const timeoutId = setTimeout(() => {
        fetchPreview();
      }, 500);
      return () => clearTimeout(timeoutId);
    } else {
      setPreviewItems([]);
    }
  }, [feedList]);


  return (
    <div className="min-h-screen bg-neutral-100 font-sans p-0">
      <div className="flex">
        <div className="max-w-prose p-8">
        <div className="mb-12">
          <h1 className="text-lg font-extrabold font-sans text-gray-900 mb-0">
            RSSRSSRSS
          </h1>
          <p className="text-sm font-sans text-gray-500">
            Combine multiple RSS feeds into one unified feed
          </p>
        </div>

        <div className="mb-12">
          <h2 className="font-semibold text-gray-800">How it works</h2>
          <p className="text-gray-600">
            Enter the URLs of RSS feeds you want to combine, click "Generate Merged Feed" to create your combined feed, then use the generated URL in your favorite RSS reader. The combined feed will always show the latest content from all sources.
          </p>
        </div>

        <div className="mb-12">
          <h2 className="font-semibold text-gray-800">Why use rssrssrss?</h2>
          <p className="text-gray-600">
            Lots of things take RSS. Relatively few things do a great job of interleaving multiple RSS feeds. This is a simple tool to do that.
          </p>
        </div>

        <div className="">
          <h2 className="font-semibold text-gray-800">Add your RSS feeds</h2>
          <p className="text-sm text-gray-600 mb-2">Enter one RSS feed URL per line</p>
          <div className="space-y-4">
            <textarea
              value={feedList}
              onChange={(e) => {
                setFeedList(e.target.value);
                setErrorMessage('');
              }}
              placeholder="https://example.com/feed.xml
https://another-site.com/rss
https://blog.example.com/feed"
              className="w-full px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 font-mono bg-white"
              rows={6}
            />
          </div>

          {errorMessage && (
            <div className="mt-4 p-3 border border-red-300 rounded-md bg-red-50 text-red-700">
              <p>{errorMessage}</p>
            </div>
          )}
          </div>
          </div>

<div className="flex-1"></div>
<div className="flex h-[calc(100vh)] overflow-y-hidden p-8 pb-0">
          {/* Live Preview Section */}
          <div className="mx-auto shadow-2xl border border-neutral-300 rounded-md rounded-b-none bg-white w-[600px] overflow-y-scroll">
            <div className="flex p-2 items-center justify-between pb-2 border-b border-neutral-300 sticky top-0 bg-white">
              <div className="flex items-center">
                {/* Every favicon, make a circle, 16px */}
                  {previewItems.map((item) => item.link?.split('/')[2]).filter((domain, index, self) => self.indexOf(domain) === index).map((domain, index) => (
                    <img key={domain} src={`https://s2.googleusercontent.com/s2/favicons?domain=${domain}`} alt={domain} className="w-4 h-4 -ml-2 first:ml-0 border border-neutral-300 rounded-full" style={{ zIndex: index + 1 }} />
                  ))}
              </div>
              <h3 className="text-sm font-semibold text-gray-800">Merged Feed</h3>
              {mergedUrl && (
                <a href={mergedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 flex items-center font-semibold text-sm mr-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="size-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Feed
                </a>
              )}
            </div>
            
            {isLoadingPreview ? (
              <div className="space-y-0">
                {[...Array(5)].map((_, index) => (
                  <div key={index} className="border border-gray-100 text-sm odd:bg-neutral-100/50 p-2 border-b border-b-neutral-300 animate-pulse">
                    <div className="h-5 bg-gray-300 rounded w-3/4 mb-2"></div>
                    <div className="space-y-2">
                      <div className="h-3 bg-gray-200 rounded"></div>
                      <div className="h-3 bg-gray-200 rounded w-5/6"></div>
                    </div>
                    <div className="flex justify-between mt-2">
                      <div className="flex items-center">
                        <div className="w-4 h-4 bg-gray-300 rounded mr-1"></div>
                        <div className="h-3 bg-gray-200 rounded w-24"></div>
                      </div>
                      <div className="h-3 bg-gray-200 rounded w-16"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : previewItems.length > 0 ? (
              <div className="">
                {previewItems.map((item, index) => (
                  <div key={index} className="border border-gray-100 text-sm odd:bg-neutral-50 p-2 max-w-full border-b border-b-neutral-300">
                    {item.image && (
                      <img src={item.image} alt={item.title} className="w-full h-48 object-cover mb-2 rounded-md" />
                    )}
                    <h4 className="font-semibold text-gray-900 truncate">
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {item.title || 'Untitled'}
                      </a>
                    </h4>
                    <div className="flex-1">
                      {item.content && (
                        <p className="text-sm text-gray-600 line-clamp-4 break-normal" dangerouslySetInnerHTML={{ __html: item.content }} />
                      )}
                    </div>
                    <div className="flex justify-between mt-2 text-xs">
                      <div className="flex items-center">
                        <img src={`https://s2.googleusercontent.com/s2/favicons?domain=${item.link?.split('/')[2]}`} alt={item.title} className="w-4 h-4 mr-1 rounded-md" />
                        {item.sourceFeedTitle && (
                          <p className="text-gray-500">
                            {item.sourceFeedTitle}
                          </p>
                        )}
                      </div>
                      {item.pubDate && (
                        <p className="text-gray-500">
                          {new Date(item.pubDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z" />
                </svg>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">No feeds added yet</h3>
                <p className="text-sm text-gray-500 mb-6">Add RSS feed URLs to see a preview of your merged feed</p>
                
                <div className="space-y-3 w-full">
                  <p className="text-xs text-gray-600 font-semibold uppercase tracking-wider">Try a sample bundle:</p>
                  {sampleFeeds.map((bundle, index) => (
                    <button
                      key={index}
                      onClick={() => setFeedList(bundle.feeds.join('\n'))}
                      className="w-full px-4 py-3 text-sm text-left border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <div className="font-semibold text-gray-800">{bundle.name}</div>
                      <div className="text-xs text-gray-500 mt-1">{bundle.feeds.length} feeds</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
  );
}