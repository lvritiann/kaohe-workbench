/* 现场检查打分 V5
   依据《目标责任考核方案》V1.0：运营检查 100 分制 → 折算 20 分；6 项一票否决。
   交互：登录（下拉选名字 + 个人口令）；73 项默认满分，只在扣分点选「否」→ 原因必填、照片可选；提交前勾一次「已逐项核对」。
   导出：检查表 Excel ＋ 照片包打成一个 zip；照片只进金山在线表，GitHub 不存。
*/
(function () {
  var C = window.CFG, E = window.Engine, S = window.Store;

  var DATA = null, INS = null, USER = null;
  var itemsPromise = null;   /* 题目后台预取，不阻塞登录 */
  var vendorPromise = null;  /* Excel / Zip 组件按需加载，登录前不下载 */
  var S_ = {
    station: localStorage.getItem('lastStation') || '',
    month: '', inspector: '', items: {}, veto: {}, notes: {}, photos: {}
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = UI.esc;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowMonth() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function fmt(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ---------- 离线组件：只在真正要导出时加载 ----------
     登录前同步加载 862KB SheetJS + 96KB JSZip 是登录慢的主因。 */

  function loadVendor() {
    var need = [];
    if (typeof XLSX === 'undefined') need.push('assets/vendor/xlsx.full.min.js');
    if (typeof JSZip === 'undefined') need.push('assets/vendor/jszip.min.js');
    if (!need.length) return Promise.resolve();
    if (vendorPromise) return vendorPromise;
    vendorPromise = Promise.all(need.map(function (src) {
      return new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { res(); };
        s.onerror = function () { rej(new Error('离线组件加载失败：' + src)); };
        document.head.appendChild(s);
      });
    })).catch(function (e) { vendorPromise = null; throw e; });
    return vendorPromise;
  }

  /* ---------------- 登录：只等几百字节的名单，秒开 ---------------- */

  function boot() {
    S_.month = nowMonth();

    /* 题目 28KB 后台预取，登录界面不等它 */
    itemsPromise = fetch('data/items.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        DATA = j;
        localStorage.setItem('itemsCache', JSON.stringify(j));
        return j;
      })
      .catch(function () {
        var c = localStorage.getItem('itemsCache');
        if (!c) return null;
        try { DATA = JSON.parse(c); } catch (e) { DATA = null; }
        return DATA;
      });

    /* 名单拿到就渲染登录；断网用上次缓存 */
    fetch(C.inspectorsFile, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) {
        INS = j;
        localStorage.setItem('inspectorsCache', JSON.stringify(j));
        afterInspectors();
      })
      .catch(function () {
        var c = localStorage.getItem('inspectorsCache');
        try { INS = c ? JSON.parse(c) : { inspectors: [] }; } catch (e) { INS = { inspectors: [] }; }
        afterInspectors();
      });
  }

  function afterInspectors() {
    try { USER = JSON.parse(sessionStorage.getItem('kaohe_user') || 'null'); } catch (e) { USER = null; }
    if (USER && (INS.inspectors || []).some(function (x) { return x.id === USER.id; })) return enterApp();
    renderLogin();
  }

  function renderLogin() {
    $('actionbar').style.display = 'none';
    $('subInfo').textContent = '请选择打分人';
    var list = INS.inspectors || [];
    var h = '<div class="login-wrap"><div class="card">';
    h += '<div class="login-logo">✓</div>';
    h += '<h2 style="text-align:center;font-size:18px;margin-bottom:4px">现场检查打分</h2>';
    h += '<p class="hint" style="text-align:center;margin-bottom:18px">选择自己的名字，输入个人口令</p>';
    h += '<div class="field"><label>打分人</label><select id="lgName"><option value="">请选择</option>';
    list.forEach(function (x) {
      h += '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="field"><label>个人口令</label><input type="password" id="lgPass" placeholder="输入口令" autocomplete="off"></div>';
    h += '<button class="btn btn--primary btn--block" id="lgGo" style="margin-top:18px">登录</button>';
    if (!list.length) {
      h += '<div class="err" style="margin-top:12px">打分人名单未加载。请联网打开一次本页，之后断网也能登录。</div>';
    }
    h += '<p class="hint" style="margin-top:12px">登录后每条扣分记录自动署名。名单与口令在 <b>data/inspectors.json</b> 里维护。</p>';
    h += '</div></div>';
    $('app').innerHTML = h;

    $('lgGo').addEventListener('click', doLogin);
    $('lgPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  function doLogin() {
    var id = $('lgName').value;
    var pass = ($('lgPass').value || '').trim();
    var who = (INS.inspectors || []).filter(function (x) { return x.id === id; })[0];
    if (!who) { toast('请选择打分人'); return; }
    if (pass !== String(who.pass)) { toast('口令不正确'); return; }
    USER = { id: who.id, name: who.name };
    sessionStorage.setItem('kaohe_user', JSON.stringify(USER));
    enterApp();
  }

  function enterApp() {
    S_.inspector = USER.name;
    $('subInfo').textContent = USER.name + ' · ' + (S_.month || '');
    /* 进界面后后台把导出组件备好，填表这段时间足够加载完 */
    loadVendor().catch(function () { });
    if (DATA) { render(); return; }
    $('app').innerHTML = '<div class="card" style="margin-top:16px"><div class="sect__head">' +
      '<span class="sect__title">正在载入检查项…</span></div>' +
      '<div class="hint">73 项判定与 6 项否决，首次需联网取一次。</div></div>';
    itemsPromise.then(function (d) {
      if (!d) {
        $('app').innerHTML = '<div class="err">检查项加载失败，请联网打开一次本页再试；已填内容存在本机草稿里，不会丢。</div>';
        return;
      }
      render();
    });
  }

  /* ---------------- 主界面 ---------------- */

  function render() {
    /* 默认全部符合、全部否决合格 */
    DATA.items.forEach(function (it) {
      if (!S_.items[it.no]) S_.items[it.no] = 'ok';
    });
    DATA.veto.forEach(function (v) { if (!S_.veto[v.no]) S_.veto[v.no] = 'ok'; });

    var h = '';

    h += '<section class="card" style="margin-top:16px">';
    h += '<div class="warn" style="margin:0 0 12px">73 项<b>默认全部符合</b>；只有发现问题才点该项「扣分」，填原因（必填）、可附照片。</div>';
    h += '<div class="field"><label>油站</label><select id="fStation"><option value="">请选择油站</option>';
    C.stations.forEach(function (s) {
      h += '<option value="' + esc(s) + '"' + (s === S_.station ? ' selected' : '') + '>' + esc(s) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="field"><label>检查月份</label><input type="month" id="fMonth" value="' + S_.month + '"></div>';
    h += '<div class="field"><label>检查人</label><input type="text" value="' + esc(USER.name) + '" disabled></div>';
    h += '</section>';

    /* 一票否决 */
    h += '<section class="cat veto" id="cat-veto"><div class="cat__head" data-cat="veto">';
    h += '<span class="cat__idx">!</span><div class="cat__main"><span class="cat__name">一票否决（默认合格）</span>';
    h += '<div class="cat__bar"><i id="catbar-veto"></i></div></div>';
    h += '<span class="cat__meta">6 项<b id="catmeta-veto">0/6</b></span>' + CHEV + '</div><div class="cat__body">';
    DATA.veto.forEach(function (v) {
      h += '<div class="veto-item" id="veto-' + v.no + '">';
      h += '<div class="veto-line"><span class="veto-flag">否决 ' + v.no + '</span><span class="item__name" style="flex:1">' + esc(v.name) + '</span>';
      h += '<button class="mini-btn' + (S_.veto[v.no] === 'no' ? ' on' : '') + '" data-veto="' + v.no + '">不合格</button></div>';
      h += '<div class="item__content">' + esc(v.content) + '</div>';
      h += '<details class="more"><summary>检查方法</summary><div class="std">' + esc(v.method) + '</div></details>';
      h += '<div id="vbox-' + v.no + '"></div></div>';
    });
    h += '</div></section>';

    h += '<div class="sect__head" style="margin-top:22px"><span class="sect__title">运营检查</span>' +
      '<span class="sect__hint">73 项 · 100 分 → 20 分</span></div>';

    DATA.categories.forEach(function (cat, ci) {
      var list = DATA.items.filter(function (i) { return i.cat === cat.title; });
      h += '<section class="cat" id="cat-' + ci + '"><div class="cat__head" data-cat="' + ci + '">';
      h += '<span class="cat__idx">' + pad(ci + 1) + '</span>';
      h += '<div class="cat__main"><span class="cat__name">' + esc(cat.title.replace(/^[一二三四五六七八九十]+、/, '')) + '</span>';
      h += '<div class="cat__bar"><i id="catbar-' + ci + '"></i></div></div>';
      h += '<span class="cat__meta">' + cat.score + ' 分<b id="catmeta-' + ci + '">0/' + list.length + '</b></span>' + CHEV + '</div>';
      h += '<div class="cat__body">';
      list.forEach(function (it) { h += itemHtml(it); });
      h += '</div></section>';
    });

    $('app').innerHTML = h;
    $('actionbar').style.display = 'block';
    bind();
    loadDraft();
    refresh();
  }

  var CHEV = '<svg class="cat__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';

  function itemHtml(it) {
    var h = '<div class="item" id="item-' + it.no + '"><div class="item__top"><span class="item__no">' + it.no + '</span>';
    h += '<span class="item__name">' + esc(it.name) + '</span><span class="item__score">' + it.score + '分</span></div>';
    h += '<div class="item__content">' + esc(it.content) + '</div>';
    h += '<details class="more"><summary>判定标准 · 检查方法</summary><div class="std"><b>判定</b>　' + esc(it.std) + '</div>';
    h += '<div class="std"><b>方法</b>　' + esc(it.method) + '</div></details>';
    h += '<div style="display:flex;gap:8px;align-items:center;margin-top:10px">';
    h += '<span class="item-state" id="state-' + it.no + '">符合 · 得 ' + it.score + ' 分</span>';
    h += '<button class="mini-btn" data-deduct="' + it.no + '">扣分</button>';
    h += '<button class="mini-btn" data-na="' + it.no + '">不适用</button>';
    h += '</div><div id="box-' + it.no + '"></div></div>';
    return h;
  }

  /* ---------------- 扣分框 ---------------- */

  function deductHtml(no, isVeto) {
    var key = isVeto ? 'v' + no : no;
    var a = isVeto ? S_.veto[no] : S_.items[no];
    if (a !== 'no' && a !== 'na') return '';
    var notes = S_.notes[key] || {};
    var photos = S_.photos[key] || [];
    var h = '<div class="deduct">';
    if (a === 'na') {
      h += '<div class="field" style="margin-top:0"><label>不适用原因</label><input type="text" data-note="' + key + '" placeholder="如 本站无便利店" value="' + esc(notes.reason || '') + '"></div>';
      h += '<p class="hint" style="margin-top:4px">NA 项不计入 100 分，按有效项折算。</p></div>';
      return h;
    }
    h += '<div class="field" style="margin-top:0"><label>问题说明（必填）</label>';
    h += '<input type="text" data-note="' + key + '" placeholder="写清哪里不合格" value="' + esc(notes.reason || '') + '">';
    h += '</div>';
    h += '<div class="field"><label>佐证照片（可选，最多 3 张）</label>';
    h += '<input type="file" accept="image/*" multiple data-photo="' + key + '" style="font-size:13px;padding:8px">';
    h += '<div class="photo-row" id="photos-' + key + '">';
    photos.forEach(function (p, i) {
      h += '<img class="thumb" src="' + p.data + '" data-delphoto="' + key + '|' + i + '" title="点击删除">';
    });
    h += '</div></div>';
    h += '<button class="mini-btn" data-undo="' + (isVeto ? 'v' : 'i') + '|' + no + '">撤销扣分</button>';
    h += '</div>';
    return h;
  }

  function compress(file, cb) {
    var fr = new FileReader();
    fr.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var max = 1280, w = img.width, h = img.height;
        if (w > max || h > max) {
          var k = max / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = function () { toast('图片读取失败'); };
      img.src = e.target.result;
    };
    fr.readAsDataURL(file);
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    $('fStation').addEventListener('change', function () {
      S_.station = this.value; localStorage.setItem('lastStation', S_.station);
      loadDraft(); refresh();
    });
    $('fMonth').addEventListener('change', function () { S_.month = this.value || nowMonth(); loadDraft(); refresh(); });

    $('app').addEventListener('click', function (e) {
      var head = e.target.closest('.cat__head');
      if (head) {
        var box = $('cat-' + head.getAttribute('data-cat'));
        if (box) box.classList.toggle('open');
        return;
      }
      var t = e.target;

      var dv = t.getAttribute && t.getAttribute('data-veto');
      if (dv) {
        S_.veto[dv] = S_.veto[dv] === 'no' ? 'ok' : 'no';
        S_.notes['v' + dv] = { reason: '' };
        refresh(); scheduleSave(); return;
      }
      var dd = t.getAttribute && t.getAttribute('data-deduct');
      if (dd) {
        S_.items[dd] = S_.items[dd] === 'no' ? 'ok' : 'no';
        if (S_.items[dd] === 'no') S_.notes[dd] = { reason: '' };
        refresh(); scheduleSave(); return;
      }
      var dn = t.getAttribute && t.getAttribute('data-na');
      if (dn) {
        S_.items[dn] = S_.items[dn] === 'na' ? 'ok' : 'na';
        refresh(); scheduleSave(); return;
      }
      var du = t.getAttribute && t.getAttribute('data-undo');
      if (du) {
        var p = du.split('|');
        if (p[0] === 'v') S_.veto[p[1]] = 'ok';
        else S_.items[p[1]] = 'ok';
        refresh(); scheduleSave(); return;
      }
      var dp = t.getAttribute && t.getAttribute('data-delphoto');
      if (dp) {
        var q = dp.split('|');
        S_.photos[q[0]].splice(Number(q[1]), 1);
        refresh(); scheduleSave(); return;
      }
    });

    $('app').addEventListener('input', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-note');
      if (k) { S_.notes[k] = { reason: e.target.value }; scheduleSave(); }
    });

    $('app').addEventListener('change', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-photo');
      if (!k || !e.target.files) return;
      var files = Array.prototype.slice.call(e.target.files, 0, 3);
      if (!S_.photos[k]) S_.photos[k] = [];
      files.forEach(function (f) {
        compress(f, function (data) {
          S_.photos[k].push({ name: f.name, data: data });
          refresh(); scheduleSave();
        });
      });
      e.target.value = '';
    });

    $('btnSubmit').addEventListener('click', onSubmit);
  }

  function refresh() {
    /* 大类进度 + 扣分数 */
    var deducted = 0, naCount = 0;
    DATA.items.forEach(function (it) {
      var a = S_.items[it.no];
      var st = $('state-' + it.no);
      var db = document.querySelector('[data-deduct="' + it.no + '"]');
      if (db) db.textContent = a === 'no' ? '撤销' : '扣分';
      if (st) {
        st.className = 'item-state' + (a === 'no' ? ' no' : '');
        st.textContent = a === 'no' ? '不符合 · 0 分' : a === 'na' ? '不适用' : '符合 · 得 ' + it.score + ' 分';
        if (a === 'no') deducted++;
        if (a === 'na') naCount++;
      }
      var box = $('box-' + it.no);
      if (box) box.innerHTML = deductHtml(it.no, false);
      var item = $('item-' + it.no);
      if (item) item.className = 'item' + (a === 'no' ? ' state-no' : a === 'na' ? ' state-na' : '');
    });
    DATA.veto.forEach(function (v) {
      var b = $('vbox-' + v.no);
      if (b) b.innerHTML = deductHtml(v.no, true);
      var vi = $('veto-' + v.no);
      if (vi) vi.classList.toggle('fail', S_.veto[v.no] === 'no');
      var btn = document.querySelector('[data-veto="' + v.no + '"]');
      if (btn) btn.classList.toggle('on', S_.veto[v.no] === 'no');
    });
    DATA.categories.forEach(function (cat, ci) {
      var list = DATA.items.filter(function (i) { return i.cat === cat.title; });
      var n = list.filter(function (i) { return S_.items[i.no] === 'no'; }).length;
      var m = $('catmeta-' + ci); if (m) m.textContent = n + '/' + list.length + ' 扣分';
      var bar = $('catbar-' + ci); if (bar) bar.style.width = (n / list.length * 100) + '%';
      var box = $('cat-' + ci); if (box) box.classList.toggle('done', n > 0);
    });
    var vn = DATA.veto.filter(function (v) { return S_.veto[v.no] === 'no'; }).length;
    var vm = $('catmeta-veto'); if (vm) vm.textContent = vn + '/6';
    var vb = $('catbar-veto'); if (vb) vb.style.width = (vn / 6 * 100) + '%';

    var res = E.inspectResult(DATA, S_);
    $('barScore').textContent = res.converted.toFixed(2);
    $('barSub').textContent = '→ 运营段 ' + res.score.toFixed(2) + '/20 · 已扣 ' + deducted + ' 项' +
      (naCount ? ' · NA ' + naCount + ' 项' : '') + (vn ? ' · 否决 ' + vn : '');
    $('subInfo').textContent = (USER ? USER.name : '') + ' · ' + (S_.station || '未选站') + ' · ' + S_.month;
  }

  /* ---------------- 草稿 ---------------- */

  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 500); }
  function doSave() {
    if (!S_.station || !S_.month) return;
    S.saveDraft(S_.station + '|' + S_.month, {
      station: S_.station, month: S_.month, inspector: S_.inspector,
      items: S_.items, veto: S_.veto, notes: S_.notes, photos: S_.photos
    });
  }
  function loadDraft() {
    if (!S_.station || !S_.month) return;
    S.getDraft(S_.station + '|' + S_.month).then(function (d) {
      if (!d) return;
      S_.items = d.items || {}; S_.veto = d.veto || {}; S_.notes = d.notes || {}; S_.photos = d.photos || {};
      DATA.items.forEach(function (it) { if (!S_.items[it.no]) S_.items[it.no] = 'ok'; });
      DATA.veto.forEach(function (v) { if (!S_.veto[v.no]) S_.veto[v.no] = 'ok'; });
      refresh(); toast('已恢复上次草稿');
    }).catch(function () { });
  }

  /* ---------------- 提交 ---------------- */

  function onSubmit() {
    var problems = [];
    if (!S_.station) problems.push('未选择油站');
    var missing = [];
    DATA.items.forEach(function (it) {
      if (S_.items[it.no] === 'no' && !(S_.notes[it.no] && S_.notes[it.no].reason.trim())) missing.push(it.no);
    });
    DATA.veto.forEach(function (v) {
      if (S_.veto[v.no] === 'no' && !(S_.notes['v' + v.no] && S_.notes['v' + v.no].reason.trim())) missing.push('否决' + v.no);
    });
    if (missing.length) problems.push('以下扣分项未填原因：' + missing.join('、'));
    if (problems.length) {
      showSheet('<div class="sheet__grip"></div><h3>还不能提交</h3><div class="err">' + problems.map(esc).join('<br>') + '</div>' +
        '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">返回填写</button></div>');
      return;
    }

    var res = E.inspectResult(DATA, S_);
    var veto = E.vetoResult(DATA, S_);
    var b = '<div class="sheet__grip"></div><h3>提交前确认</h3>';
    b += '<div class="kv"><span>油站 / 月份</span><b>' + esc(S_.station) + ' · ' + esc(S_.month) + '</b></div>';
    b += '<div class="kv"><span>检查人</span><b>' + esc(USER.name) + '</b></div>';
    b += '<div class="kv"><span>不符合项</span><b>' + res.noCount + ' 项 · NA ' + res.naCount + ' 项</b></div>';
    b += '<div class="kv kv--total"><span>折算得分</span><b>' + res.converted.toFixed(2) + ' / 100 → 运营段 ' + res.score.toFixed(2) + ' / 20</b></div>';
    if (veto.vetoed) b += '<div class="err">已触发一票否决：' + esc(veto.failed.join('、')) + '</div>';
    b += '<label style="display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-size:14px;line-height:1.6">' +
      '<input type="checkbox" id="chkConfirm" style="width:20px;height:20px;flex:0 0 auto">';
    b += '<span>我已逐项核对全部 73 项与 6 项一票否决，确认以上结果真实。</span></label>';
    b += '<div class="sheet__acts"><button class="btn btn--ghost" onclick="closeSheet()">返回</button>' +
      '<button class="btn btn--primary" id="doSubmit" disabled>确认提交</button></div>';
    showSheet(b);
    $('chkConfirm').addEventListener('change', function () { $('doSubmit').disabled = !this.checked; });
    $('doSubmit').addEventListener('click', function () { generate(res, veto); });
  }

  function generate(res, veto) {
    var ts = new Date();
    var stamp = ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds());
    var base = '检查表_' + S_.station + '_' + S_.month + '_' + stamp;

    showSheet('<div class="sheet__grip"></div><h3>正在打包</h3>' +
      '<div class="hint">正在准备离线导出组件，请稍候…</div>');

    loadVendor().then(function () {
      try {
        var wb = buildWorkbook(res, veto, ts);
        var xlsxB64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
        var zip = new JSZip();
        zip.file(base + '.xlsx', xlsxB64, { base64: true });

        var manifest = {
          version: 'V5', station: S_.station, month: S_.month, inspector: USER.name,
          submittedAt: fmt(ts), converted: res.converted, inspectScore: res.score,
          veto: veto.failed, photos: []
        };
        DATA.items.forEach(function (it) {
          if (S_.items[it.no] !== 'no') return;
          var key = it.no;
          (S_.photos[key] || []).forEach(function (p, i) {
            var nm = 'photos/' + S_.station + '_项' + it.no + '_' + (i + 1) + '.jpg';
            zip.file(nm, p.data.split(',')[1], { base64: true });
            manifest.photos.push({ itemNo: it.no, item: it.name, file: nm, reason: (S_.notes[key] || {}).reason || '' });
          });
        });
        DATA.veto.forEach(function (v) {
          if (S_.veto[v.no] !== 'no') return;
          (S_.photos['v' + v.no] || []).forEach(function (p, i) {
            var nm = 'photos/否决' + v.no + '_' + (i + 1) + '.jpg';
            zip.file(nm, p.data.split(',')[1], { base64: true });
            manifest.photos.push({ itemNo: 'v' + v.no, item: v.name, file: nm, reason: (S_.notes['v' + v.no] || {}).reason || '' });
          });
        });
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        zip.generateAsync({ type: 'blob' }).then(function (blob) {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
          a.download = base + '.zip'; document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          S.removeDraft(S_.station + '|' + S_.month);
          closeSheet();
          showSheet('<div class="sheet__grip"></div><h3>已生成</h3><div class="hint">检查表与佐证照片已打包下载：<br><b>' + esc(base + '.zip') + '</b><br><br>发回计划经营科，由科室把照片导入金山在线表；GitHub 仓库不存照片。</div>' +
            '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">知道了</button></div>');
        }).catch(function (err) { packFail(err); });
      } catch (err) {
        packFail(err);
      }
    }).catch(function (e) {
      showSheet('<div class="sheet__grip"></div><h3>离线组件未就绪</h3>' +
        '<div class="err">' + esc(e.message) + '</div>' +
        '<div class="hint">请联网打开一次本页，让浏览器缓存导出组件后再提交；打分内容已存本机草稿，不会丢失。</div>' +
        '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">返回填写</button></div>');
    });
  }

  function packFail(err) {
    showSheet('<div class="sheet__grip"></div><h3>生成失败</h3><div class="err">' + esc(err.message) + '</div>' +
      '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">关闭</button></div>');
  }

  function buildWorkbook(res, veto, ts) {
    var aoa = [];
    aoa.push(['二级运营检查评分表（V5 · 目标责任考核 V1.0）']);
    aoa.push([]);
    aoa.push(['油站', S_.station, '检查月份', S_.month]);
    aoa.push(['检查人', USER.name, '提交时间', fmt(ts)]);
    aoa.push([]);
    aoa.push(['第一部分　一票否决项（默认合格）']);
    aoa.push(['序号', '否决项', '检查内容', '检查方法', '结果', '说明', '照片数']);
    DATA.veto.forEach(function (v) {
      var a = S_.veto[v.no];
      aoa.push([v.no, v.name, v.content, v.method, a === 'no' ? '不合格' : '合格',
        (S_.notes['v' + v.no] || {}).reason || '', (S_.photos['v' + v.no] || []).length]);
    });
    aoa.push([]);
    aoa.push(['第二部分　运营检查（100 分制 → 折算 20 分）']);
    aoa.push(['大类', '序号', '检查项目', '检查内容', '检查方法', '判定标准', '标准分', '得分', '原因', '照片数']);
    DATA.items.forEach(function (it) {
      var a = S_.items[it.no];
      aoa.push([it.cat, it.no, it.name, it.content, it.method, it.std, it.score,
        a === 'ok' ? it.score : a === 'na' ? 'NA' : 0,
        (S_.notes[it.no] || {}).reason || '', (S_.photos[it.no] || []).length]);
    });
    aoa.push([]);
    aoa.push(['实得小计', res.raw, 'NA 项标准分', res.naScore,
      '有效项总分', res.effective, '折算得分/100', res.converted, '运营段/20', res.score]);
    aoa.push(['一票否决', veto.vetoed ? '已触发：' + veto.failed.join('、') : '未触发']);
    aoa.push(['检查人', USER.name, '确认', '已逐项核对 73 项 + 6 项否决']);

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 18 }, { wch: 5 }, { wch: 20 }, { wch: 44 }, { wch: 26 },
      { wch: 34 }, { wch: 7 }, { wch: 7 }, { wch: 24 }, { wch: 8 }];

    var s2 = [['大类', '分值', '项数', '不符合项', 'NA 项']];
    DATA.categories.forEach(function (cat) {
      var list = DATA.items.filter(function (i) { return i.cat === cat.title; });
      s2.push([cat.title, cat.score, list.length,
        list.filter(function (i) { return S_.items[i.no] === 'no'; }).length,
        list.filter(function (i) { return S_.items[i.no] === 'na'; }).length]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(s2);

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '评分表');
    XLSX.utils.book_append_sheet(wb, ws2, '汇总');
    return wb;
  }

  window.closeSheet = function () { $('mask').classList.remove('show'); };
  function showSheet(html) { $('modal').innerHTML = html; $('mask').classList.add('show'); }

  boot();
})();
