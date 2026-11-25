/* ==========================================================================
 * 现场打分 · 直落表   score_write.js   v1.2   （2026-11-25 换版：80 项题库）
 *
 * 运行位置：金山文档「考核工作台数据源（V2.1）.xlsx」→ 效率 → 高级开发
 *           → AirScript 脚本编辑器（JS 脚本，不是 PY 脚本）
 *
 * 触发方式：手机打分页 POST 该脚本的 webhook 链接
 *   地址形如 https://www.kdocs.cn/api/v3/ide/file/{fileId}/script/{scriptId}/sync_task
 *   请求头必须带 AirScript-Token
 *
 * 请求体：
 *   { "Context": { "argv": {
 *       station:   "韩城东",
 *       month:     "2026-11",
 *       inspector: "张三",
 *       submittedAt: "2026-11-18 21:30",
 *       type:      "运营检查",
 *       items:  [ {no:1, cat:"...", name:"...", std:2, res:"ok"|"no"|"na", note:"扣分原因"} ... ],  // 全 80 项
 *       veto:   [ "散装汽油销售管控" ],                    // 触发的一票否决项名称，没有就空数组
 *       photos: [ {no:5, name:"IMG_001.jpg", data:"<纯base64>", mime:"image/jpeg"} ... ]
 *   } } }
 *
 * 做的事：
 *   1. 按「以最新为准」重写「检查明细」里该站该月的行（19 列），★ 逐行赋值，
 *      不用 `Range('A2:S'+n).Value2 = 二维数组`（真表上只认第一行，且不报错）
 *   2. 照片走 cell 模式：Range('N'+r).InsertImage(base64)，真图片嵌在格子里
 *   3. 零扣分站也写一行占位（序号留空），否则 record_sync 判为「未检查」白丢 28 分
 *   4. 返回 JSON 给手机页
 *
 * ★ 为什么用 InsertImage 而不是 =IMAGE(直链)：
 *   =IMAGE 需要公网直链 + 文档级授权，没授权就 #BLOCKED!；
 *   InsertImage 直接吃 base64，不依赖网络、不需要授权，是本脚本的默认路径。
 *   老的 'url' 模式（推 GitHub 拿直链）保留但已不用，CFG.TOKEN 已清空。
 *
 * ★ 末尾的 main(); 不能删 —— 金山是「执行整个脚本」，不调用等于空跑。
 * ========================================================================== */

var CFG = {
  SHEET_DETAIL: '检查明细',
  INSPECT_BASE: 28,          /* 运营检查段满分（V6） */
  MAX_ROWS: 4000,            /* 明细表扫描深度 */
  TYPE_DEFAULT: '运营检查',

  /* 照片怎么进表格 —— 两选一
     'cell'（默认）：Range.InsertImage(base64)，直接吃照片数据，插的是真单元格图片。
                     不要公网地址、不要 IMAGE 授权、不要 GitHub 图床、不要 GH 令牌。
     'url'         ：老路子，先把照片推到 GitHub 拿公网直链，再在格子里写 =IMAGE(直链)。
                     需要 IMAGE 文档授权，未授权时格子显示 #BLOCKED!。
     换模式只改这一个字符串，别的都不用动。
     ★ 'cell' 依赖较新的 InsertImage API。若脚本报 "InsertImage is not a function"，
       改回 'url' 即可（前提是 GH 令牌和 IMAGE 授权都还在）。 */
  PHOTO_MODE: 'cell',

  /* 每项只落第 1 张：N 列一格一张，插第 2 张会把第 1 张盖掉。
     手机端可以拍多张（现场连拍留证），提交时只带第 1 张。 */
  PHOTO_PER_ITEM: 1,

  /* 下面三项只在 PHOTO_MODE='url' 时用到 */
  OWNER: 'lvritiann',
  REPO: 'kaohe-workbench',
  BRANCH: 'main',

  /* ★ 2026-11-20 清空：这里原有一枚真实 GitHub 细粒度令牌（github_pat_…），
     它只在 PHOTO_MODE='url' 那条废弃路上用得到。现在照片走 cell 模式
     （Range.InsertImage 直接嵌格），GitHub 中转也早已不用，令牌纯属多余风险。
     这枚令牌曾写在金山脚本里 —— 已提示用户去 GitHub 设置页吊销。
     ★ 今后任何令牌都不要写进本文件：本文件会进公开仓库，
       GitHub 的密钥扫描会直接把推送挡成 422。 */
  TOKEN: '',

  /* 照片在仓库里的目录（docs 是 GitHub Pages 的根） */
  PHOTO_DIR: 'docs/photos',
  PAGES_BASE: 'https://lvritiann.github.io/kaohe-workbench'
};

