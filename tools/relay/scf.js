'use strict';
/**
 * 考核提交中转 · 腾讯云函数（SCF）版
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
 *      运行环境 Node.js 16 或 18，函数名 kaohe-relay
 *   2. 把本文件整体粘进 index.js（在线编辑器里改）
 *   3. 函数配置 → 环境变量，加两条：
 *        KDOCS_URL    https://www.kdocs.cn/api/v3/ide/file/{fileId}/script/{sid}/sync_task
 *        KDOCS_TOKEN  AirScript 脚本令牌
 *      可选 ALLOW_ORIGIN（默认 *）
 *   4. 创建触发器 → API 网关触发 → 选「集成响应」，保存
 *      会得到一个固定域名：
 *        https://service-xxxxxxxx-xxxxxxxx.gz.apigw.tencentcs.com/release/kaohe-relay
 *   5. 把这个域名填进 docs/assets/config.js 的 report.url，token 留空
 *
 * 免费额度：每月 100 万次调用 + 40 万 GBs，15 站×每月 1 次远远用不到 1%。
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

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

exports.main_handler = async (event, context) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const method = (event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '', isBase64Encoded: false };
  }

  if (method === 'GET') {
    return reply(200, {
      ok: true,
      service: 'kaohe-scf-relay',
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

  let body = event.body || '';
  if (event.isBase64Encoded || (event.isBase64Encoded === undefined && /^[A-Za-z0-9+/=\s]+$/.test(body) && body.length > 200)) {
    try { body = Buffer.from(body, 'base64').toString('utf8'); } catch (e) { }
  }
  if (!body) body = '{}';

  /* API 网关默认给 6MB，超了会在网关层被拒，这里再兜一次，免得徒劳转发 */
  const size = Buffer.byteLength(body, 'utf8');
  if (size > 10 * 1024 * 1024) {
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
};
