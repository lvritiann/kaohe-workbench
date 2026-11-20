/* 现场检查打分 V6
   依据《目标责任考核方案》V1.0（V6）：运营检查 100 分制 → 折算 28 分；6 项一票否决。
   交互：登录（下拉选名字 + 个人口令）；73 项默认满分，只在扣分点选「否」→ 原因必填、照片可选；提交前勾一次「已逐项核对」。
   提交：点确认后直接把 73 项结果 + 扣分原因 + 佐证照片 POST 给金山文档里的 AirScript
        webhook，由服务器端写「检查明细」并把照片落成 =IMAGE(直链)，格子里直接出图。
        网址与令牌存在各检查人本机（localStorage），不进源码；走中转时两者都不需要。
        未配置时先弹一次「一次性设置」，填完才放行 —— 不会静默落到别的路径。
   压缩：每张佐证照片按真实字节数迭代压到 500KB 以内再存草稿。
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
  /* 提交时最多等多久（毫秒）。必须大于中转函数的执行超时（现设 120 秒），
     否则会出现「服务端刚要回包、页面先掐断」，把成功判成超时。 */
  var CLIENT_WAIT_MS = 150000;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 会计月：上月 26 日 — 本月 25 日，26 日及以后已属下一个会计月。
     ★ 月度节奏是 25–31 日现场检查；若按日历月取值，26 日之后打的检查会被记到上一个月，
       与 record_sync.py 的会计月对不上 → 扣分整批落不进记录表。 */
  function nowMonth() {
    if (E && E.currentMonth) return E.currentMonth();
    var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
    if (d.getDate() >= 26) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + '-' + pad(m);
  }
  function fmt(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ---------- 离线组件：只在真正要导 Excel 时加载 ----------
     SheetJS 862KB，登录前同步加载是登录慢的主因。
     ★ JSZip 已不再需要：zip 打包那条路 2026-11-19 砍掉了，只剩单文件 .xlsx。 */

  function loadVendor() {
    if (typeof XLSX !== 'undefined') return Promise.resolve();
    if (vendorPromise) return vendorPromise;
    vendorPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'assets/vendor/xlsx.full.min.js';
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('离线组件加载失败：assets/vendor/xlsx.full.min.js')); };
      document.head.appendChild(s);
    }).catch(function (e) { vendorPromise = null; throw e; });
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
    (C.physicalStations || C.stations).forEach(function (s) {
      h += '<option value="' + esc(s) + '"' + (s === S_.station ? ' selected' : '') + '>' + esc(s) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="field"><label>会计月（上月26日—本月25日）</label><input type="month" id="fMonth" value="' + S_.month + '"></div>';
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
      '<span class="sect__hint">73 项 · 100 分 → ' + C.seg.inspect.base + ' 分</span></div>';

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
    /* ★ 拍照与相册拆成两个入口，不再只有一个「选择文件」。
       单放一个 accept="image/*" 的 input：安卓弹「相机 / 文件」二选一，多一步；
       iOS 直接给相册，现场想拍还得先退出。
       带 capture="environment" 的 input 会直接进后置摄像头，拍完即回页面；
       但它顶掉了相册入口，所以另给一个不带的，照片已在手机里时仍能选。
       透明 input 铺满整块 label：点哪儿都等价于点 input 本身，
       不依赖 label[for] 转发（部分 X5 内核对转发支持不稳）。 */
    h += '<div class="field"><label>佐证照片（可选，1 张）</label>';
    h += '<div class="photo-pick">';
    /* ★「拍照」是 <button> 不是 label+input：三星等内核会把 input 直接丢进系统相册，
       相册里没有拍照入口。改成点按钮 → getUserMedia 自己开摄像头取景。
       下面那个隐藏 input 只在相机不可用 / 授权被拒时兜底。 */
    h += '<button type="button" class="photo-cap" data-cam="' + key + '">拍照</button>';
    h += '<label class="photo-cap">从相册选<input type="file" accept="image/*" multiple data-photo="' + key + '"></label>';
    h += '</div>';
    h += '<input type="file" accept="image/*" capture="environment" data-photo="' + key + '" id="camfallback-' + key + '" style="display:none">';
    h += '<div class="photo-row" id="photos-' + key + '">';
    photos.forEach(function (p, i) {
      /* kb 是压缩后的真实体积（老草稿里的照片没有这个字段，就不显示）：
         检查人一眼能确认没超 500KB，不用等导出才发现被拒。 */
      var tip = '点击删除' + (p.kb ? ' · 已压缩 ' + p.kb + 'KB' : '');
      h += '<img class="thumb" src="' + p.data + '" alt="佐证照片" data-delphoto="' + key + '|' + i + '" title="' + esc(tip) + '">';
    });
    h += '</div></div>';
    h += '<button class="mini-btn" data-undo="' + (isVeto ? 'v' : 'i') + '|' + no + '">撤销扣分</button>';
    h += '</div>';
    return h;
  }

  /* ---------------- 照片压缩 ----------------
     ★ 目标是「单张 ≤ 500KB 的硬保证」，不是「长边 1280 + q0.75 大概能行」。
       科室要把照片导进金山在线表，超限的图会被拒；原实现没有字节校验，
       所以 ≤500KB 只是碰巧成立 —— 换一台手机、换一张原图就不成立。
     ★ 边长反而要从 1280 提到 1600：留证照片要能看清单据/表盘数字，
       500KB 的预算够用，先把像素给足，再靠质量档把体积压下来。 */

  var PHOTO_MAX_BYTE = 500 * 1024;                                  /* 单张上限 500KB */
  var PHOTO_MAX_EDGE = 1600;                                        /* 长边上限 */
  var PHOTO_Q = [0.82, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];            /* 质量档，从高到低试 */
  var PHOTO_SHRINK = 0.85, PHOTO_ROUNDS = 4;                        /* 质量见底后缩边重试 */
  var PHOTO_PER_ITEM = 1;                                           /* 每项 1 张：表里 N 列一格一张 */
  /* ★ 单张 500KB 换成「总量」也约束不住：73 项 × 3 张 × 500KB ≈ 100MB。
     不过现在不再打包，总量只用于「未配地址」时告知用户本机压了多少照片。 */
  var PHOTO_TOTAL_MAX = 30 * 1024;                               /* 历史阈值，仅文案参考 */

  /* 正在压缩、还没 push 进 S_.photos 的照片数（照片 key → 数量）。
     ★ 名额必须在「用户选中那一刻」就占用：压缩是异步的，若等 push 完再算剩余名额，
       同一 tick 里连发两次 change 会各自看到 length=0，两次都放行 3 张，最终存进 6 张。
     不挂在 S_.photos 上、也不进草稿序列化，归零即删除这个 key。 */
  var photoPending = {};

  /* base64 的真实字节数：每 4 个字符还原 3 字节，末尾每个 '=' 代表 1 个填充字节。
     不能用 (len - len/4*2) 之类的估算法，会少算，导致「以为刚好 500KB」其实超了。 */
  function b64Bytes(b64) {
    if (!b64) return 0;
    var pad = 0;
    if (b64.charAt(b64.length - 1) === '=') pad = b64.charAt(b64.length - 2) === '=' ? 2 : 1;
    return Math.floor(b64.length * 3 / 4) - pad;
  }

  /* 单次编码：成功返回 { data, bytes, w, h }，canvas 不可用/被拒时返回 null */
  function encodeJpeg(img, cv, ctx, w, h, q) {
    cv.width = w; cv.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    var data;
    try { data = cv.toDataURL('image/jpeg', q); } catch (e) { return null; }
    /* ★ canvas 尺寸超限或内存不足时，toDataURL 可能返回 'data:,' 而不抛错。
       不校验就会把一张空图存进照片数组，现场表现是「拍了照但导出里没有图」。 */
    if (!data || data.indexOf('data:image/jpeg') !== 0) return null;
    var b64 = data.split(',')[1] || '';
    if (b64.length < 64) return null;
    return { data: data, bytes: b64Bytes(b64), w: w, h: h };
  }

  /* 把一张已解码的 Image 压到 500KB 以内。src 三种来源共用这一份：
     相册选的文件（compress）、原生相机截的帧（compressDataUrl）。
     ★ fail 由调用方给：它要负责把「在途名额」还回去。 */
  function shrinkImage(img, cb, fail) {
    var cv = document.createElement('canvas');
    var ctx = cv.getContext('2d');
    var iw = img.width, ih = img.height;
    if (!ctx || !iw || !ih) { fail(); return; }

    var k = PHOTO_MAX_EDGE / Math.max(iw, ih);
    var w = k < 1 ? Math.round(iw * k) : iw;
    var h = k < 1 ? Math.round(ih * k) : ih;

    var best = null, round = 0, qi, r;
    while (round <= PHOTO_ROUNDS) {
      /* 同一尺寸下先把质量档逐格降到 0.5；还超说明瓶颈在像素量，再缩边重来 */
      for (qi = 0; qi < PHOTO_Q.length; qi++) {
        r = encodeJpeg(img, cv, ctx, w, h, PHOTO_Q[qi]);
        if (!r) { fail(); return; }
        best = r;
        if (r.bytes <= PHOTO_MAX_BYTE) break;
      }
      if (best.bytes <= PHOTO_MAX_BYTE) break;
      w = Math.max(1, Math.round(w * PHOTO_SHRINK));
      h = Math.max(1, Math.round(h * PHOTO_SHRINK));
      round++;
    }

    if (best.bytes > PHOTO_MAX_BYTE) {
      /* 兜底：超大原图 / canvas 有尺寸上限时可能真的压不进去。
         用最省的一档再出一张，并取两次里更小的那个 —— 绝不越压越大。
         同时明确告知，别让用户以为压缩失败了。 */
      var s = Math.min(1, 1200 / Math.max(w, h));
      var alt = encodeJpeg(img, cv, ctx, Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), 0.5);
      if (alt && alt.bytes < best.bytes) best = alt;
      toast('图片已压缩到最大程度');
    }

    cb({ data: best.data, w: best.w, h: best.h, kb: Math.round(best.bytes / 1024) });
  }

  function decodeInto(src, cb, fail) {
    var img = new Image();
    img.onload = function () { shrinkImage(img, cb, fail); };
    img.onerror = fail;
    img.src = src;
  }

  function compress(file, cb) {
    var fr = new FileReader();

    /* ★ 失败也要回调 cb(null)：调用方靠这个回调把「在途名额」还回去，
       漏了这一步，一张坏图会永久吃掉该照片 key 的一个位置。 */
    function fail() { toast('图片读取失败，请换一张'); cb(null); }

    fr.onload = function (e) { decodeInto(e.target.result, cb, fail); };
    fr.onerror = fail;
    fr.readAsDataURL(file);
  }

  /* 原生相机截出来的 dataURL 走这条：不经过 File / FileReader，省一次编码往返 */
  function compressDataUrl(dataUrl, cb) {
    decodeInto(dataUrl, cb, function () { toast('照片处理失败，请重拍'); cb(null); });
  }

  /* ---------------- 原生相机 ----------------
     ★ 为什么不再用 <input type="file" capture="environment">：
       三星浏览器（以及部分国产内核）会忽略 capture 属性，直接把点击交给系统相册，
       而相册界面里没有拍照入口 —— 现场等于拍不了照。这条路在三星上无解，
       因为 capture 只是个「建议」，浏览器可以不听。
     getUserMedia 不经过系统 Intent 分发，直接拿摄像头画面自己画，
     各家 Chromium 内核都支持；代价是首次要授权一次，被拒就退回相册选图。

     ★ 视频流必须显式停：不停的话摄像头指示灯常亮、耗电，下次 open 还可能黑屏。 */

  var camStream = null;
  var camKey = null;
  var camFacing = 'environment';   /* environment=后置，user=前置 */

  function camSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* 面板 DOM 现建现用：不在 score.html 里写死，避免所有页面都背一段用不到的标签 */
  function camEl() {
    var m = document.getElementById('camMask');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'camMask';
    m.className = 'cammask';
    m.innerHTML =
      '<video id="camVideo" playsinline autoplay muted></video>' +
      '<div class="cam-top">' +
      '<button type="button" class="cam-btn" id="camClose">关闭</button>' +
      '<button type="button" class="cam-btn" id="camFlip">翻转</button>' +
      '</div>' +
      '<div class="cam-tip">对准后点下方白色按钮拍照</div>' +
      '<div class="cam-bar">' +
      '<button type="button" class="cam-shutter" id="camShot" aria-label="拍照"></button>' +
      '</div>';
    document.body.appendChild(m);
    document.getElementById('camClose').addEventListener('click', closeCamera);
    document.getElementById('camFlip').addEventListener('click', function () {
      camFacing = camFacing === 'environment' ? 'user' : 'environment';
      startCamera().catch(function () {
        camFacing = camFacing === 'environment' ? 'user' : 'environment';
        toast('这台设备没有另一个摄像头');
      });
    });
    document.getElementById('camShot').addEventListener('click', shoot);
    return m;
  }

  function stopStream() {
    if (camStream) {
      try { camStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
      camStream = null;
    }
    var v = document.getElementById('camVideo');
    if (v) {
      try { v.pause(); } catch (e) { }
      try { v.srcObject = null; } catch (e) { }
    }
  }

  function startCamera() {
    stopStream();
    var video = document.getElementById('camVideo');
    if (!video) return Promise.reject(new Error('no video'));
    /* ideal 而不是 exact：低端机给不出 1920 时不要直接失败 */
    var opt = {
      audio: false,
      video: { facingMode: camFacing, width: { ideal: 1920 }, height: { ideal: 1080 } }
    };
    return navigator.mediaDevices.getUserMedia(opt).then(function (s) {
      camStream = s;
      video.srcObject = s;
      var p = video.play();
      if (p && p.catch) p.catch(function () { });   /* 自动播放被拦不影响手动出图 */
      return true;
    });
  }

  function closeCamera() {
    stopStream();
    var m = document.getElementById('camMask');
    if (m) m.classList.remove('on');
    camKey = null;
  }

  function openCamera(k) {
    if (!S_.photos[k]) S_.photos[k] = [];
    /* 名额要先卡：面板开着的时候用户没法删已有照片，进去拍完才发现超限最气人 */
    if (S_.photos[k].length + (photoPending[k] || 0) >= PHOTO_PER_ITEM) {
      toast('每项最多 ' + PHOTO_PER_ITEM + ' 张，请先删掉不要的');
      return;
    }
    camKey = k;
    camEl().classList.add('on');
    startCamera().catch(function (err) {
      closeCamera();
      var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      toast(denied ? '相机权限被拒绝，改从相册选' : '这台浏览器打不开相机，改从相册选');
      var fb = document.getElementById('camfallback-' + k);
      if (fb) fb.click();
    });
  }

  function shoot() {
    var v = document.getElementById('camVideo');
    var k = camKey;
    if (!v || !k) return;
    var w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) { toast('相机还没准备好，请稍等一下再拍'); return; }

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    if (!ctx) { toast('截图失败，请重拍'); return; }
    /* 前置摄像头画面是镜像的，出图要翻回来，否则文字左右颠倒 */
    if (camFacing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, 0, 0, w, h);

    var dataUrl;
    try { dataUrl = cv.toDataURL('image/jpeg', 0.92); } catch (e) { dataUrl = ''; }
    /* 同 encodeJpeg 的坑：内存不足时 toDataURL 可能返回 'data:,' 而不抛错 */
    if (!dataUrl || dataUrl.indexOf('data:image/jpeg') !== 0) {
      toast('截图失败，请重拍'); return;
    }

    closeCamera();   /* 先关再压：压缩可能要一两秒，不该让人一直盯着取景框 */

    photoPending[k] = (photoPending[k] || 0) + 1;
    compressDataUrl(dataUrl, function (r) {
      photoPending[k] = (photoPending[k] || 1) - 1;
      if (!photoPending[k]) delete photoPending[k];
      if (!r) return;
      if (!S_.photos[k]) S_.photos[k] = [];
      S_.photos[k].push({ name: '现场拍照.jpg', data: r.data, w: r.w, h: r.h, kb: r.kb });
      refresh(); scheduleSave();
    });
  }

  /* 只统计「当前仍是扣分 / 否决」项的照片总量（KB）。
     ★ 撤销扣分后照片仍留在 S_.photos 里（用户可能改回来，不该删他的图），但 generate()
       只把 === 'no' 的项写进 zip，撤销掉的并不进包。这里若全量累加，撤销掉的照片会白占
       额度，把人误拦在 30MB 闸外。
     老草稿里的照片没有 kb 字段，按 base64 长度折算：每 4 个字符 3 字节，
     前缀 'data:image/jpeg;base64,' 忽略不计 —— 宁可算大不算法小。
     照片 key 的约定：扣分项用项号本身，否决项用 'v' + 否决号（与 deductHtml 一致）。 */
  function photoTotalKB() {
    var total = 0;
    function add(key) {
      (S_.photos[key] || []).forEach(function (p) {
        if (!p || !p.data) return;
        total += p.kb ? p.kb : (p.data.length * 3 / 4) / 1024;
      });
    }
    for (var no in S_.items) {
      if (Object.prototype.hasOwnProperty.call(S_.items, no) && S_.items[no] === 'no') add(no);
    }
    for (var vn in S_.veto) {
      if (Object.prototype.hasOwnProperty.call(S_.veto, vn) && S_.veto[vn] === 'no') add('v' + vn);
    }
    return total;
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
      var dc = t.getAttribute && t.getAttribute('data-cam');
      if (dc) { openCamera(dc); return; }
    });

    $('app').addEventListener('input', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-note');
      if (k) { S_.notes[k] = { reason: e.target.value }; scheduleSave(); }
    });

    $('app').addEventListener('change', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-photo');
      if (!k || !e.target.files) return;
      if (!S_.photos[k]) S_.photos[k] = [];

      /* ★ 原来只 slice(0,3) 限「这一次选几张」，跨次累加不受限，第 4、5 次还能继续加，
         与界面上「最多 3 张」的承诺不符。改成按该项已有张数算剩余名额。 */
      var picked = Array.prototype.slice.call(e.target.files, 0);
      e.target.value = '';   /* 先清空，否则同一张照片重选不会再触发 change */

      /* 剩余名额 = 上限 − 已存张数 − 在途张数。在途那一项是关键：
         压缩还没回来时，照片虽未 push，名额也已经被占住了。 */
      var room = PHOTO_PER_ITEM - S_.photos[k].length - (photoPending[k] || 0);
      if (room <= 0) {
        toast(S_.photos[k].length >= PHOTO_PER_ITEM
          ? '每项最多 ' + PHOTO_PER_ITEM + ' 张，请先删掉不要的'
          : '已选满 ' + PHOTO_PER_ITEM + ' 张，照片还在压缩，请稍候');
        return;
      }
      if (picked.length > room) {
        toast('每项最多 ' + PHOTO_PER_ITEM + ' 张，已忽略 ' + (picked.length - room) + ' 张');
      }
      picked.slice(0, room).forEach(function (f) {
        photoPending[k] = (photoPending[k] || 0) + 1;
        compress(f, function (r) {
          /* 成功与失败都要把在途名额还回去；归零就删掉这个 key，不留空壳 */
          photoPending[k] = (photoPending[k] || 1) - 1;
          if (!photoPending[k]) delete photoPending[k];
          if (!r) return;   /* 压缩失败已在 compress 里 toast，既不占张数也不占名额 */
          /* data 字段名不能改：generate() 靠 p.data.split(',')[1] 取原始字节写进 zip。
             w/h/kb 只用于界面提示，帮检查人确认这张真的压到 500KB 以内了。 */
          S_.photos[k].push({ name: f.name, data: r.data, w: r.w, h: r.h, kb: r.kb });
          refresh(); scheduleSave();
        });
      });
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
    $('barSub').textContent = '→ 运营段 ' + res.score.toFixed(2) + '/' + C.seg.inspect.base + ' · 已扣 ' + deducted + ' 项' +
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
    b += '<div class="kv kv--total"><span>折算得分</span><b>' + res.converted.toFixed(2) + ' / 100 → 运营段 ' + res.score.toFixed(2) + ' / ' + C.seg.inspect.base + '</b></div>';
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

  /* ---------------- 直落金山表 ----------------
     提交不再打包下载：把 73 项结果 + 扣分原因 + 佐证照片一次性 POST 给金山文档里
     那段 AirScript 的 webhook，由它在服务器端写「检查明细」，照片列写 =IMAGE(直链)。
     网址与令牌不入源码 —— 存在本机 localStorage，首次提交时填一次。

     ★ 为什么令牌不写进 JS：这个页面是公开的 GitHub Pages，源码谁都能看。
       AirScript-Token 是全账号级凭据（能读写你名下所有金山文档），
       写进源码等于公开它。而检查人是十几个人、十几台手机 ——
       直连模式等于把这个令牌复制十几份，任一台丢失都等于交出整个账号。
       所以正式用法是走中转（tools/worker/relay.js）：令牌只在服务端，
       地址不含密钥，写进 config.js 后所有检查人打开就能提交，各自都不用配。 */

  var REPORT_KEY = 'kaohe_report_cfg';

  function reportCfg() {
    var local = {};
    try { local = JSON.parse(localStorage.getItem(REPORT_KEY) || '{}') || {}; } catch (e) { }
    var def = (C && C.report) || {};
    return { url: local.url || def.url || '', token: local.token || def.token || '' };
  }

  function saveReportCfg(url, token) {
    localStorage.setItem(REPORT_KEY, JSON.stringify({ url: url, token: token }));
  }

  function showReportSetup(tip) {
    var cfg = reportCfg();
    var b = '<div class="sheet__grip"></div><h3>一次性设置</h3>';
    b += '<div class="hint">本机首次提交前，把「提交地址」填一次即可。只存这台手机，不写进网页源码。' +
      '若走中转服务，令牌留空——它在中转端，手机不需要。</div>';
    if (tip) b += '<div class="err">' + esc(tip) + '</div>';
    b += '<div style="margin:14px 0 6px;font-size:13px;color:#666">提交地址</div>';
    b += '<input id="rpUrl" type="url" placeholder="https://…/sync_task 或 中转服务地址" ' +
      'value="' + esc(cfg.url) + '" style="width:100%;padding:11px;border:1px solid #ddd;border-radius:8px;font-size:14px">';
    b += '<div style="margin:14px 0 6px;font-size:13px;color:#666">脚本令牌（走中转可留空）</div>';
    b += '<input id="rpTok" type="text" placeholder="AirScript-Token" value="' + esc(cfg.token) + '" ' +
      'style="width:100%;padding:11px;border:1px solid #ddd;border-radius:8px;font-size:14px">';
    b += '<div class="hint" style="margin-top:12px">取法：打开「考核工作台数据源」→ 效率 → 高级开发 → ' +
      'AirScript 脚本编辑器 → 工具栏「脚本令牌」创建；脚本列表里该脚本的 ··· → 复制 webhook 链接。</div>';
    b += '<div class="sheet__acts"><button class="btn btn--ghost" onclick="closeSheet()">取消</button>' +
      '<button class="btn btn--primary" id="rpSave">保存并提交</button></div>';
    showSheet(b);
    $('rpSave').addEventListener('click', function () {
      var u = $('rpUrl').value.trim(), t = $('rpTok').value.trim();
      /* 直连金山才必须要令牌；走中转时令牌在中转端，留空即可 */
      if (!u) { toast('请填提交地址'); return; }
      if (/\/api\/v3\/ide\//.test(u) && !t) { toast('直连金山时必须填脚本令牌'); return; }
      saveReportCfg(u, t);
      closeSheet();
      setTimeout(function () { onSubmit(); }, 120);
    });
  }

  /* 73 项全量上传（不只是扣分项）：脚本要拿全部标准分才能算准折算分，
     只传扣分项的话分母凑不出 100，运营段会算错。 */
  function buildPayload(res, veto) {
    var items = DATA.items.map(function (it) {
      var a = S_.items[it.no] || 'ok';
      return {
        no: it.no, cat: it.cat, name: it.name, std: it.score,
        res: a, note: (S_.notes[it.no] || {}).reason || ''
      };
    });
    var photos = [];
    function collect(no, arr) {
      /* 每项只取第 1 张：表里 N 列一格只能放一张，多传的白占请求体。
         老草稿可能还存着 3 张（v6-9 及以前允许），这里统一截断，
         不去动本机已存的照片 —— 用户自己决定删不删。 */
      var p = (arr || [])[0];
      if (!p || !p.data) return;
      var m = /^data:([^;]+)/.exec(p.data);
      photos.push({ no: no, name: p.name || '', data: p.data, mime: m ? m[1] : 'image/jpeg' });
    }
    DATA.items.forEach(function (it) { collect(it.no, S_.photos[it.no]); });
    DATA.veto.forEach(function (v) { collect('v' + v.no, S_.photos['v' + v.no]); });

    /* 一票否决也要单独落行：序号写 v1…v6。不落行的话它的照片在明细里没有落点，
       而且 record_sync.py 的「一票否决项」列会读不到。 */
    var vetoItems = [];
    DATA.veto.forEach(function (v) {
      if (S_.veto[v.no] !== 'no') return;
      vetoItems.push({
        no: 'v' + v.no, name: v.name,
        note: (S_.notes['v' + v.no] || {}).reason || ''
      });
    });

    return {
      station: S_.station, month: S_.month, inspector: USER.name,
      submittedAt: fmt(new Date()), type: '运营检查',
      items: items, veto: veto.failed, vetoItems: vetoItems, photos: photos
    };
  }

  function submitOnline(res, veto) {
    var cfg = reportCfg();
    if (!cfg.url) { showReportSetup(); return; }

    var payload = buildPayload(res, veto);
    var nPic = payload.photos.length;
    showSheet('<div class="sheet__grip"></div><h3>正在提交</h3>' +
      '<div class="hint" id="subHint">正在上传 ' + nPic + ' 张照片并写入金山表格，请勿关闭页面…</div>');

    var body = JSON.stringify({ Context: { argv: { payload: payload } } });

    /* ★ 上限 5MB，不是随便定的：
       走腾讯云函数中转时，SCF 同步调用的「请求事件」硬上限是 6MB
       （官方文档 Sync request event size 6 MB），超了直接返回 RequestTooLarge。
       照片在 JSON 里是 base64，体积膨胀 1/3，所以 5MB 的 body 对应约 3.7MB 原始照片，
       大约 7 张 500KB 的图 —— 再多就得删图或分两次提交。
       直连金山时这条闸也一样生效，反正金山自己也不喜欢大包。 */
    var mb = body.length / 1048576;
    if (mb > 5) {
      showSheet('<div class="sheet__grip"></div><h3>照片太多</h3>' +
        '<div class="warn" style="margin:0 0 12px">本次合计约 <b>' + mb.toFixed(1) + 'MB</b>，超过单次提交 5MB 上限。</div>' +
        '<div class="hint">删掉几张不关键的佐证照片再提交；或者分两次检查、分两次提交' +
        '（同站同月以最新一次为准，第二次会覆盖第一次）。</div>' +
        '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">返回修改</button></div>');
      return;
    }

    /* ★ 2026-11-20 抬到 150 秒：中转变成了「异步提交 + 轮询」，函数超时设的是
       120 秒。客户端若还停在 120 秒，就会出现「服务端刚要回包、页面先掐断」，
       白白把一次成功判成超时。150 秒 = 120 秒函数 + 30 秒网络余量。 */
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, CLIENT_WAIT_MS) : null;

    /* 直连金山：地址里带 /api/v3/ide/，必须带脚本令牌。
       走中转（Worker / 自建服务）：令牌与 GitHub 令牌都在中转端，手机端一律不带。
       这样即使网页源码公开、手机丢了，也拿不到能操作全部金山文档的凭据。 */
    var direct = /\/api\/v3\/ide\//.test(cfg.url);
    var hdrs = { 'Content-Type': 'application/json' };
    if (direct) hdrs['AirScript-Token'] = cfg.token;

    fetch(cfg.url, {
      method: 'POST',
      headers: hdrs,
      body: body,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.text();
    }).then(function (txt) {
      var outer = {};
      try { outer = JSON.parse(txt) || {}; } catch (e) { }
      /* 金山的外层是 {code, data:{result:"<脚本 return 的字符串>"}}；result 可能是字符串也可能已是对象 */
      var inner = outer;
      if (outer && outer.data) {
        var r0 = outer.data.result;
        if (typeof r0 === 'string') {
          try { inner = JSON.parse(r0) || { ok: false, error: r0 }; }
          catch (e) { inner = { ok: false, error: r0 }; }
        } else if (r0 && typeof r0 === 'object') {
          inner = r0;
        }
      }
      if (inner && inner.ok) { submitOk(inner); return; }
      /* ★ 2026-11-20：中转等不到脚本结果时回 pending，不是失败。
         script 已经跑起来了，表里很可能已经有数据，报「没能落表」会误导人去重复提交。 */
      if (inner && inner.pending) { submitPending(inner.error || '金山返回：处理中'); return; }
      /* 金山的 sync_task 老毛病：脚本执行完毕、数据已落表，但同步接口回了 500
         {"errno":10000,...,"result":"Unavailable"}。这是「耗时过长」不是「失败」。 */
      if ((inner && inner.errno === 10000) || /"Unavailable"/.test(txt)) {
        submitPending('金山同步接口回报：' + txt.substring(0, 200));
        return;
      }
      submitFail((inner && (inner.error || (inner.log || []).join(' | '))) || txt.substring(0, 300));
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      /* 浏览器把它们拦在门外时请求其实可能已经到了金山 —— 不能断言"没提交" */
      var why = (e && e.name === 'AbortError') ? '等待超时（' + (CLIENT_WAIT_MS / 60000) + ' 分钟）' : ((e && e.message) || String(e));
      submitFail('连不上：' + why +
        '\n\n可能是浏览器跨域拦截。请把这个地址用系统浏览器（不是微信里）再打开一次重试；' +
        '若金山表格里已经出现本站本月记录，说明其实已经落表，不要重复提交。');
    });
  }

  function submitOk(inner) {
    S.removeDraft(S_.station + '|' + S_.month);
    var b = '<div class="sheet__grip"></div><h3>已落表</h3>';
    b += '<div class="kv"><span>油站 / 月份</span><b>' + esc(inner.station) + ' · ' + esc(inner.month) + '</b></div>';
    b += '<div class="kv"><span>折算得分</span><b>' + Number(inner.converted).toFixed(2) + ' / 100</b></div>';
    b += '<div class="kv kv--total"><span>运营段</span><b>' + Number(inner.op).toFixed(2) + ' / ' + C.seg.inspect.base + '</b></div>';
    b += '<div class="kv"><span>写入行数</span><b>' + inner.rows + ' 行' +
      (inner.photos ? ' · ' + inner.photos + ' 张照片已入表' : '') + '</b></div>';
    if (inner.log && inner.log.length) {
      b += '<div class="hint" style="margin-top:12px;font-size:12px;line-height:1.7">' +
        inner.log.map(esc).join('<br>') + '</div>';
    }
    b += '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">完成</button></div>';
    showSheet(b);
  }

  /* ★ 结果未确认：数据可能已经落表，只是没等到回执。
     这一屏刻意不用红色「失败」样式 —— 现场用户看到红字第一反应就是再交一次。
     也不清草稿：万一真没落表，回来点一下就能重交。 */
  function submitPending(msg) {
    var b = '<div class="sheet__grip"></div><h3>已提交 · 结果未确认</h3>';
    b += '<div class="warn" style="margin:0 0 12px">金山那边返回得比预期慢，页面没等到回执。' +
      '<b>数据大概率已经写进表了，先别重复提交。</b></div>';
    b += '<div class="err" style="white-space:pre-wrap;max-height:120px;overflow:auto">' + esc(msg) + '</div>';
    b += '<div class="hint" style="margin-top:10px">怎么确认：打开「检查明细」，看本站本月有没有这次的记录。' +
      '<br>· <b>有</b> → 直接关掉，不用再交' +
      '<br>· <b>没有</b> → 回来再点一次提交（同站同月以最新一次为准，重复交不会多出一行）</div>';
    b += '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">知道了</button></div>';
    showSheet(b);
  }

  function submitFail(msg) {
    var b = '<div class="sheet__grip"></div><h3>没能落表</h3>';
    b += '<div class="err" style="white-space:pre-wrap">' + esc(msg) + '</div>';
    b += '<div class="hint">打分内容仍在本机草稿里，不会丢。修好后可以再点一次提交。</div>';
    b += '<div class="sheet__acts"><button class="btn btn--ghost" id="reCfg">改设置</button>' +
      '<button class="btn btn--primary" onclick="closeSheet()">返回</button></div>';
    showSheet(b);
    if ($('reCfg')) $('reCfg').addEventListener('click', function () { showReportSetup(); });
  }

  /* ★ 不再需要 isHandset()：zip 这条路已经整条砍掉，桌面端也不出 zip 了，
     提交只剩「直落金山表」一条。为什么砍见下面 generate() 的注释。 */

  /* 文件名时间戳：本地时间到秒，用于避免同名覆盖 */
  function stampNow() {
    var ts = new Date();
    return ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) +
      pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds());
  }

  /* ★ 提交只有一条路：直落金山表（2026-11-19 定）。
     同一天把「打包 zip → 科室导入」整条砍掉了，理由三条：
       ① 照片本来就能走 Range.InsertImage 直接落进「检查明细」的 N 列，
          让人先下载再导入纯属多余；
       ② 安卓上 zip 根本落不了地 —— 系统会弹「未安装可打开该链接的应用」；
       ③ 双轨并行时，检查人分不清哪条是正路，反而更容易漏交。
     现在没配地址时只提示去配，另给一份不含照片的 Excel 应急（见 showNoTarget）。 */
  function generate(res, veto) {
    if (reportCfg().url) { submitOnline(res, veto); return; }
    showNoTarget(res, veto);
  }

  /* ★ 手机端没配直落表时的落点。
     原来这种情况会直接打包成一个 zip 让人下载 —— 结果就是安卓弹「未安装可打开该
     链接的应用」，用户以为提交失败，其实分数还好端端躺在本机草稿里。
     现在改成把情况说明白，并且只给两条真能走通的路：
       ① 去设置：填上提交地址，从此点提交直接写金山表（照片也跟着进，不用下载）
       ② 只导 Excel：出一个 .xlsx，WPS 能直接打开看，先应急
     照片不塞进 xlsx —— SheetJS 社区版不支持嵌图，硬塞会得到一个假成功。
     这一点必须写进文案，否则用户会以为「导出了就代表照片也交了」。 */
  function showNoTarget(res, veto) {
    var totalKB = photoTotalKB();
    var b = '<div class="sheet__grip"></div><h3>还没连上金山表</h3>';
    b += '<div class="hint">本机没填「提交地址」，分数只能先存在这台设备上。' +
      '配一次之后，点提交就直接写进金山「检查明细」，<b>照片会作为真图片嵌进对应单元格</b>，' +
      '不用下载、不用导入、也不用发微信。</div>';

    if (totalKB > 0) {
      b += '<div class="warn" style="margin:10px 0 0">本机已拍 <b>' +
        (totalKB / 1024).toFixed(1) + 'MB</b> 佐证照片。' +
        '<b>导出的 Excel 不会带上照片</b>（Excel 文件本身装不了图）——' +
        '照片只有走直落表才会进表。所以除非网断了要留个底，否则建议直接配地址提交。</div>';
    }

    b += '<div class="sheet__acts">' +
      '<button class="btn btn--ghost" id="ntXlsx">先存一份 Excel</button>' +
      '<button class="btn btn--primary" id="ntCfg">去设置</button></div>';
    showSheet(b);
    $('ntCfg').addEventListener('click', function () { showReportSetup(); });
    $('ntXlsx').addEventListener('click', function () { exportXlsxOnly(res, veto); });
  }

  /* 应急出口：单文件 .xlsx，不含照片。
     它不是「导入用的中间文件」，只是分数万一交不上时给人看一眼的存档。 */
  function exportXlsxOnly(res, veto) {
    var ts = new Date();
    var base = '检查表_' + S_.station + '_' + S_.month + '_' + stampNow();

    showSheet('<div class="sheet__grip"></div><h3>正在生成</h3>' +
      '<div class="hint">正在准备表格，请稍候…</div>');

    loadVendor().then(function () {
      try {
        var wb = buildWorkbook(res, veto, ts);
        /* type:'array' 直接给字节数组，省掉 base64 再解码的一来一回 */
        var buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        var blob = new Blob([buf], { type: XLSX_MIME });
        offerExport(blob, base, '检查表 ' + S_.station + ' ' + S_.month);
      } catch (e) { packFail(e); }
    }).catch(function (e) {
      showSheet('<div class="sheet__grip"></div><h3>表格组件未就绪</h3>' +
        '<div class="err">' + esc(e.message) + '</div>' +
        '<div class="hint">请联网打开一次本页，让浏览器缓存组件后再试；打分内容已存本机草稿，不会丢失。</div>' +
        '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">返回填写</button></div>');
    });
  }

  function packFail(err) {
    showSheet('<div class="sheet__grip"></div><h3>生成失败</h3><div class="err">' + esc(err.message) + '</div>' +
      '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">关闭</button></div>');
  }

  /* ---------------- 导出下载 ----------------
     ★ 安卓上 a[download] 不是可靠下载：微信 / 企业微信 / QQ 的 X5 内核会把 blob: 链接当成
       普通超链接交给系统 Intent 去「打开」，系统里没有认领该类型的应用，
       于是弹出「未安装可打开该链接的应用」。那条提示是**手机系统**弹的，不是本页弹的。
       同一段代码里又一个字都没校验下载结果，所以「实际失败却报成功」是必然。
       这里改成「系统分享 → 内置浏览器提示 → a[download] → 手动兜底」四级降级，
       并且只把确定发生的事写进提示文案。

     ★ 2026-11-19 追加：MIME 不能一律打成 octet-stream。
       octet-stream 的含义就是「不知道是什么」，安卓拿到它只会去找「通用下载器」，
       找不到就弹「未安装可打开该链接的应用」—— 这正是用户看到的。
       改成按扩展名给真 MIME：.xlsx 用官方类型，系统才会把它派给 WPS 打开。
       .zip 仍然只能是 octet-stream（没有更好的），但手机端已不再产出 zip。 */

  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function mimeFor(filename, fallback) {
    var n = String(filename || '').toLowerCase();
    if (/\.xlsx$/.test(n)) return XLSX_MIME;
    if (/\.zip$/.test(n)) return 'application/octet-stream';
    return fallback || 'application/octet-stream';
  }

  function inAppBrowser() {
    var u = navigator.userAgent || '';
    /* 只拦 App 内置浏览器；MQQBrowser（独立 QQ 浏览器）自己有下载器，不拦 */
    return /MicroMessenger/i.test(u) || /wxwork/i.test(u) || /QQ\//i.test(u);
  }

  function typedBlob(blob, filename) {
    try { return new Blob([blob], { type: mimeFor(filename, blob.type) }); } catch (e) { return blob; }
  }

  function saveViaLink(blob, filename) {
    var url;
    try { url = URL.createObjectURL(typedBlob(blob, filename)); } catch (e) { return false; }
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    try { a.click(); } catch (e) {
      if (a.parentNode) a.parentNode.removeChild(a);
      try { URL.revokeObjectURL(url); } catch (e2) { }
      return false;
    }
    /* ★ 60 秒后才回收对象 URL：低端安卓上「点下去」到「真正开始读数据」可能隔好几秒，
       原来 1.5 秒就 revokeObjectURL 会把下载掐断，表现就是「点了没反应」。
       60 秒后即使还没下完，浏览器通常已把数据接过去，撤回是安全的。 */
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      try { URL.revokeObjectURL(url); } catch (e) { }
    }, 60000);
    return true;
  }

  /* done 只会被调用一次，取值：
     shared   系统分享面板真的走完了（唯一确定的成功）
     download 下载请求已交给浏览器（但它不回话，不能算确定落盘）
     inapp    微信 / 企业微信 / QQ 内置浏览器，注定存不了文件
     cancel   用户自己关掉了分享面板，不是故障
     manual   连对象 URL 都建不出来，只能手动兜底 */
  function downloadBlob(blob, filename, title, done) {
    var settled = false;
    function settle(r) { if (settled) return; settled = true; done(r); }

    function byLink() {
      /* 内置浏览器做无效点击只会再弹一次系统报错，不如直接告诉用户换浏览器 */
      if (inAppBrowser()) { settle('inapp'); return; }
      settle(saveViaLink(blob, filename) ? 'download' : 'manual');
    }

    var file = null;
    try { file = new File([blob], filename, { type: mimeFor(filename, blob.type) }); } catch (e) { file = null; }

    if (file && navigator.canShare && navigator.share) {
      var can = false;
      try { can = navigator.canShare({ files: [file] }); } catch (e) { can = false; }
      if (can) {
        /* ★ 分享面板是移动端最顺的路径：用户可以直接选微信，把文件发回计划经营科。
           Chrome 要求 share() 处在用户手势内，而打包耗时会把那个手势磨掉，于是可能抛
           NotAllowedError —— 这不是故障，退回下载即可；结果面板上的「重新导出」按钮
           在真正的手势里，会重新完整走一遍分享。 */
        navigator.share({ files: [file], title: title }).then(function () {
          settle('shared');
        }).catch(function (err) {
          if (err && err.name === 'AbortError') { settle('cancel'); return; }
          byLink();
        });
        return;
      }
    }
    byLink();
  }

  /* 结果面板：文件没到手之前，绝不说「已下载」。
     现在只出一种文件：单文件 .xlsx（不含照片）。zip 那条路已砍。
     ★ 草稿一律不清：xlsx 里没有照片，一删草稿照片就永久没了。 */
  function offerExport(blob, base, title) {
    var filename = base + '.xlsx';
    var draftKey = S_.station + '|' + S_.month;

    /* 文件名单独放一块、可选可长按：万一下载通道全都不通，这是唯一能让用户把
       文件信息带走的兜底（让科室按名字去问、或换设备重导）。 */
    function nameBlock() {
      return '<div style="margin-top:10px;padding:10px 12px;border:1px dashed var(--line-hi);' +
        'border-radius:10px;font:12px/1.6 ui-monospace,Consolas,monospace;' +
        'word-break:break-all;user-select:text;-webkit-user-select:text">' + esc(filename) + '</div>';
    }

    function again() {
      /* ★ 直接复用闭包里的 blob —— 那是同一次生成的产物，重发不必再生成一遍。
         这也正是把 blob 放在闭包而不是模块作用域的理由：面板一销毁，引用自然消失，
         产物不会常驻内存。 */
      showSheet('<div class="sheet__grip"></div><h3>正在导出</h3>' +
        '<div class="hint">正在唤起系统分享 / 下载，请稍候…</div>');
      downloadBlob(blob, filename, title, show);
    }

    function show(r) {
      /* ★ 用户自己关掉分享面板不是失败：照旧保草稿，但给一个就地重试的入口，
         重试走的是同一个 blob，不会再生成一遍。 */
      var h = '<div class="sheet__grip"></div>';
      if (r === 'shared') {
        h += '<h3>已调起分享</h3><div class="hint">选<b>微信</b>发给计划经营科即可，文件是：</div>' + nameBlock();
        h += '<div class="hint">这份 Excel <b>不含照片</b>，所以本机草稿先留着 ——' +
          '照片还在手机上，需要的话另行用微信发给科室。</div>';
      } else if (r === 'download') {
        /* ★ 这里不清草稿：下载是否真的落盘，浏览器不回话（就是这次要修的坑）。
           拿「发了下载请求」当成功去删草稿，一旦静默失败就是「文件没到手、数据也没了」。 */
        h += '<h3>文件已交给浏览器</h3>';
        h += '<div class="hint">通常会在通知栏提示下载完成，也可以到「下载」或「文件管理」里找。' +
          '点开时如果问用哪个应用打开，选 <b>WPS</b>。</div>' + nameBlock();
        h += '<div class="hint">如果又弹「未安装可打开该链接的应用」，说明这台浏览器存不了文件，' +
          '换 Chrome 或手机自带浏览器重新导出即可。本次草稿先留着。</div>';
        toast('草稿先留着，不用现在清理');
      } else if (r === 'cancel') {
        h += '<h3>已取消分享</h3><div class="hint">文件没有发出，打分已存本机草稿，不会丢。可以直接再发一次：</div>' + nameBlock();
      } else if (r === 'inapp') {
        h += '<h3>这个浏览器存不了文件</h3>' +
          '<div class="err">当前是微信 / 企业微信 / QQ 的内置浏览器。它会把这个文件当超链接交给手机系统去打开，' +
          '系统里没有对应应用，于是弹「未安装可打开该链接的应用」——那一条是手机系统弹的。</div>' +
          '<div class="hint">请点右上角 <b>···</b> → <b>在浏览器打开</b>，再回到本页重新导出。' +
          '本次打分已存在本机草稿里，不会丢，换浏览器打开后会提示「已恢复上次草稿」。</div>' + nameBlock();
      } else {
        h += '<h3>没能保存</h3><div class="hint">这台机器的浏览器既不能分享也不能直接存文件。' +
          '请长按复制下面的文件名交给科室，或换用手机自带浏览器重新导出：</div>' + nameBlock();
      }

      /* 内置浏览器 / 建不出链接时，重试注定同样失败，不给假希望 */
      if (r === 'inapp' || r === 'manual') {
        h += '<div class="sheet__acts"><button class="btn btn--primary" id="expClose">知道了</button></div>';
      } else if (r === 'cancel') {
        h += '<div class="sheet__acts"><button class="btn btn--ghost" id="expClose">稍后再说</button>' +
          '<button class="btn btn--primary" id="expAgain">重新分享</button></div>';
      } else {
        h += '<div class="sheet__acts"><button class="btn btn--ghost" id="expClose">关闭</button>' +
          '<button class="btn btn--primary" id="expAgain">重新导出</button></div>';
      }
      showSheet(h);
      $('expClose').addEventListener('click', function () { window.closeSheet(); });
      if ($('expAgain')) $('expAgain').addEventListener('click', again);
    }

    /* 不额外插一个等待面板：首次进来脚本已经在显示「正在打包」，
       「重新导出」那条路径由 again() 自己先铺一个等待面板 */
    downloadBlob(blob, filename, title, show);
  }

  function buildWorkbook(res, veto, ts) {
    var aoa = [];
    aoa.push(['二级运营检查评分表（V6 · 目标责任考核 V1.0）']);
    aoa.push([]);
    aoa.push(['油站', S_.station, '会计月', S_.month]);
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
    aoa.push(['第二部分　运营检查（100 分制 → 折算 ' + C.seg.inspect.base + ' 分）']);
    aoa.push(['大类', '序号', '检查项目', '检查内容', '检查方法', '判定标准', '标准分', '得分', '原因', '照片数']);
    DATA.items.forEach(function (it) {
      var a = S_.items[it.no];
      aoa.push([it.cat, it.no, it.name, it.content, it.method, it.std, it.score,
        a === 'ok' ? it.score : a === 'na' ? 'NA' : 0,
        (S_.notes[it.no] || {}).reason || '', (S_.photos[it.no] || []).length]);
    });
    aoa.push([]);
    aoa.push(['实得小计', res.raw, 'NA 项标准分', res.naScore,
      '有效项总分', res.effective, '折算得分/100', res.converted, '运营段/' + C.seg.inspect.base, res.score]);
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