var LOG = [];
function say(m) { LOG.push(String(m)); try { console.log(String(m)); } catch (e) { } }

function pad(n) { return (n < 10 ? '0' : '') + n; }
function r2(v) { return Math.round(v * 100) / 100; }
function num(v, dflt) {
  if (v === null || v === undefined || v === '') return (dflt === undefined ? 0 : dflt);
  var n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? (dflt === undefined ? 0 : dflt) : n;
}
function s(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

/* ---------------------------------------------------------------- 取表 */

/* Application.Sheets 是集合对象不是函数，必须走 .Item(name)；六种取法逐个兜底。 */
function sheet(name) {
  var tries = [
    function () { return Application.Sheets.Item(name); },
    function () { return Application.Sheets(name); },
    function () { return Application.Worksheets.Item(name); },
    function () { return Application.Worksheets(name); },
    function () { return Application.ActiveWorkbook.Sheets.Item(name); },
    function () { return Application.ActiveWorkbook.Worksheets.Item(name); }
  ];
  for (var i = 0; i < tries.length; i++) {
    try { var sh = tries[i](); if (sh) return sh; } catch (e) { }
  }
  return null;
}

function sheetNames() {
  var out = [];
  try {
    var S = Application.Sheets;
    var n = S.Count || S.length || 0;
    for (var i = 1; i <= n; i++) {
      try { var sh = S.Item(i); if (sh && sh.Name) out.push(String(sh.Name)); } catch (e) { }
    }
  } catch (e) { }
  return out;
}

/* ------------------------------------------------------------ base64 */

var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8Bytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
    else if (c >= 0xD800 && c <= 0xDBFF) {
      var c2 = str.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
      out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}

function b64(str) {
  var b = utf8Bytes(str), o = '', i = 0;
  while (i < b.length) {
    var b0 = b[i++], b1 = i < b.length ? b[i++] : -1, b2 = i < b.length ? b[i++] : -1;
    o += B64C.charAt(b0 >> 2);
    o += B64C.charAt(((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4));
    o += b1 < 0 ? '=' : B64C.charAt(((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6));
    o += b2 < 0 ? '=' : B64C.charAt(b2 & 63);
  }
  return o;
}

/* ------------------------------------------------------------- HTTP */

/* 必须优先走 HTTP.fetch：HTTP.get / HTTP.put 不吃 headers，Authorization 会悄悄丢。 */
function http(method, url, opts) {
  if (typeof HTTP === 'undefined' || !HTTP) {
    throw new Error('HTTP 对象不存在（请在「服务」里添加「网络API」）');
  }
  var o = opts || {};
  o.method = method;
  if (typeof HTTP.fetch === 'function') return HTTP.fetch(url, o);
  var n = method.toLowerCase();
  if (typeof HTTP[n] === 'function') return HTTP[n](url, o);
  if (typeof HTTP.request === 'function') return HTTP.request(method, url, o);
  throw new Error('HTTP 不支持 ' + method);
}

/* HTTP.fetch 返回对象没有 body 属性，只有 text()；三级兜底 */
function respText(r) {
  if (!r) return '';
  if (typeof r.text === 'function') { try { return String(r.text()); } catch (e) { } }
  if (typeof r.body === 'string') return r.body;
  if (r.body !== undefined && r.body !== null && typeof r.body !== 'function') return String(r.body);
  return '';
}

/* ---------------------------------------------------- GitHub 图片上传 */

function encPath(p) {
  /* 路径里的中文在 URL 中要编码；逐段编，保留斜杠 */
  var segs = String(p).split('/'), out = [];
  for (var i = 0; i < segs.length; i++) out.push(encodeURIComponent(segs[i]));
  return out.join('/');
}

/* 新建一个文件。contents API 新建不需要 sha；同名已存在会返回 422。 */
function ghPutFile(path, contentB64, msg) {
  var url = 'https://api.github.com/repos/' + CFG.OWNER + '/' + CFG.REPO +
    '/contents/' + encPath(path);
  var r = http('PUT', url, {
    headers: {
      'Authorization': 'Bearer ' + CFG.TOKEN,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'kdocs-airscript'
    },
    body: JSON.stringify({ message: msg, content: contentB64, branch: CFG.BRANCH }),
    timeout: 60000
  });
  var st = r ? Number(r.status) : 0;
  if (st === 200 || st === 201) return true;
  say('上传 ' + path + ' 失败：HTTP ' + st + ' ' + respText(r).substring(0, 160));
  return false;
}

function publicUrl(path) {
  return CFG.PAGES_BASE + '/' + encPath(path.replace(/^docs\//, ''));
}

/* ------------------------------------------------------------ 照片准备

   统一成 { 序号: {name, src} }：src 在 'cell' 模式是 base64 dataURL，
   在 'url' 模式是公网直链。写表那段只认这个结构，不关心照片从哪来。 */

function dataUrl(ph) {
  var d = String(ph.data || '');
  if (d.substring(0, 5) === 'data:') return d;
  return 'data:' + (s(ph.mime) || 'image/jpeg') + ';base64,' + d;
}

/* 每项只留第 1 张：N 列一格一张，插第 2 张会把第 1 张盖掉，
   多发只是白白撑大请求体、拖慢提交。 */
function firstPhotos(p) {
  var map = {}, list = p.photos || [];
  for (var i = 0; i < list.length; i++) {
    var ph = list[i];
    if (!ph || !ph.data) continue;
    var k = String(ph.no);
    if (map[k]) continue;
    map[k] = ph;
  }
  return map;
}

function prepPhotos(p) {
  var first = firstPhotos(p);
  var keys = Object.keys(first);
  var out = {};

  if (CFG.PHOTO_MODE !== 'url') {
    for (var i = 0; i < keys.length; i++) {
      var ph = first[keys[i]];
      out[keys[i]] = {
        name: s(ph.name) || ('项目' + keys[i] + '.jpg'),
        src: dataUrl(ph)
      };
    }
    if (keys.length) say('照片 ' + keys.length + ' 张，随表直传（不经过图床）');
    return out;
  }

  /* url 模式：推到 GitHub 拿公网直链，再交给 =IMAGE() */
  var okN = 0;
  for (var j = 0; j < keys.length; j++) {
    var pj = first[keys[j]];
    var ext = (pj.mime && pj.mime.indexOf('png') >= 0) ? 'png' : 'jpg';
    var base = s(pj.name) || ('p' + (j + 1));
    base = base.replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
    var path = CFG.PHOTO_DIR + '/' + s(p.station) + '/' + s(p.month) + '/' +
      base + '_' + keys[j] + '.' + ext;

    /* 手机端传的是纯 base64，不含 data:image/...;base64, 前缀 */
    var raw = String(pj.data);
    var comma = raw.indexOf(',');
    if (raw.substring(0, 5) === 'data:') raw = raw.substring(comma + 1);

    if (!ghPutFile(path, raw, 'photo(' + s(p.station) + ' ' + s(p.month) + ' 项' + keys[j] + ')')) continue;
    okN++;
    out[keys[j]] = { name: s(pj.name) || (base + '.' + ext), src: publicUrl(path) };
  }
  if (okN) say('照片已上传图床 ' + okN + ' 张');
  return out;
}

/* ------------------------------------------------------------- 计分 */

/* 与 docs/assets/engine.js 的 inspectResult() 及 record_sync.py 的 _fill_block 同口径：
     NA   → 标准分不进分母
     符合 → 得标准分
     扣分 → 得 0
   折算分 = 得分 ÷ (100 − NA标准分) × 100；运营段 = 折算分 ÷ 100 × 28（封顶 28） */
function computeScore(p) {
  var items = p.items || [];
  var total = 0, na = 0, got = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var std = num(it.std, 0);
    total += std;
    var res = s(it.res).toLowerCase();
    if (res === 'na') { na += std; continue; }
    if (res === 'no' || res === '否' || res === '扣分') continue;   /* 得 0 */
    got += std;
  }
  var eff = total - na;
  var conv = eff > 0 ? r2(got / eff * 100) : 0;
  var op = r2(conv / 100 * CFG.INSPECT_BASE);
  if (op > CFG.INSPECT_BASE) op = CFG.INSPECT_BASE;
  if (Math.abs(total - 100) > 0.01) {
    say('⚠️ 传入检查项标准分合计 ' + total + '（应为 100），题库或模板可能不一致');
  }
  return { total: total, na: na, raw: r2(got), converted: conv, op: op };
}

/* --------------------------------------------------------- 写检查明细 */

/* 读 A 列找最后一行有内容的行号 */
function lastRow(sh) {
  var vals = sh.Range('A1:A' + CFG.MAX_ROWS).Value2 || [];
  var last = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v && v.length !== undefined) v = v[0];
    if (v !== null && v !== undefined && String(v).trim() !== '') last = i + 1;
  }
  return last;
}

/* 月份归一：A 列只要被 WPS 识别成日期，读回来就是序列号（46327）或 Date，
   直接拿字符串比会永远不相等 —— 结果就是同一站同一月越提越多行、永远替换不掉。
   46000~50000 是 2025-10 到 2037-01 的合理区间，超出就不当日期处理。 */
function normMonth(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (v < 40000 || v > 55000) return String(v);
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return v.getFullYear() + '-' + pad(v.getMonth() + 1);
  }
  var t = String(v).trim();
  var m = /^(\d{4})[-\/.](\d{1,2})/.exec(t);
  if (m) return m[1] + '-' + pad(Number(m[2]));
  return t;
}

var BLANK19 = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];

