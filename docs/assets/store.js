/* 本地草稿与待交箱：IndexedDB，断网也能填、关掉浏览器不丢 */
window.Store = (function () {
  var DB = 'kaohe_v2';
  var VER = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var s = t.objectStore(store);
        var out;
        try { out = fn(s); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function draftKey(station, month) { return station + '|' + month; }

  return {
    saveDraft: function (key, data) {
      data.key = key;
      data.updatedAt = Date.now();
      return tx('drafts', 'readwrite', function (s) { s.put(data); });
    },
    getDraft: function (key) {
      return tx('drafts', 'readonly', function (s) { return s.get(key); });
    },
    listDrafts: function () {
      return tx('drafts', 'readonly', function (s) { return s.getAll(); });
    },
    removeDraft: function (key) {
      return tx('drafts', 'readwrite', function (s) { s.delete(key); });
    },
    addOutbox: function (rec) {
      rec.id = rec.id || (rec.station + '|' + rec.month + '|' + rec.submittedAt);
      return tx('outbox', 'readwrite', function (s) { s.put(rec); });
    },
    listOutbox: function () {
      return tx('outbox', 'readonly', function (s) { return s.getAll(); });
    },
    removeOutbox: function (id) {
      return tx('outbox', 'readwrite', function (s) { s.delete(id); });
    }
  };
})();
