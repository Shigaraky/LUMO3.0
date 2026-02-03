// AGGIORNATO A VERSIONE 4.0
const CACHE_NAME = 'lumo-v4.3'; 

const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './manifest.json',
    // Font
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
    // Libreria Grafici
    'https://cdn.jsdelivr.net/npm/chart.js',
    // NUOVO: Plugin per le percentuali (IMPORTANTE)
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0'
];

// Installazione: Scarica e salva i file
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting(); // Forza l'aggiornamento immediato
});

// Attivazione: Cancella le vecchie versioni (v3.8, v3.7, ecc.)
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.map(key => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        })
    );
    self.clients.claim();
});

// Fetch: Serve i file dalla cache se offline, altrimenti scarica
self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(response => {
            return response || fetch(e.request);
        })
    );
});