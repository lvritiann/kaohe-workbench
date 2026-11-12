/* 共享 UI：底部标签栏、轻提示、图标 */
window.UI = (function () {
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
    check: '<path d="M9 11.5l2.2 2.2L15.5 9"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/>',
    rank: '<path d="M5 20V11"/><path d="M12 20V4"/><path d="M19 20v-6"/>',
    calc: '<rect x="4.5" y="3" width="15" height="18" rx="3"/><path d="M8 8h8M8 12h3M8 16h3M14.5 12v4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
    chart: '<path d="M3 17l5-5 4 3 6-8"/><path d="M18 7h3v3"/><path d="M3 21h18"/>'
  };

  var TABS = [
    { id: 'home', href: 'index.html', label: '首页', icon: 'home' },
    { id: 'score', href: 'score.html', label: '打分', icon: 'check' },
    { id: 'rank', href: 'rank.html', label: '排名', icon: 'rank' },
    { id: 'eff', href: 'eff.html', label: '人效', icon: 'chart' },
    { id: 'calc', href: 'calc.html', label: '算例', icon: 'calc' }
  ];

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  function tabbar(active) {
    var host = document.getElementById('tabbar');
    if (!host) return;
    host.className = 'tabbar';
    host.innerHTML = TABS.map(function (t) {
      return '<a href="' + t.href + '" class="' + (t.id === active ? 'on' : '') + '">' +
        svg(t.icon) + '<span>' + t.label + '</span></a>';
    }).join('');
  }

  var toastEl = null, toastTimer = null;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 主题：科技暗色 / 日间 ---------- */
  var THEME_KEY = 'kaohe-theme';

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var btn = document.getElementById('themeBtn');
    if (btn) {
      btn.innerHTML = svg(t === 'light' ? 'moon' : 'sun');
      btn.setAttribute('aria-label', t === 'light' ? '切换到科技暗色' : '切换到日间模式');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#eef3f7' : '#050a10');
  }

  function initTheme() {
    var saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);
    var btn = document.getElementById('themeBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        var next = (document.documentElement.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
      });
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { });
    });
  }

  document.addEventListener('DOMContentLoaded', initTheme);

  return { tabbar: tabbar, toast: toast, esc: esc, svg: svg, initTheme: initTheme };
})();
