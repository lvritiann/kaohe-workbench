'use strict';
/**
 * 考核提交中转 · 腾讯云函数（SCF）版   v2.0
 *
 * ★ v2.0（2026-11-20）为什么改成「异步提交 + 轮询」
 *   现场反馈：手机提示「没能落表」，但金山表里其实已经写进去了。
 *   报错原文：
 *     {"errno":10000,"msg":"","reason":"","result":"Unavailable"}
 *   WPS 官方社区已明确：sync_task 是**同步**接口，脚本耗时一长就会返回
 *   errno:10000 / "Unavailable"，而**脚本本身是执行成功的** —— 于是出现
 *   「表里有数据、页面报失败」这种最误导人的状态。官方建议的重脚本调用方式是
 *   异步接口：POST .../task 立刻拿 task_id，再 GET /api/v3/script/task 轮询。
 *
 *   本版流程：
 *     ① POST {script}/task          → task_id（毫秒级返回，不等脚本）
 *     ② 每 0.7~3 秒 GET 轮询一次    → 直到 status=finished
 *     ③ 把轮询拿到的最终结果原样回给页面（形状与 sync_task 完全一致，
 *        页面那侧的解析代码一行都不用改）
 *   异步接口若不可用（老账号/接口变更），自动退回 sync_task 老路，行为不变。
 *
 * 它做什么
 *   POST  /  → 提交打分数据，返回 {data:{result:"<脚本 return 的字符串>"},...}
 *   OPTIONS / → CORS 预检
 *   GET   /  → 健康检查（不回显令牌），带 v2 标记便于确认新版本已生效
 *
 * 部署（全程网页，不用命令行）
 *   1. 腾讯云控制台 → 云函数 SCF → 新建 → 模板「从头开始」
 *      运行环境选 Node.js 24.11（22.11 也行；18.15 / 20.19 已 EOL，别选），
 *      函数名 kaohe-relay
 *   2. 上传本函数包 zip（推荐），或把本文件整体粘进 index.js
 *      ★ 不要往浏览器编辑器里粘：Cloud Studio 会拦剪贴板，粘贴静默失败，
 *        结果就是「插件一直是默认模板 + 443 UserCodeError」。
 *   3. 函数配置 → 环境变量，加两条：
 *        KDOCS_URL    https://www.kdocs.cn/api/v3/ide/file/{fileId}/script/{sid}/sync_task
 *        KDOCS_TOKEN  AirScript 脚本令牌
 *      可选：
 *        ALLOW_ORIGIN     默认 *
 *        TIMEOUT_SEC      单次 HTTP 超时，默认 20
 *        ASYNC_POLL_SEC   轮询上限，默认 0 = 自动
 *                         （自动 = 函数剩余执行时间 − 5 秒，不用跟着函数超时改）
 *   3b. 函数「执行超时时间」建议设 **120 秒**（可选范围 1~900 秒）。
 *      照片多、`Range.InsertImage` 慢的时候，60 秒会等不完全部落图。
 *      手机端等待上限是 150 秒，函数给 120 秒仍有余量，不会被页面先掐断。
 *   4. 左侧菜单「函数 URL」→ 新建函数 URL → 别名/版本选 $LATEST、
 *      公网访问开启、授权类型「开放」、CORS 保持关闭 → 得到一个固定域名：
 *        https://1258344699-xxxxxxxx.sh.tencentscf.com
 *      ★ 不要建触发器：API 网关产品已于 2025-06-30 停止服务，
 *        2024-07-01 起就不允许新建 API 网关触发了，弹窗里只剩「定时触发」。
 *   5. 把这个域名填进 docs/assets/config.js 的 report.url，token 留空
 *
 * 费用：前 3 个月有免费额度，之后自动转按量计费（不强制买套餐）。
 *   实际 15 站/月 × 5MB ≈ 0.06 元/月，一年不到 1 元。
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const KDOCS_URL = process.env.KDOCS_URL || '';
const KDOCS_TOKEN = process.env.KDOCS_TOKEN || '';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const TIMEOUT_MS = Number(process.env.TIMEOUT_SEC || 20) * 1000;
/* 轮询总时长。0 = 自动：按函数「剩余执行时间 − 5 秒」算，
   这样你在控制台把函数超时从 60 改成 120、300 甚至 900，这里不用跟着改。
   填正数则作为上限（比如填 100，就算函数给了 300 秒也只等 100 秒）。 */
const POLL_CAP_MS = Number(process.env.ASYNC_POLL_SEC || 0) * 1000;
const POLL_SAFETY_MS = 5000;

function corsHeaders(origin) {
  let allow = ALLOW_ORIGIN;
  if (allow === '*') allow = origin || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, AirScript-Token',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json;charset=utf-8',
  };
}

