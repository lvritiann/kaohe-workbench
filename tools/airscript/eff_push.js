/* ==========================================================================
 * 考核工作台 · 实时人效推送   eff_push.js   v3.1（V6 四项口径）
 * 运行位置：金山文档「2026xx销售及库存日报（新).xlsx」内的 AirScript
 * v3.1：月均在岗改为从「人效」表逐日累加（每天 48 行，站小计行 = rE+48k），
 *       不再用「当日人数」近似；销量仍按销售日报 31 个日块分品号累加。
 * v2.1：修正人效表 H 列口径误判（H 是当日销量，不是月累计）造成的假漂移告警；
 *       计分逻辑与 v2.0 完全相同，不重粘也能正常出数，只是日志更干净。
 * 触发：定时任务 8:30 / 9:00 / 9:30 / 10:00 / 11:30
 *
 * V6 口径（《目标责任考核方案》V1.0，2026-11-16 定稿）：
 *   当量 = 汽油×39 + 柴油×27
 *   人效 = (会计月累计当量 ÷ 已计天数) ÷ (月均在岗 − 4)
 *   月均在岗 = 人效表各日「当班员工人数（含管理岗）」之和 ÷ 已计天数（自算，不取现成列）
 *   人效段 = 人效 ≤ 49：12 × 人效 ÷ 49；人效 > 49：12 + 8 ×（人效 − 49）÷ 49；封顶 20
 *   会计月 = 上月26日 — 本月25日，天数按实计
 *
 * 产出 docs/data/efficiency.json（V6 结构）→ 网页「人效看板」eff.html 直接读。
 * 每次推送保留远端 history[]：同月覆盖、异月追加，供历史趋势折线使用。
 *
 * ★ 文件末尾的 main(); 不能删 —— 金山是「执行整个脚本」，不调用就等于啥也没干。
 * ★ 本文件含明文令牌，已 gitignore，请勿随意外发。
 * ========================================================================== */

var CFG = {
  OWNER: 'lvritiann',
  REPO:  'kaohe-workbench',
  PATH:  'docs/data/efficiency.json',
  BRANCH: 'main',

  /* ★ 2026-11-20 清空：这里原有一枚真实 GitHub 细粒度令牌（github_pat_…）。
     已提示用户去 GitHub 设置页吊销。本文件会进公开仓库，
     GitHub 密钥扫描会直接把推送挡成 422，今后一律不要往这里写真实令牌。 */
  TOKEN: '',

  SHEET_EFF:   '人效',
  SHEET_DAILY: '销售日报',

  /* 销售日报行号 = 人效表行号 + 50（依据：人效表 C3 公式 =销售日报!G53） */
  ROW_OFFSET: 50,

  /* 15 站小计行（1-based 行号），顺序即片区顺序 */
  STATIONS: [
    { name: '秦岭',     row: 5  },
    { name: '宁陕',     row: 8  },
    { name: '洋县',     row: 11 },
    { name: '汉中',     row: 14 },
    { name: '富平',     row: 17 },
    { name: '韩城',     row: 20 },
    { name: '富县',     row: 23 },
    { name: '南沙',     row: 26 },
    { name: '华山',     row: 29 },
    { name: '白河',     row: 32 },
    { name: '旬阳',     row: 35 },
    { name: '略阳',     row: 38 },
    { name: '玉华宫',   row: 41 },
    { name: '照金',     row: 44 },
    { name: '天汉水城', row: 47 }
  ],

  SGE_GAS: 39,          /* 汽油 SGE/吨（1360 升 ÷ 34.75 升/单 ≈ 39 单 × 一台一份） */
  SGE_DIESEL: 27,       /* 柴油 SGE/吨（1200 升 ÷ 153.35 升/单 ≈ 7.82 单 × 3.5 ≈ 27.4 取 27） */
  BASE_HEAD: 4,         /* 最低开班配置，从「月均在岗」中扣减 */
  BENCHMARK: 49,        /* 基准人效（15站平均 49.26 取整，当年固定） */
  EFF_BASE: 12,         /* 人效段基准分（人效=基准时得 12 分） */
  EFF_SURGE: 8,         /* 冲击分（人效=2 倍基准时再加 8 分） */
  EFF_CAP: 20,          /* 人效段封顶（人效 98） */
  MIN_OK_STATIONS: 12,  /* 有效站数低于此值判读表不全，中止推送 */

  /* 会计月：上月 26 日 — 本月 25 日，天数按实计 */
  PERIOD_START_DAY: 26,
  PERIOD_END_DAY: 25,

  /* 月均在岗取数优先级：
     ① MONTH_HEAD_OVERRIDE：科室按站填的月均值（最准，可只填部分站）
     ② MONTH_HEAD_COL：销售日报日块里的人数列（如 'H'）；留空＝日报没有人数列
     ③ 人效表 D 列当日人数（近似值，日志会明确告警，不会伪装成月均）        */
  MONTH_HEAD_OVERRIDE: {
    /* '玉华宫': 12, '华山': 30 */
  },
  MONTH_HEAD_COL: '',

  /* 日块累加：销售日报从第 53 行起，每天一块、每块 50 行；第 53 行是当天 */
  DAY_BLOCK_START: 53,
  DAY_BLOCK_STEP: 50,
  DAY_BLOCK_COUNT: 31,

  /* 人效表日块（用于逐日累加「月均在岗」，不再用当日人数近似）：
     每天 = 2 行表头 + 15站×3行 + 1 行「零售小计」 = 48 行
     站小计行 1-based = rE + 48 × k（k=0 即会计月第 1 天）
     校验依据：秦岭西 C2=销售日报!G53、C50=!G103、C98=!G153；零售小计 D47/D95/D143…
     ★ 天数上限 31，实际按会计月取 28/29/30/31（见下方按表尾降级探测） */
  EFF_DAY_STEP: 48,
  EFF_DAY_COUNT: 31,
};