function appendDetail(p, pics, calc) {
  var sh = sheet(CFG.SHEET_DETAIL);
  if (!sh) {
    throw new Error('找不到工作表「' + CFG.SHEET_DETAIL + '」。本簿实际表名：' + sheetNames().join(' / '));
  }

  var last = lastRow(sh);
  var rows = [];
  /* ★ 记录每条新行落在第几行。不能「写完再读回来找行号」——
     AirScript 里刚赋完值立刻读同一区域，某些版本返回的还是旧值（空），
     导致插图循环一条都匹配不上、数量恒为 0，而且不报错，极难查。
     行号在内存里就是确定的：rows 从 A2 起排，第 k 个元素即第 k+1 行。 */
  var placed = [];
  if (last >= 2) {
    var raw = sh.Range('A2:S' + last).Value2 || [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (!r || r.length === undefined) continue;
      /* 该站该月旧行全部丢弃 → 以最新一次提交为准，重复点提交不会叠 */
      if (normMonth(r[0]) === s(p.month) && s(r[1]) === s(p.station)) continue;
      var o = [];
      for (var c = 0; c < 19; c++) o.push(r[c] === undefined ? '' : r[c]);
      rows.push(o);
    }
  }

  var vetoStr = (p.veto || []).join('；');
  var now = s(p.submittedAt);
  var wrote = 0;

  for (var k = 0; k < (p.items || []).length; k++) {
    var it = p.items[k];
    var res = s(it.res).toLowerCase();
    if (res !== 'no' && res !== 'na') continue;

    var std = num(it.std, 0);
    var score = (res === 'na') ? null : 0;
    var resultText = (res === 'na') ? 'NA' : '扣分';
    var ph = pics[String(it.no)];

    /* O 折算 / P 运营段 每行都写，便于人工直接看 */
    rows.push([
      s(p.month), s(p.station), s(p.type) || CFG.TYPE_DEFAULT,
      it.no, s(it.cat), s(it.name), std, score, resultText,
      s(it.note), s(p.inspector), now,
      ph ? ph.name : '',
      '', calc.converted, calc.op, vetoStr,
      '手机直落表', now
    ]);
    placed.push({ row: rows.length + 1, key: String(it.no) });
    wrote++;
  }

  /* 一票否决项单独落行（序号 v1…v6）：
     ① 它的佐证照片需要有落点；② record_sync.py 靠 Q 列读否决文本。
     record_sync 里 int('v1') 会抛异常后被跳过计分，只贡献否决文本，正合本意。 */
  for (var q = 0; q < (p.vetoItems || []).length; q++) {
    var vt = p.vetoItems[q];
    var vph = pics[String(vt.no)];
    rows.push([
      s(p.month), s(p.station), s(p.type) || CFG.TYPE_DEFAULT,
      s(vt.no), '一票否决', s(vt.name), '', '', '否决',
      s(vt.note), s(p.inspector), now,
      vph ? vph.name : '',
      '', calc.converted, calc.op, vetoStr,
      '手机直落表', now
    ]);
    placed.push({ row: rows.length + 1, key: String(vt.no) });
    wrote++;
  }

  /* 检查了但零扣分：必须留一行占位，否则 record_sync 认为该站没检查过，整块留空丢 28 分 */
  if (!wrote) {
    rows.push([
      s(p.month), s(p.station), s(p.type) || CFG.TYPE_DEFAULT,
      '', '', '本项巡检未发现不符合项（满分）', '', '', '符合',
      '', s(p.inspector), now, '', '', calc.converted, calc.op, vetoStr,
      '手机直落表', now
    ]);
    say('零扣分记录：已写占位行（折算 ' + calc.converted + ' / 运营段 ' + calc.op + '）');
  }

  /* 整体重写：多退少补，避免删行导致行号错乱 */
  var need = Math.max(rows.length, last >= 2 ? last - 1 : 0);
  while (rows.length < need) rows.push(BLANK19.slice());
  if (rows.length === 0) return { n: 0, placed: [] };

  /* ★ A 列必须先设成文本再写：否则 "2026-11" 会被识别成日期，
     显示成 Nov-26、存成序列号 46327，读回来就再也对不上月份。 */
  var aEnd = 1 + rows.length;
  try {
    sh.Range('A2:A' + aEnd).NumberFormat = '@';
  } catch (e) {
    say('A 列设文本格式失败（继续写，靠读时归一兜底）：' + (e && e.message ? e.message : e));
  }
  /* ★ 逐行写，不要一次赋整片二维数组（2026-11-20 真机修）。
     现象：一次提交 2～3 个扣分项，脚本报「已写 3 行」，表里却只有第 1 行，
     其余静默消失；只提交 1 项时正常。
     原因：Range('A2:S'+n).Value2 = 多行二维数组 在真表上只认第一行。
     沙盘测不出来 —— mock 的 Range 是普通赋值，永远成功。
     改成每行一次单行赋值（1 行 × 19 列，即 [row] 的 1×19 形状），
     与原先「只有 1 行」时能成功的那种形状完全一致。 */
  var okRow = 0, badRow = [];
  for (var ri = 0; ri < rows.length; ri++) {
    var rr = 2 + ri;
    try {
      sh.Range('A' + rr + ':S' + rr).Value2 = [rows[ri]];
      okRow++;
    } catch (e) {
      badRow.push(rr);
      say('写第 ' + rr + ' 行失败：' + (e && e.message ? e.message : e));
    }
  }
  say('逐行写入：成功 ' + okRow + ' 行' +
    (badRow.length ? '，失败行 ' + badRow.join(',') : ''));

  /* 回读自检：赋值成功 ≠ 落到文档里。手机上能看到这一行就不必再猜。 */
  try {
    var bk = sh.Range('A2').Value2;
    if (bk && bk.length !== undefined) bk = bk[0];
    say('回读 A2 = ' + (bk === null || bk === undefined || String(bk).trim() === '' ? '（空）' : bk));
  } catch (e3) { }

  return { n: rows.length, placed: placed };
}

