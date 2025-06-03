# rssrssrss

A simple, stateless SPA that allows users to combine multiple RSS feeds into a single RSS feed URL. Built with Next.js and deployable to Vercel.

## Features

- Combine any number of RSS feeds into a single feed
- Simple, intuitive interface
- No account required - just enter your feeds and get a URL
- Combined feeds are sorted by date (newest first)
- Original source information is preserved in the merged feed
- Responsive design works on all devices

## How it Works

1. Enter the URLs of RSS feeds you want to combine
2. Click "Generate Merged Feed" to create your combined feed
3. Use the generated URL in your favorite RSS reader
4. The combined feed will always show the latest content from all sources

## Development

### Prerequisites

- Node.js 18+ and npm

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/rssrssrss.git
cd rssrssrss

# Install dependencies
npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Building for Production

```bash
npm run build
```

## Deployment

This project is optimized for deployment on Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https%3A%2F%2Fgithub.com%2Fyourusername%2Frssrssrss)

## Technologies Used

- [Next.js](https://nextjs.org/) - React framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [rss-parser](https://github.com/rbren/rss-parser) - For parsing RSS feeds
- [xml2js](https://github.com/Leonidas-from-XIV/node-xml2js) - For generating XML

## License

MIT