'use client';

import { useState } from 'react';
import Image from 'next/image';

export default function Home() {
  const [feeds, setFeeds] = useState<string[]>(['']);
  const [mergedUrl, setMergedUrl] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [feedsFetched, setFeedsFetched] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const addFeed = () => {
    setFeeds([...feeds, '']);
    setErrorMessage('');
  };

  const removeFeed = (index: number) => {
    const updatedFeeds = feeds.filter((_, i) => i !== index);
    setFeeds(updatedFeeds.length ? updatedFeeds : ['']);
    setErrorMessage('');
  };

  const updateFeed = (index: number, value: string) => {
    const updatedFeeds = [...feeds];
    updatedFeeds[index] = value;
    setFeeds(updatedFeeds);
    setErrorMessage('');
  };

  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch (e) {
      return false;
    }
  };

  const validateFeeds = (feedUrls: string[]) => {
    const validFeeds = feedUrls.filter(feed => feed.trim() !== '');
    
    if (validFeeds.length === 0) {
      setErrorMessage('Please enter at least one RSS feed URL');
      return false;
    }
    
    const invalidFeeds = validFeeds.filter(feed => !isValidUrl(feed));
    if (invalidFeeds.length > 0) {
      setErrorMessage(`Invalid URL${invalidFeeds.length > 1 ? 's' : ''}: ${invalidFeeds.join(', ')}`);
      return false;
    }
    
    return true;
  };

  const generateMergedFeed = () => {
    const validFeeds = feeds.filter(feed => feed.trim() !== '');
    if (!validateFeeds(validFeeds)) return;

    setIsGenerating(true);
    setErrorMessage('');
    
    try {
      const feedsParam = validFeeds
        .map(feed => encodeURIComponent(feed))
        .join('&url=');
      
      const mergedUrl = `${window.location.origin}/api/merge?url=${feedsParam}`;
      setMergedUrl(mergedUrl);
      setFeedsFetched(true);
    } catch (error) {
      setErrorMessage('Error generating feed URL');
      console.error('Error generating feed URL:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
            RSS Merge
          </h1>
          <p className="mt-3 text-lg text-gray-500">
            Combine multiple RSS feeds into one unified feed
          </p>
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">How it works</h2>
          <ol className="list-decimal pl-5 space-y-2 text-gray-600">
            <li>Enter the URLs of RSS feeds you want to combine</li>
            <li>Click "Generate Merged Feed" to create your combined feed</li>
            <li>Use the generated URL in your favorite RSS reader</li>
            <li>The combined feed will always show the latest content from all sources</li>
          </ol>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Add your RSS feeds</h2>
          
          <div className="space-y-4">
            {feeds.map((feed, index) => (
              <div key={index} className="flex items-center">
                <input
                  type="url"
                  value={feed}
                  onChange={(e) => updateFeed(index, e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  className="flex-grow px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => removeFeed(index)}
                  className="ml-2 inline-flex items-center p-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  disabled={feeds.length === 1}
                >
                  <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-between">
            <button
              type="button"
              onClick={addFeed}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Add Another Feed
            </button>
            
            <button
              type="button"
              onClick={generateMergedFeed}
              disabled={!feeds.some(feed => feed.trim() !== '')}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Generate Merged Feed
            </button>
          </div>

          {errorMessage && (
            <div className="mt-4 p-3 border border-red-300 rounded-md bg-red-50 text-red-700">
              <p>{errorMessage}</p>
            </div>
          )}

          {isGenerating && (
            <div className="mt-6 flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
          )}

          {mergedUrl && feedsFetched && (
            <div className="mt-6 p-4 border border-gray-200 rounded-md bg-gray-50">
              <h3 className="text-lg font-medium text-gray-800 mb-2">Your merged feed URL:</h3>
              <div className="flex">
                <input
                  type="text"
                  readOnly
                  value={mergedUrl}
                  className="flex-grow px-3 py-2 border border-gray-300 rounded-l-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(mergedUrl);
                    setCopySuccess(true);
                    setTimeout(() => setCopySuccess(false), 2000);
                  }}
                  className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-r-md shadow-sm text-white ${copySuccess ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors`}
                >
                  {copySuccess ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="mt-4">
                <a
                  href={mergedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 flex items-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Feed
                </a>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>RSS Merge - A simple tool to combine multiple RSS feeds</p>
        </footer>
      </div>
    </div>
  );
}