/* N 列落图。两种模式都从 pics 取，只是落法不同：
     cell → Range('N'+r).InsertImage(base64)，真图片嵌在格子里
     url  → Range('N'+r).Formula = '=IMAGE(直链)'，靠公式渲染
   必须写完后单独做：Value2 批量赋值会把图片数据/公式当普通文本存进去。 */
function writeImages(pics, placed) {
  var sh = sheet(CFG.SHEET_DETAIL);
  var n = 0, miss = 0;

  for (var i = 0; i < placed.length; i++) {
    var rowNo = placed[i].row;
    var it = pics[placed[i].key];
    if (!it || !it.src) { miss++; continue; }

    try {
      if (CFG.PHOTO_MODE === 'url') {
        sh.Range('N' + rowNo).Formula = '=IMAGE("' + it.src + '")';
      } else {
        /* 先清空：同站同月重复提交时，格子里可能还压着上一张旧图 */
        sh.Range('N' + rowNo).Clear();
        sh.Range('N' + rowNo).InsertImage(it.src);
      }
      n++;
    } catch (e) {
      say('写 N' + rowNo + ' 图片失败：' + (e && e.message ? e.message : e));
    }
  }
  if (miss) say('有 ' + miss + ' 行没有照片（未拍照或 NA 项），N 列留空');
  return n;
}

