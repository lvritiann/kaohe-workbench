/**
 * 考核提交中转 · 腾讯云函数（SCF）版 —— index.mjs 用（ES 模块）
 *
 * ★ 文件名说明（最容易踩的一步）
 *   腾讯云控制台新建函数时，Cloud Studio 里默认给的文件叫 **index.mjs**，
 *   而且「执行方法」写着 index.main_handler。
 *   .mjs 是 ES 模块，里面**不能用** `require` / `module.exports` / `exports`，
 *   必须是 `import` + `export`。所以贴 CJS 版会立刻报
 *   `exports is not defined` / `require is not defined`。
 *   本文件就是按 index.mjs 写的，直接整篇替换即可。
 *
 *   如果你的文件名是 index.js（个别模板还是 .js），那就用同目录的 scf.js。
 *
 * 为什么需要中转、为什么不能用 GitHub 当中间人
 *   ① GitHub 的两个人肉触发口子都有 65,535 字符的载荷上限：
 *        repository_dispatch.client_payload  ≤ 65,535 字符
 *        workflow_dispatch.inputs            ≤ 65,535 字符
 *      而一次现场检查的照片 base64 大约 6,700,000 字符（10 张 × 500KB），
 *      差 100 倍，照片根本进不去。分数（73 项 + 说明）不到 10KB，倒是能进。
 *      所以「全靠 GitHub 中转」只能送分数、送不了照片，落表那一行就没有图。
 *   ② 想绕开只能让手机先把照片丢到 GitHub 的 blob 接口，再让 Action 去取 ——
 *      那需要一个带 Contents:write 的令牌放在手机上，等于把「能改你仓库代码」
 *      的权限发给十几台手机，比金山令牌泄露更危险（可以往打分页注入脚本）。
 *      所以这条路不采用。
 *
 * 它做什么
 *   POST  /  → 原样转发到金山 webhook（附带 AirScript-Token），结果原样返回
 *   OPTIONS / → CORS 预检
 *   GET   /  → 健康检查（不回显令牌）
 *
 * 部署（全程网页，不用命令行）
 *   1. 腾讯云控制台 → 云函数 SCF → 新建 → 模板「从头开始」
 *      运行环境选 Node.js 24.11（22.11 也行；18.15 / 20.19 已 EOL，别选），
 *      函数名 kaohe-relay
 *   2. 打开 Cloud Studio 里的 index.mjs，全选删掉，把本文件整篇粘进去
 *      「执行方法」保持 index.main_handler
 *   3. 函数配置 → 环境变量，加两条：
 *        KDOCS_URL    https://www.kdocs.cn/api/v3/ide/file/{fileId}/script/{sid}/sync_task
 *        KDOCS_TOKEN  AirScript 脚本令牌
 *      可选 ALLOW_ORIGIN（默认 *）
 *   4. 创建触发器 → API 网关触发 → 选「集成响应」，保存
 *      会得到一个固定域名：
 *        https://service-xxxxxxxx-xxxxxxxx.sh.apigw.tencentcs.com/release/kaohe-relay
 *   5. 把这个域名填进 docs/assets/config.js 的 report.url，token 留空
 *
 * 费用：前 3 个月有免费额度，之后自动转按量计费（不强制买套餐）。
 *   实际 15 站/月 × 5MB ≈ 0.06 元/月，一年不到 1 元。
 */

import https from 'node:https';
import http from 'node:http';

const KDOCS_URL = process.env.KDOCS_URL || '';
const KDOCS_TOKEN = process.env.KDOCS_TOKEN || '';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const TIMEOUT_MS = Number(process.env.TIMEOUT_SEC || 100) * 1000;

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

function forward(buf) {
  return new Promise((resolve, reject) => {
    const u = new URL(KDOCS_URL);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': buf.length,
        'AirScript-Token': KDOCS_TOKEN,
        'User-Agent': 'kaohe-scf-relay/1.0',
      },
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({
        status: r.statusCode || 502,
        body: Buffer.concat(chunks),
      }));
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('金山响应超时')));
    req.on('error', reject);
    req.end(buf);
  });
}

export async function main_handler(event, context) {
  const ev = event || {};
  const origin = (ev.headers && (ev.headers.origin || ev.headers.Origin)) || '';
  const method = (ev.httpMethod || (ev.requestContext && ev.requestContext.httpMethod) || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '', isBase64Encoded: false };
  }

  if (method === 'GET') {
    return reply(200, {
      ok: true,
      service: 'kaohe-scf-relay',
      runtime: process.version,
      hasTarget: !!KDOCS_URL,
      hasToken: !!KDOCS_TOKEN,
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

  let body = ev.body || '';
  if (ev.isBase64Encoded || (ev.isBase64Encoded === undefined && /^[A-Za-z0-9+/=\s]+$/.test(body) && body.length > 200)) {
    try { body = Buffer.from(body, 'base64').toString('utf8'); } catch (e) { /* 原样用 */ }
  }
  if (!body) body = '{}';

  /* 前端已卡 5MB；这里再兜一次，免得徒劳转发（SCF 同步事件硬上限 6MB） */
  const size = Buffer.byteLength(body, 'utf8');
  if (size > 6 * 1024 * 1024) {
    return reply(413, { ok: false, error: '请求体 ' + (size / 1048576).toFixed(1) + 'MB，超出上限' }, origin);
  }

  try {
    const r = await forward(Buffer.from(body, 'utf8'));
    const text = r.body.toString('utf8');
    console.log('POST', size, 'B →', r.status);
    return {
      statusCode: r.status,
      headers: corsHeaders(origin),
      body: text,
      isBase64Encoded: false,
    };
  } catch (e) {
    console.error('转发失败', e && e.message);
    return reply(502, { ok: false, error: '中转没能连上金山：' + (e && e.message) }, origin);
  }
}

export default { main_handler };