var LOGS = [];
function say(m) { LOGS.push(String(m)); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function r2(v) { return Math.round(v * 100) / 100; }
function r4(v) { return Math.round(v * 10000) / 10000; }
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  var n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/* ---------------------------------------------------------------- 取表 */

function sheet(name) {
  /* Application.Sheets 是集合对象不是函数，必须走 .Item(name)；
     六种取法取自 read_daily.js 生产版本，逐个兜底。 */
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

function readCell(sh, ref) {
  try { var a = sh.Range(ref).Value2; if (a !== undefined && a !== null) return a; } catch (e) { }
  try { var b = sh.Range(ref).Value;  if (b !== undefined && b !== null) return b; } catch (e) { }
  try { var c = sh.Range(ref).Text;   if (c !== undefined && c !== null) return c; } catch (e) { }
  return null;
}

/* ---------------------------------------------------------------- 计算 */

/* V6 不设等级 —— 原 gradeOf() 已移除，此处改为会计月计算工具。 */

/* 由今天推算会计月归属月：26 日及以后算下月，否则算本月 */
function periodOf(d) {
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  var by = y, bm = m;
  if (day >= CFG.PERIOD_START_DAY) {
    bm = m + 1;
    if (bm > 12) { bm = 1; by = y + 1; }
  }
  var s = Date.UTC(by, bm - 2, CFG.PERIOD_START_DAY);
  var e = Date.UTC(by, bm - 1, CFG.PERIOD_END_DAY);
  return {
    month: by + '-' + pad(bm),
    start: new Date(s),
    end: new Date(e),
    days: Math.round((e - s) / 86400000) + 1
  };
}

function iso(d) {
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function collect() {
  var shEff = sheet(CFG.SHEET_EFF);
  var shDay = sheet(CFG.SHEET_DAILY);

  if (!shEff || !shDay) {
    var names = sheetNames();
    var miss = [];
    if (!shEff) miss.push(CFG.SHEET_EFF);
    if (!shDay) miss.push(CFG.SHEET_DAILY);
    throw new Error('找不到工作表「' + miss.join('」、「') + '」。' +
      (names.length ? '本簿实际表名：' + names.join(' / ')
                    : '（读不到表名列表，可能未打开文档上下文）'));
  }

  /* 一次性把四个品号列 + 小计列读成整列数组，再按 50 行一块取每站小计行。
     ★ 局部变量不要叫 r2 —— 会遮蔽全局取整函数 r2()（v1.4 的实际 bug）。 */
  var rFrom = CFG.DAY_BLOCK_START;
  var rTo = rFrom + CFG.DAY_BLOCK_STEP * CFG.DAY_BLOCK_COUNT - 1;
  var colC = readCol(shDay, 'C', rFrom, rTo);   /* -10#柴油 */
  var colD = readCol(shDay, 'D', rFrom, rTo);   /* 0#柴油 */
  var colE = readCol(shDay, 'E', rFrom, rTo);   /* 92# */
  var colF = readCol(shDay, 'F', rFrom, rTo);   /* 95# */
  var colG = readCol(shDay, 'G', rFrom, rTo);   /* 小计 */
  var colHead = CFG.MONTH_HEAD_COL ? readCol(shDay, CFG.MONTH_HEAD_COL, rFrom, rTo) : null;

  var rows = [];
  var emptyHead = [];
  var approxHead = [];

  for (var i = 0; i < CFG.STATIONS.length; i++) {
    var st = CFG.STATIONS[i];
    var rE = st.row;

    var headToday = num(readCell(shEff, 'D' + rE));  /* 当日实际在岗，仅兜底 */
    var monTons   = num(readCell(shEff, 'H' + rE));  /* H 列＝当日销量（参考值，不是月累计） */

    /* 月均在岗数据源：人效表 D 列按日块整列取出（每天 48 行，站小计行 = rE + 48k）。
       配了 MONTH_HEAD_COL 时优先用销售日报里的人数列（老路径）。
       ★ 会计月天数 28/29/30/31 不等（3 月会计月平年 28 天、闰年 29 天），
         表尾随之变化；从上限 31 往下降，取第一个能完整覆盖到最后一天的档位。 */
    var colEffHead = null;
    if (!CFG.MONTH_HEAD_COL) {
      for (var cc = CFG.EFF_DAY_COUNT; cc >= 28; cc--) {
        var probe = readCol(shEff, 'D', rE, rE + CFG.EFF_DAY_STEP * (cc - 1));
        if (probe && probe.length >= CFG.EFF_DAY_STEP * (cc - 1) + 1) {
          colEffHead = probe;
          break;
        }
      }
    }

    /* 该站在日块内的行下标：销售日报行 = 人效行 + 50 */
    var baseIdx = (rE + CFG.ROW_OFFSET) - rFrom;

    var mT10 = 0, mT0 = 0, mT92 = 0, mT95 = 0, days = 0, gSum = 0;
    var dT10 = 0, dT0 = 0, dT92 = 0, dT95 = 0;
    var headSum = 0, headDays = 0;

    for (var k = 0; k < CFG.DAY_BLOCK_COUNT; k++) {
      var idx = baseIdx + CFG.DAY_BLOCK_STEP * k;
      if (idx < 0 || idx >= colG.length) continue;
      var g = colG[idx];
      if (!(g > 0)) continue;                  /* 该日无数据 */
      days++;
      gSum += g;
      mT10 += colC[idx]; mT0 += colD[idx]; mT92 += colE[idx]; mT95 += colF[idx];
      if (k === 0) {                           /* 第 0 块 = 当天 */
        dT10 = colC[idx]; dT0 = colD[idx]; dT92 = colE[idx]; dT95 = colF[idx];
      }
    }

    /* 月均在岗逐日累加：与销量侧同一口径——当天有销量（G>0）才计该天人数 */
    for (var h = 0; h < CFG.EFF_DAY_COUNT; h++) {
      var hidx = baseIdx + CFG.DAY_BLOCK_STEP * h;
      if (hidx < 0 || hidx >= colG.length) continue;
      if (!(colG[hidx] > 0)) continue;
      var hi = CFG.EFF_DAY_STEP * h;
      var hv = 0;
      if (colHead && hidx < colHead.length) hv = colHead[hidx];
      else if (colEffHead && hi < colEffHead.length) hv = colEffHead[hi];
      if (hv > 0) { headSum += hv; headDays++; }
    }

    /* 分母：月均在岗 − 4。取不到月均时明确告警，不伪装成月均。 */
    var monthlyHead = 0, headFrom = '';
    if (CFG.MONTH_HEAD_OVERRIDE[st.name] > 0) {
      monthlyHead = CFG.MONTH_HEAD_OVERRIDE[st.name]; headFrom = 'override';
    } else if (headDays > 0) {
      monthlyHead = headSum / headDays; headFrom = 'daily';
    } else {
      monthlyHead = headToday; headFrom = 'today';
      approxHead.push(st.name);
    }
    if (!(monthlyHead > 0)) emptyHead.push(st.name);

    var denom = monthlyHead - CFG.BASE_HEAD;
    if (denom <= 0) denom = 1;

    var mGas = mT92 + mT95;
    var mDiesel = mT10 + mT0;
    var mSge = mGas * CFG.SGE_GAS + mDiesel * CFG.SGE_DIESEL;
    var effDays = days > 0 ? days : 1;         /* 月内滚动：已计天数 */
    var daySge = mSge / effDays;
    var monthEff = daySge / denom;
    var effScore = monthEff <= CFG.BENCHMARK
      ? CFG.EFF_BASE * monthEff / CFG.BENCHMARK
      : CFG.EFF_BASE + CFG.EFF_SURGE * (monthEff - CFG.BENCHMARK) / CFG.BENCHMARK;
    effScore = Math.min(effScore, CFG.EFF_CAP);

    /* 当天（第 0 块，仅参考） */
    var dGas = dT92 + dT95;
    var dDiesel = dT10 + dT0;
    var dSge = dGas * CFG.SGE_GAS + dDiesel * CFG.SGE_DIESEL;
    var dayEff = dSge / denom;

    /* 自检（v2.1）：同一行「四品号之和」应严格等于「小计列 G」。
       v2.0 误把人效表 H 列（当日销量）当成月累计去比 18 天累计，
       必然报 1700%~3000% 假告警；日报含大客户、单日波动大，
       改用「当日×天数」推算也不可靠。行内自洽检查正常恒为 0。 */
    var sumTons = mGas + mDiesel;
    var drift = gSum > 0 ? Math.abs(sumTons - gSum) / gSum : 0;

    rows.push({
      name: st.name,
      monthlyHead: r2(monthlyHead),
      denom: r2(denom),
      days: days,
      monthGas: r4(mGas),
      monthDiesel: r4(mDiesel),
      monthTons: r4(sumTons),
      monthSge: r2(mSge),
      daySge: r2(daySge),
      monthEff: r2(monthEff),
      multiple: r4(monthEff / CFG.BENCHMARK),
      effScore: r2(effScore),
      dataSource: 'live',
      headFrom: headFrom,
      today: {
        gasTon: r4(dGas), dieselTon: r4(dDiesel), eff: r2(dayEff),
        note: '当日参考值'
      },
      ref: { drift: r4(drift), dayTonsFromSheet: num(readCell(shEff, 'C' + rE)) }
    });
  }

  var maxEff = 0;
  for (var j = 0; j < rows.length; j++) if (rows[j].monthEff > maxEff) maxEff = rows[j].monthEff;

  var sorted = rows.slice().sort(function (a, b) { return b.monthEff - a.monthEff; });
  for (var k2 = 0; k2 < rows.length; k2++) {
    rows[k2].rank = 0;
    for (var m = 0; m < sorted.length; m++) {
      if (sorted[m].name === rows[k2].name) { rows[k2].rank = m + 1; break; }
    }
  }

  return { rows: rows, emptyHead: emptyHead, approxHead: approxHead, maxEff: maxEff };
}

/* 读整列为数字数组；行区间 1-based、含端点 */
function readCol(sh, col, rowFrom, rowTo) {
  var ref = col + rowFrom + ':' + col + rowTo;
  var v = null;
  try { v = sh.Range(ref).Value2; } catch (e) { }
  if (v == null) { try { v = sh.Range(ref).Value; } catch (e) { } }

  var out = [];
  if (!v) return out;

  /* Value2 可能是二维数组 [[a],[b],...]，也可能是单列扁平数组 */
  if (v.length !== undefined && v.length > 0 && v[0] && v[0].length !== undefined) {
    for (var i = 0; i < v.length; i++) out.push(num(v[i][0]));
  } else if (v.length !== undefined) {
    for (var j = 0; j < v.length; j++) out.push(num(v[j]));
  }
  return out;
}

/* --------------------------------------------------- base64（已验证实现） */

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

/* ----------------------------------------------------------- GitHub 通道 */

function apiUrl() {
  return 'https://api.github.com/repos/' + CFG.OWNER + '/' + CFG.REPO + '/contents/' + CFG.PATH;
}

/* 必须优先走 HTTP.fetch：HTTP.get / HTTP.put 不吃 headers，Authorization 会悄悄丢。 */
function http(method, url, opts) {
  if (typeof HTTP === 'undefined' || !HTTP) {
    throw new Error('HTTP 对象不存在（请先在「服务」里添加「网络API」）');
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

function ghGet() {
  var r = http('GET', apiUrl() + '?ref=' + CFG.BRANCH, {
    headers: {
      'Authorization': 'Bearer ' + CFG.TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'kdocs-airscript'
    },
    timeout: 20000
  });
  var st = r ? Number(r.status) : 0;
  if (st !== 200) {
    if (st === 401) say('⚠️ GET 401 —— 令牌没生效或已失效');
    else if (st === 404) say('（远端还没有 ' + CFG.PATH + '，按新建处理）');
    else say('（GET HTTP ' + st + '：' + respText(r).substring(0, 120) + '）');
    return null;
  }
  var j = {};
  try { j = JSON.parse(respText(r)) || {}; } catch (e) { return null; }
  say('远端现有 ' + (j.size || '?') + ' 字节，sha ' + String(j.sha || '').substring(0, 8));
  return j;
}

/* 取远端文件原文（GitHub raw 视图），用于保留 history[]。
   Accept: application/vnd.github.raw 直接返回文本，省掉 base64 解码。 */
function ghGetJSON() {
  try {
    var r = http('GET', apiUrl() + '?ref=' + CFG.BRANCH, {
      headers: {
        'Authorization': 'Bearer ' + CFG.TOKEN,
        'Accept': 'application/vnd.github.raw',
        'User-Agent': 'kdocs-airscript'
      },
      timeout: 20000
    });
    if (!r || Number(r.status) !== 200) return null;
    var t = respText(r);
    if (!t) return null;
    return JSON.parse(t);
  } catch (e) {
    say('（读不到远端历史台账，本次只写当期：' + (e && e.message ? e.message : e) + '）');
    return null;
  }
}

function ghPut(text, msg) {
  var prev = ghGet();
  var body = { message: msg, content: b64(text), branch: CFG.BRANCH };
  if (prev && prev.sha) body.sha = prev.sha;

  var r = http('PUT', apiUrl(), {
    headers: {
      'Authorization': 'Bearer ' + CFG.TOKEN,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'kdocs-airscript'
    },
    body: JSON.stringify(body),
    timeout: 30000
  });
  var st = r ? Number(r.status) : 0;
  if (st !== 200 && st !== 201) {
    say('❌ PUT HTTP ' + st + '：' + respText(r).substring(0, 200));
    return false;
  }
  var jr = {};
  try { jr = JSON.parse(respText(r)) || {}; } catch (e) { }
  say('PUT 成功，新 sha ' + String((jr.content && jr.content.sha) || '').substring(0, 8));
  return true;
}

/* ---------------------------------------------------------------- 主流程 */

function main() {
  LOGS = [];

  var data;
  try {
    data = collect();
  } catch (e) {
    say('❌ 读表异常：' + (e && e.message ? e.message : e));
    return done(false);
  }

  if (data.emptyHead.length > 0) say('⚠️ 人数为 0 的站：' + data.emptyHead.join('、'));
  if (data.approxHead.length > 0) {
    say('⚠️ 分母暂用「当日人数」近似（未取到月均在岗）：' + data.approxHead.join('、') +
      '；请在 CFG.MONTH_HEAD_OVERRIDE 填月均值，或配置 MONTH_HEAD_COL 指向日报人数列');
  }
  var okCount = data.rows.length - data.emptyHead.length;
  if (okCount < CFG.MIN_OK_STATIONS) {
    say('中止：有效站点仅 ' + okCount + ' 个（阈值 ' + CFG.MIN_OK_STATIONS + '），疑似读表不全，未改动远端');
    return done(false);
  }

  var now = new Date();
  var dateStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var P = periodOf(now);

  /* 公司汇总 */
  var effs = [], elapsed = 0, sum = 0;
  for (var i = 0; i < data.rows.length; i++) {
    effs.push(data.rows[i].monthEff);
    sum += data.rows[i].monthEff;
    if (data.rows[i].days > elapsed) elapsed = data.rows[i].days;
  }
  var company = {
    avgEff: r2(sum / effs.length),
    maxEff: r2(data.maxEff),
    minEff: r2(Math.min.apply(null, effs)),
    count: effs.length
  };

  /* 历史台账：读远端原文，同月覆盖、异月追加 */
  var prev = ghGetJSON();
  var history = [];
  if (prev && prev.version === 'V6' && prev.history) {
    for (var q = 0; q < prev.history.length; q++) {
      if (prev.history[q].month !== P.month) history.push(prev.history[q]);
    }
  }
  var stMap = {};
  for (var w = 0; w < data.rows.length; w++) stMap[data.rows[w].name] = data.rows[w].monthEff;
  history.push({
    month: P.month, avgEff: company.avgEff, maxEff: company.maxEff,
    minEff: company.minEff, dataMode: 'live', stations: stMap
  });
  history.sort(function (a, b) { return a.month < b.month ? -1 : (a.month > b.month ? 1 : 0); });

  var payload = {
    version: 'V6',
    month: P.month,
    date: dateStr,
    updatedAt: dateStr + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
    dataMode: 'live',
    source: '金山日报「2026xx销售及库存日报（新）」· 人效 / 销售日报 · AirScript v2.1',
    basis: '人效 = (会计月当量 ÷ 已计天数) ÷ (月均在岗 − 4)；当量 = 汽油×' + CFG.SGE_GAS + ' + 柴油×' + CFG.SGE_DIESEL + '；人效段 = 12×人效÷' + CFG.BENCHMARK + '（≤' + CFG.BENCHMARK + '）或 12+8×(人效−' + CFG.BENCHMARK + ')÷' + CFG.BENCHMARK + '（>' + CFG.BENCHMARK + '），封顶 ' + CFG.EFF_CAP,
    note: '由 eff.html 人效看板直接读取；history[] 逐月留痕，同月覆盖、异月追加。',
    period: {
      start: iso(P.start), end: iso(P.end),
      days: P.days, elapsed: elapsed
    },
    params: {
      sgeGas: CFG.SGE_GAS, sgeDiesel: CFG.SGE_DIESEL,
      baseHead: CFG.BASE_HEAD, benchmark: CFG.BENCHMARK,
      effBase: CFG.EFF_BASE, effSurge: CFG.EFF_SURGE, effCap: CFG.EFF_CAP
    },
    company: company,
    stations: data.rows,
    history: history
  };

  var ok = ghPut(JSON.stringify(payload, null, 1), 'chore(eff): V6 实时人效 ' + dateStr);
  var driftWarn = [];
  for (var d = 0; d < data.rows.length; d++) {
    var dr = data.rows[d].ref && data.rows[d].ref.drift;
    if (dr > 0.02) driftWarn.push(data.rows[d].name + '(' + (dr * 100).toFixed(1) + '%)');
  }
  if (driftWarn.length) say('⚠️ 四品号之和与小计列不一致（疑似列映射错位）：' + driftWarn.join('、'));
  if (ok) say('已推送 ' + P.month + ' 第 ' + elapsed + ' 天，' + data.rows.length +
    ' 站，平均 ' + company.avgEff + '，最高 ' + company.maxEff + '；历史 ' + history.length + ' 期');
  return done(ok);
}

function done(ok) {
  var msg = (ok ? '✅ ' : '❌ ') + LOGS.join(' | ');
  try { console.log(msg); } catch (e) { }
  return msg;
}

/* ★★★ 不能删：金山是执行整个脚本，不调用就是 100ms 空跑、零日志 ★★★ */
main();