function reply(status, obj, origin) {
  return {
    statusCode: status,
    headers: corsHeaders(origin),
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
    isBase64Encoded: false,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 由 KDOCS_URL（sync_task 地址）推出另外两个端点。
 *   sync : .../script/{sid}/sync_task
 *   task : .../script/{sid}/task          异步提交
 *   poll : {origin}/api/v3/script/task?task_id=...   轮询
 * 注意 KDOCS_URL 里没有文件/脚本 ID 以外的信息，所以只能就地替换路径段。
 */
function endpoint(kind, taskId) {
  const u = new URL(KDOCS_URL);
  if (kind === 'task') {
    const base = u.pathname;
    const swapped = base.replace(/\/sync_task\/?$/, '/task');
    // 结尾不是 sync_task（配错了或以后改了）就保守地在末尾拼 /task
    u.pathname = (swapped === base) ? base.replace(/\/$/, '') + '/task' : swapped;
    return u.toString();
  }
  if (kind === 'poll') {
    const p = new URL(u.origin + '/api/v3/script/task');
    p.searchParams.set('task_id', taskId);
    return p.toString();
  }
  return u.toString();
}

/** 通用 HTTP 请求，返回 {status, text} */
function requestJson(method, urlStr, buf) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const headers = {
      'AirScript-Token': KDOCS_TOKEN,
      'User-Agent': 'kaohe-scf-relay/2.0',
    };
    if (buf) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = buf.length;
    }
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers,
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({
        status: r.statusCode || 502,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('金山响应超时')));
    req.on('error', reject);
    req.end(buf || undefined);
  });
}

function tryJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

/** 从响应的三种可能形状里取 task_id */
function pickTaskId(obj) {
  if (!obj) return '';
  if (typeof obj.task_id === 'string' && obj.task_id) return obj.task_id;
  if (obj.data && typeof obj.data.task_id === 'string' && obj.data.task_id) return obj.data.task_id;
  return '';
}

/**
 * 这次调用总共还有多久（毫秒）。取不到返回 0。
 * 兼容两种运行时字段：
 *   getRemainingTimeInMillis()  ← AWS 系 / 部分 SCF 运行时
 *   time_limit_in_ms            ← 腾讯云 SCF 的「配置的执行超时」，是个总量，要自己减已用
 * 2026-11-20 实测：线上那版只认前者，而腾讯云这边没有，导致自动预算失效、永远落回 45 秒。
 */
function totalBudgetMs(context, t0) {
  try {
    if (context && typeof context.getRemainingTimeInMillis === 'function') {
      return Number(context.getRemainingTimeInMillis()) || 0;
    }
    if (context && typeof context.time_limit_in_ms === 'number' && context.time_limit_in_ms > 0) {
      return Math.max(0, context.time_limit_in_ms - (Date.now() - t0));
    }
  } catch (e) {
    // 落到 0，由调用方用兜底值
  }
  return 0;
}

/**
 * 这次调用能等多久。
 * 拿得到总预算 → 减 5 秒安全余量；拿不到 → 用 ASYNC_POLL_SEC 或 45 秒兜底。
 * ASYNC_POLL_SEC 填正数时作为上限，永远不会被自动值顶破。
 */
function pollBudget(context, t0) {
  const total = totalBudgetMs(context, t0);
  let budget;
  if (total > 0) {
    const left = total - POLL_SAFETY_MS;
    budget = POLL_CAP_MS > 0 ? Math.min(POLL_CAP_MS, left) : left;
  } else {
    budget = POLL_CAP_MS > 0 ? POLL_CAP_MS : 45000;
  }
  return Math.max(1500, budget);
}

/**
 * 轮询到结束。返回最后一次的响应对象（形状与 sync_task 一致）。
 * 超时返回 null —— 调用方据此给出「已送达、结果未确认」的中间态。
 */
async function pollUntilDone(taskId, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let delay = 700;
  let last = null;
  while (Date.now() < deadline) {
    // 别让退避越过截止时间：最后一跳最多睡到 deadline 为止
    const left = deadline - Date.now();
    await sleep(Math.min(delay, Math.max(0, left)));
    // 指数退避，但封顶 3 秒，避免后面越来越慢
    delay = Math.min(Math.round(delay * 1.5), 3000);
    let r;
    try {
      r = await requestJson('GET', endpoint('poll', taskId), null);
    } catch (e) {
      console.error('轮询失败', e && e.message);
      continue;
    }
    const j = tryJson(r.text);
    if (j) last = j;
    const st = j && j.status;
    if (st === 'finished' || st === 'failed' || st === 'error') {
      return j;
    }
  }
  return null;
}