/* ---------------------------------------------------------------- 主流程 */

function readArgv() {
  var p = null;
  try {
    if (typeof Context !== 'undefined' && Context && Context.argv) p = Context.argv;
  } catch (e) { }
  if (!p) return null;
  /* 允许 { payload: {...} } 或直接 {...} 两种包法 */
  if (p.payload) p = p.payload;
  /* 手动点「运行」时 Context.argv 是空对象 {}，不是 undefined ——
     只判 null 会滑到后面报「缺 station」，容易让人以为脚本有问题。
     没站名也没 items，就当没收到参数。 */
  if (!p.station && !p.items) return null;
  return p;
}

function bad(msg) {
  return JSON.stringify({ ok: false, error: msg, log: LOG });
}

function main() {
  LOG = [];
  var p = readArgv();
  if (!p) return bad('没有收到参数（Context.argv 为空）');

  if (!s(p.station)) return bad('缺 station');
  if (!s(p.month)) return bad('缺 month');
  if (!p.items || !p.items.length) return bad('缺 items（应为完整检查项）');
  if (!/^\d{4}-\d{2}$/.test(s(p.month))) return bad('month 格式应为 YYYY-MM，收到：' + s(p.month));

  var calc = computeScore(p);
  say('计分：折算 ' + calc.converted + ' / 运营段 ' + calc.op +
    '（NA 扣分母 ' + calc.na + '，标准分合计 ' + calc.total + '）');

  var pics = {};
  try {
    pics = prepPhotos(p);
  } catch (e) {
    say('照片准备异常（不影响文字落表）：' + (e && e.message ? e.message : e));
  }

  var n = 0, placed = [];
  try {
    var wr = appendDetail(p, pics, calc);
    n = wr.n;
    placed = wr.placed;
  } catch (e) {
    return bad('写「' + CFG.SHEET_DETAIL + '」失败：' + (e && e.message ? e.message : e));
  }
  say('已写 ' + n + ' 行到「' + CFG.SHEET_DETAIL + '」');

  var npic = 0;
  try {
    npic = writeImages(pics, placed);
  } catch (e) {
    say('N 列落图异常：' + (e && e.message ? e.message : e));
  }
  if (npic) {
    say('已在 N 列落图 ' + npic + ' 张（' + (CFG.PHOTO_MODE === 'url' ? '=IMAGE 公式' : '单元格图片') + '）');
  }

  return JSON.stringify({
    ok: true,
    station: s(p.station),
    month: s(p.month),
    rows: n,
    photos: npic,
    mode: CFG.PHOTO_MODE,
    converted: calc.converted,
    op: calc.op,
    log: LOG
  });
}

/* ★★★ 不能删：金山是执行整个脚本，不调用就是空跑、零日志 ★★★
   手动点「运行」时没有前端来接返回值，所以先把它打进日志 —— 否则永远是
   「已开始执行 / 执行完毕」两行，看不出到底成功还是没收到参数。
   return 必须保留在最后：webhook 调用靠它把结果交回手机页面。 */
var __ret = main();
try { console.log(__ret); } catch (e) { }
return __ret;
