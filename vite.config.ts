import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

function getGitBuildLabel(): string {
  try {
    const subject = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (subject && sha) return `${subject} (${sha})`;
    if (sha) return sha;
  } catch {
    // Fallback when git metadata is unavailable
  }
  return process.env.VITE_APP_BUILD || 'v1.5.0';
}

function getShortAppVersion(): string {
  try {
    const subject = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
    const match = subject.match(/v\d+\.\d+\.\d+/i);
    if (match) return match[0].toLowerCase();
  } catch {
    // Fallback when git metadata is unavailable
  }
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    if (pkg.version && /^\d+\.\d+\.\d+/.test(pkg.version) && pkg.version !== '1.0.0') {
      return `v${pkg.version}`;
    }
  } catch {
    // Ignore package.json fallback errors
  }
  return 'v1.5.0';
}

/**
 * Generates a deterministic precache Service Worker (`sw.js`) on production build
 * with `registerType: 'autoUpdate'` behavior so all app shell assets (js, css, html, icons)
 * are pre-cached immediately for reliable offline gym launches.
 */
function ironPulsePwaPlugin(options: { registerType: 'autoUpdate'; version: string }): Plugin {
  return {
    name: 'ironpulse-pwa-precache',
    apply: 'build',
    generateBundle(_outputOptions, bundle) {
      const precacheSet = new Set<string>([
        './',
        './index.html',
        './manifest.json',
        './icon.svg',
      ]);

      const assetNames = Object.keys(bundle).sort();
      for (const fileName of assetNames) {
        if (fileName === 'sw.js' || fileName.endsWith('.map')) continue;
        if (/\.(?:js|css|html|svg|png|ico|webp|woff2?|json)$/i.test(fileName)) {
          precacheSet.add(`./${fileName.replace(/^\.?\//, '')}`);
        }
      }

      const precacheList = Array.from(precacheSet);
      const revisionHash = createHash('sha256')
        .update(precacheList.join('|'))
        .update(options.version)
        .digest('hex')
        .slice(0, 10);

      const cacheName = `ironpulse-shell-${options.version}-${revisionHash}`;
      const fontCacheName = 'ironpulse-fonts-v1';

      const swSource = `// Auto-generated IronPulse PWA Service Worker (registerType: '${options.registerType}')
const CACHE_NAME = ${JSON.stringify(cacheName)};
const FONT_CACHE_NAME = ${JSON.stringify(fontCacheName)};
const PRECACHE_ASSETS = ${JSON.stringify(precacheList, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        PRECACHE_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== FONT_CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cache Google Fonts stylesheets & font binaries for offline typography
  if (
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((res) => {
              if (res && res.ok) cache.put(request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Do not intercept third-party APIs (Firebase, Google Tasks OAuth/REST)
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first with guaranteed offline shell fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() =>
          caches.match('./index.html').then((fallback) => fallback || caches.match('./'))
        )
    );
    return;
  }

  // App shell static assets: cache-first with background refresh
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
`;

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: swSource,
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => {
  const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const shortVersion = getShortAppVersion();
  return {
    plugins: [
      react(),
      ironPulsePwaPlugin({ registerType: 'autoUpdate', version: shortVersion }),
    ],
    base: '/ironpulse-workout-tracker/',
    define: {
      __APP_VERSION__: JSON.stringify(shortVersion),
      __APP_BUILD__: JSON.stringify(getGitBuildLabel()),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
  };
});