/** 把脚本 return 的 JSON 字符串塞进 sync_task 形状的信封 */
function envelope(resultObj) {
  return {
    data: { result: JSON.stringify(resultObj), logs: [] },
    status: 'finished',
    error: '',
  };
}

exports.main_handler = async (event, context) => {
  const t0 = Date.now();
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const method = (event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '', isBase64Encoded: false };
  }

  if (method === 'GET') {
    /* env 这几项是给排查用的：一看就知道运行时到底提供了哪个字段，
       也就知道「自动轮询预算」有没有真正生效。 */
    let hasRemain = false;
    let timeLimitMs = null;
    try {
      hasRemain = typeof (context && context.getRemainingTimeInMillis) === 'function';
      if (context && typeof context.time_limit_in_ms === 'number') timeLimitMs = context.time_limit_in_ms;
    } catch (e) { }
    return reply(200, {
      ok: true,
      service: 'kaohe-scf-relay',
      version: '2.0-async',
      hasTarget: !!KDOCS_URL,
      hasToken: !!KDOCS_TOKEN,
      pollSec: Math.round(pollBudget(context, t0) / 1000),
      env: { hasRemain: hasRemain, timeLimitMs: timeLimitMs },
    }, origin);
  }

  if (method !== 'POST') {
    return reply(405, { ok: false, error: '只接受 POST' }, origin);
  }

  if (!KDOCS_URL || !KDOCS_TOKEN) {
    return reply(500, {
      ok: false,
      error: '函数没配环境变量 KDOCS_URL / KDOCS_TOKEN',
    }, origin);
  }

  let body = event.body || '';
  if (event.isBase64Encoded || (event.isBase64Encoded === undefined && /^[A-Za-z0-9+/=\s]+$/.test(body) && body.length > 200)) {
    try { body = Buffer.from(body, 'base64').toString('utf8'); } catch (e) { }
  }
  if (!body) body = '{}';

  /* 函数 URL 的同步请求体有上限，超了在平台层就被拒，这里再兜一次免得徒劳转发 */
  const size = Buffer.byteLength(body, 'utf8');
  if (size > 10 * 1024 * 1024) {
    return reply(413, { ok: false, error: '请求体 ' + (size / 1048576).toFixed(1) + 'MB，超出上限' }, origin);
  }

  const buf = Buffer.from(body, 'utf8');

  /* ---------- ① 先试异步提交 ---------- */
  let taskId = '';
  try {
    const r = await requestJson('POST', endpoint('task'), buf);
    if (r.status >= 200 && r.status < 300) {
      taskId = pickTaskId(tryJson(r.text));
    }
    console.log('异步提交', r.status, 'taskId?', !!taskId);
  } catch (e) {
    console.error('异步提交异常', e && e.message);
  }

  /* ---------- ② 拿不到 task_id 就退回同步老路 ---------- */
  if (!taskId) {
    try {
      const r = await requestJson('POST', endpoint('sync'), buf);
      console.log('同步兜底', r.status, size, 'B', Date.now() - t0, 'ms');
      return { statusCode: r.status, headers: corsHeaders(origin), body: r.text, isBase64Encoded: false };
    } catch (e) {
      console.error('同步兜底失败', e && e.message);
      return reply(502, { ok: false, error: '中转没能连上金山：' + (e && e.message) }, origin);
    }
  }

  /* ---------- ③ 轮询到结束 ---------- */
  const budget = pollBudget(context, t0);
  const done = await pollUntilDone(taskId, budget);
  const cost = Date.now() - t0;

  if (!done) {
    /* 脚本已送达并正在跑，只是我们等不到结果。
       绝不能报「失败」—— 表里很可能已经写进去了，用户会重复提交。
       用一个明确的 pending 标记，前端据此显示「结果未确认」而不是红色报错。 */
    console.warn('轮询超时', taskId, cost, 'ms');
    return reply(200, envelope({
      ok: false,
      pending: true,
      taskId,
      error: '提交已送达金山并开始执行，但 ' + Math.round(cost / 1000) + ' 秒内没等到结果。\n' +
        '很可能已经落表了 —— 请先在「检查明细」里核对本站本月是否有记录，有就不要再提交。',
      log: [],
    }), origin);
  }

  /* 脚本自身报错（语法错、抛异常）时 result 为空，把 error 交给前端展示 */
  if ((done.error || done.status === 'failed') && !(done.data && done.data.result)) {
    return reply(200, envelope({
      ok: false,
      error: '金山脚本执行出错：' + (done.error || '未知错误') +
        ((done.error_details && done.error_details.msg) ? '\n' + done.error_details.msg : ''),
      log: [],
    }), origin);
  }

  console.log('异步完成', taskId, cost, 'ms');
  return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify(done), isBase64Encoded: false };
};
