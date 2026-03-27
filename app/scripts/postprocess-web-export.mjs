import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const iconSourceDir = path.join(projectRoot, 'assets');
const iconOutputDir = path.join(distDir, 'icons');

const manifest = {
  name: 'PTC User Panel',
  short_name: 'PTC User',
  description: 'Installable web app for faculty user monitoring, notifications, logs, and device control.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  theme_color: '#0E2F25',
  background_color: '#0E2F25',
  icons: [
    {
      src: './icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any maskable',
    },
    {
      src: './icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any maskable',
    },
  ],
};

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyFile(source, destination) {
  await ensureDir(path.dirname(destination));
  await fs.copyFile(source, destination);
}

async function collectFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function toRelativeUrl(projectPath) {
  const relativePath = path.relative(distDir, projectPath).split(path.sep).join('/');
  return `./${relativePath}`;
}

async function writeManifest() {
  const outputPath = path.join(distDir, 'manifest.webmanifest');
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function writeServiceWorker() {
  const files = await collectFiles(distDir);
  const assetUrls = ['./'];

  for (const filePath of files) {
    if (path.basename(filePath) === 'sw.js') {
      continue;
    }

    assetUrls.push(toRelativeUrl(filePath));
  }

  const uniqueAssetUrls = [...new Set(assetUrls)];
  const cacheVersion = uniqueAssetUrls
    .join('|')
    .split('')
    .reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 7)
    .toString(16);

  const serviceWorker = `const CACHE_NAME = 'ptc-user-panel-${cacheVersion}';
const ASSET_URLS = ${JSON.stringify(uniqueAssetUrls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSET_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      const isDocumentRequest =
        event.request.mode === 'navigate' || event.request.destination === 'document';

      if (isDocumentRequest) {
        try {
          const fresh = await fetch(event.request);
          if (fresh.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('./index.html', fresh.clone());
          }
          return fresh;
        } catch (error) {
          const fallback = await caches.match('./index.html');
          if (fallback) {
            return fallback;
          }
          throw error;
        }
      }

      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) {
        return cached;
      }

      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        throw error;
      }
    })()
  );
});
`;

  await fs.writeFile(path.join(distDir, 'sw.js'), serviceWorker, 'utf8');
}

async function patchHtml() {
  const htmlPath = path.join(distDir, 'index.html');
  let html = await fs.readFile(htmlPath, 'utf8');

  html = html.replace('href="/favicon.ico"', 'href="./favicon.ico"');
  html = html.replace('src="/_expo/static/js/web/', 'src="./_expo/static/js/web/');

  if (!html.includes('rel="manifest"')) {
    html = html.replace(
      '</head>',
      [
        '<link rel="manifest" href="./manifest.webmanifest">',
        '<link rel="apple-touch-icon" href="./icons/icon-192.png">',
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
        '<meta name="apple-mobile-web-app-title" content="PTC User Panel">',
        '</head>',
      ].join('')
    );
  }

  if (!html.includes('navigator.serviceWorker.register')) {
    html = html.replace(
      '</body>',
      [
        '<script>',
        "if ('serviceWorker' in navigator) {",
        "  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));",
        '}',
        '</script>',
        '</body>',
      ].join('')
    );
  }

  await fs.writeFile(htmlPath, html, 'utf8');
}

async function main() {
  await ensureDir(iconOutputDir);
  await copyFile(path.join(iconSourceDir, 'pwa-icon-192.png'), path.join(iconOutputDir, 'icon-192.png'));
  await copyFile(path.join(iconSourceDir, 'pwa-icon-512.png'), path.join(iconOutputDir, 'icon-512.png'));
  await writeManifest();
  await writeServiceWorker();
  await patchHtml();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
