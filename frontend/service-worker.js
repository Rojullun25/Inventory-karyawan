/**
 * Service Worker — PT Wiratama Inventory PWA
 *
 * Strategy:
 *  - Static assets (CSS, JS, images): Cache First (cache-first → network fallback)
 *  - HTML pages: Network First (network → cache fallback if offline)
 *  - API calls: Network First (always try fresh, cache as fallback)
 *  - Upload images: Cache First (gambar foto tidak sering berubah)
 */

const CACHE_VERSION = 'v1.0.0';
const STATIC_CACHE = `wiratama-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `wiratama-dynamic-${CACHE_VERSION}`;
const API_CACHE = `wiratama-api-${CACHE_VERSION}`;

// Files yang langsung di-cache saat install
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './layout.css',
    './layout.js',
    './script.js',
    './database.js',
    './manifest.json',
    './img/logo-topbar.png',
    './img/pwa/icon-192.png',
    './img/pwa/icon-512.png',
    // External CDN
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Halaman utama yang penting di-cache untuk offline
const APP_SHELL_PAGES = [
    './dashboard.html',
    './data-karyawan.html',
    './inventaris.html',
    './riwayat-pemakaian.html',
    './stock-opname.html',
    './license-management.html',
    './laporan-bulanan.html'
];

// ─── INSTALL: cache static assets ─────────────────────────────
self.addEventListener('install', (event) => {
    console.log('[SW] Installing version', CACHE_VERSION);
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            console.log('[SW] Caching static assets');
            // Cache static + app shell, but don't fail install if some are missing
            return Promise.allSettled([
                ...STATIC_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] Skip cache:', url))),
                ...APP_SHELL_PAGES.map(url => cache.add(url).catch(e => console.warn('[SW] Skip cache:', url)))
            ]);
        }).then(() => {
            console.log('[SW] Install complete');
            return self.skipWaiting(); // Activate immediately
        })
    );
});

// ─── ACTIVATE: clear old caches ───────────────────────────────
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating version', CACHE_VERSION);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => !name.includes(CACHE_VERSION))
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] Activated, claiming clients');
            return self.clients.claim();
        })
    );
});

// ─── FETCH: handle requests ───────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests (POST, PUT, DELETE → langsung ke network)
    if (event.request.method !== 'GET') return;

    // Skip chrome-extension dan non-http(s)
    if (!url.protocol.startsWith('http')) return;

    // ── API requests: Network First (selalu coba fresh, fallback ke cache) ──
    if (url.pathname.includes('/api/')) {
        event.respondWith(networkFirst(event.request, API_CACHE));
        return;
    }

    // ── Foto uploads: Cache First (foto rarely change) ──
    if (url.pathname.includes('/uploads/')) {
        event.respondWith(cacheFirst(event.request, DYNAMIC_CACHE));
        return;
    }

    // ── HTML pages: Network First (always try fresh, fallback to cached version) ──
    if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
        event.respondWith(networkFirst(event.request, DYNAMIC_CACHE));
        return;
    }

    // ── Static assets (CSS, JS, fonts, images): Cache First ──
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
});

// ─── STRATEGY: Cache First ────────────────────────────────────
// Coba cache dulu. Kalau gak ada, fetch dari network & cache.
async function cacheFirst(request, cacheName) {
    try {
        const cached = await caches.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        if (response && response.status === 200 && response.type === 'basic') {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        console.warn('[SW] cacheFirst failed:', request.url, e);
        return caches.match(request) || new Response('Offline & not cached', { status: 503 });
    }
}

// ─── STRATEGY: Network First ──────────────────────────────────
// Coba network dulu (data fresh). Kalau offline, fallback ke cache.
async function networkFirst(request, cacheName) {
    try {
        const response = await fetch(request);
        // Cache successful responses
        if (response && response.status === 200) {
            const cache = await caches.open(cacheName);
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        console.log('[SW] Network failed, trying cache:', request.url);
        const cached = await caches.match(request);
        if (cached) return cached;

        // Last resort: kalau request HTML page, return offline page
        if (request.destination === 'document') {
            return caches.match('./index.html') || new Response(
                getOfflineHTML(),
                { headers: { 'Content-Type': 'text/html' } }
            );
        }
        return new Response('Offline', { status: 503 });
    }
}

// ─── OFFLINE FALLBACK PAGE ────────────────────────────────────
function getOfflineHTML() {
    return `
        <!DOCTYPE html>
        <html lang="id"><head><meta charset="UTF-8">
        <title>Offline - PT Wiratama</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #1A4D8C; color: white; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 20px; }
            .box { max-width: 400px; }
            .icon { font-size: 64px; margin-bottom: 20px; }
            h1 { font-size: 24px; margin: 0 0 12px; }
            p { opacity: 0.85; line-height: 1.6; }
            button { background: white; color: #1A4D8C; border: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 20px; font-size: 14px; }
        </style></head><body>
        <div class="box">
            <div class="icon">📡</div>
            <h1>Tidak Ada Koneksi</h1>
            <p>Anda sedang offline. Beberapa halaman mungkin tidak tersedia.<br>Periksa koneksi WiFi/jaringan Anda.</p>
            <button onclick="window.location.reload()">Coba Lagi</button>
        </div>
        </body></html>
    `;
}

// ─── MESSAGE handler (untuk komunikasi dari main app) ────────
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data?.type === 'CLEAR_CACHE') {
        caches.keys().then(names => names.forEach(n => caches.delete(n)));
    }
});
