const CACHE_NAME = 'lumo-v4.6-stable'; // Versione aggiornata per forzare il reset

const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './manifest.json',
    // Font Google
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
    // Libreria Grafici Base
    'https://cdn.jsdelivr.net/npm/chart.js',
    // Plugin per le percentuali sui grafici
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0'
];

// 1. Installazione: Scarica e salva i file nella memoria del telefono
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting(); // Forza l'aggiornamento immediato senza aspettare la chiusura dell'app
});

// 2. Attivazione: Cancella le vecchie versioni (es. v4.5, v4.4) per liberare memoria e aggiornare
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.map(key => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        })
    );
    self.clients.claim(); // Prende il controllo immediato della pagina
});

// 3. Fetch: Serve i file dalla cache (offline) o li scarica se non ci sono
self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(response => {
            return response || fetch(e.request);
        })
    );
});