# rssrssrss

A simple, stateless SPA that allows users to combine multiple RSS feeds into a single RSS feed URL.

## Features

- Combine any number of RSS feeds into a single feed
- Simple, intuitive interface
- No account required - just enter your feeds and get a URL
- Combined feeds are sorted by date (newest first)
- Original source information is preserved in the merged feed
- RSS feeds are compressed using LZ-string for better compression, and then [translated into a URI-friendly alphabet space](https://github.com/pieroxy/lz-string/blob/master/src/encodedURIComponent/compressToEncodedURIComponent.ts)

## Development

### Prerequisites

- Bun 1.0+

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd rssrssrss

# Install dependencies
bun install

# Run the development server
bun dev
```

Open [http://localhost:3030](http://localhost:3030) with your browser to see the result.

### Available Scripts

```bash
bun dev      # Start development server
bun build    # Build for production
bun start    # Start production server
bun run lint # Run linter
bun run format # Format code with Biome
```

## Tech Stack

- Next.js 16 with React 19
- TypeScript
- Tailwind CSS 4
- Biome for linting/formatting
- Bun for package management
