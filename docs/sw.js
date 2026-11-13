/* 离线缓存：站点信号差时也能打开打分页 */
var CACHE = 'kaohe-v5-5';
var SHELL = [
  './',
  'index.html',
  'score.html',
  'rank.html',
  'eff.html',
  'calc.html',
  'status.html',
  'direct.html',
  'assets/status.js',
  'assets/app.css',
  'assets/config.js',
  'assets/engine.js',
  'assets/store.js',
  'assets/ui.js',
  'assets/vendor/jszip.min.js',
  'assets/score.js',
  'data/items.json',
  'data/stations.json',
  'data/efficiency.json',
  'data/inspectors.json',
  'data/station_status.json',
  'data/rank.json',
  'manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () { /* 单个失败不影响整体安装 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // JSON 数据：先网络后缓存，保证排名能更新；断网再用缓存
  if (url.pathname.indexOf('/data/') !== -1) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return res;
      });
    })
  );
});
