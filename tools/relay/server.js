#!/usr/bin/env node
/* eslint-disable */
/**
 * 考核提交中转 · 纯 Node（零依赖，不需要注册任何云平台）
 *
 * 为什么不能「把令牌明文写进 GitHub 仓库」
 *   ① 这个仓库（lvritiann/kaohe-workbench）是**公开**的，GitHub Pages 站点也公开。
 *      写进 docs/assets/config.js 的字符串，浏览器 F12 就能看到，GitHub 上还有爬虫
 *      专门扫 AirScript-Token / ghp_ / sk- 这类特征串，扫到就到手了。
 *   ② AirScript-Token 是**账号级**凭据：拿到它 = 能读写你名下全部金山文档，
 *      不只是考核这几本表。这跟普通只读 API Key 完全不是一个量级。
 *   ③ 静态网页没有「保密」这回事 —— 凡是浏览器要用的东西，就等于公开。
 *      所以「手机零配置」只能靠一个中间人：令牌在中间人手里，网页只知道它的地址。
 *
 * 它做什么
 *   POST /  → 原样转发到金山 webhook（附上 AirScript-Token），结果原样返回
 *   OPTIONS → CORS 预检
 *   GET /health → 健康检查（不含任何密钥）
 *
 * 怎么跑
 *   1) 复制 config.example.json 为 config.json，填 kdocsUrl 和 kdocsToken
 *   2) 双击 start-relay.bat（或 node tools/relay/server.js）
 *   3) 用隧道把它暴露到公网：cloudflared tunnel --url http://127.0.0.1:8788
 *   4) 把隧道地址填进 docs/assets/config.js 的 report.url，token 留空
 *
 * ★ config.json 含明文令牌，已在 .gitignore 里排除，永远不会入库。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/* ---------------- 配置 ---------------- */

const CFG_PATH = path.join(__dirname, 'config.json');
let CFG = {};
try {
  CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
} catch (e) {
  /* 没 config.json 时允许全用环境变量 */
}

const PORT = Number(process.env.PORT || CFG.port || 8788);
const HOST = process.env.HOST || CFG.host || '127.0.0.1';
const KDOCS_URL = process.env.KDOCS_URL || CFG.kdocsUrl || '';
const KDOCS_TOKEN = process.env.KDOCS_TOKEN || CFG.kdocsToken || '';
/* '*' 表示任何来源都能调（网页在哪个域名都行）；想收紧就填死，如 https://lvritiann.github.io */
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || CFG.allowOrigin || '*';

const MAX_BODY = Number(CFG.maxBodyMb || 12) * 1024 * 1024;   /* 打分页自己的闸是 9MB，这里留余量 */
const TIMEOUT_MS = Number(CFG.timeoutSec || 120) * 1000;
const RATE_MAX = Number(CFG.ratePerMin || 30);                /* 每 IP 每分钟最多几次 */
const LOG_FILE = path.join(__dirname, 'relay.log');

/* ---------------- 小工具 ---------------- */

function log(line) {
  const s = '[' + new Date().toLocaleString('zh-CN', { hour12: false }) + '] ' + line;
  console.log(s);
  try { fs.appendFileSync(LOG_FILE, s + '\n'); } catch (e) { }
}

function corsHeaders(req) {
  let allow = ALLOW_ORIGIN;
  if (allow === '*') allow = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, AirScript-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function send(res, status, body, extra) {
  const h = Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, extra || {});
  res.writeHead(status, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/* 简单滑动窗口限流：只看 IP，不做持久化，重启即清零 */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + 60000; }
  rec.n++;
  hits.set(ip, rec);
  /* 顺带清理过期项，避免 Map 无限增长 */
  if (hits.size > 2000) {
    for (const [k, v] of hits) if (now > v.reset + 300000) hits.delete(k);
  }
  return rec.n > RATE_MAX;
}

/* ---------------- 转发 ---------------- */

function forward(payloadBuf) {
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
        'Content-Length': payloadBuf.length,
        'AirScript-Token': KDOCS_TOKEN,
        'User-Agent': 'kaohe-relay/1.0',
      },
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        resolve({
          status: r.statusCode || 502,
          type: r.headers['content-type'] || 'application/json;charset=utf-8',
          body: Buffer.concat(chunks),
        });
      });
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('金山响应超时 ' + (TIMEOUT_MS / 1000) + 's')));
    req.on('error', reject);
    req.end(payloadBuf);
  });
}

/* ---------------- 服务 ---------------- */

if (!KDOCS_URL || !KDOCS_TOKEN) {
  console.error('\n[启动失败] 缺少 kdocsUrl 或 kdocsToken。');
  console.error('  做法：把 config.example.json 复制成 config.json，填好这两项再启动。');
  console.error('  文件位置：' + CFG_PATH + '\n');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || '?';
  const cors = corsHeaders(req);

  /* 预检：浏览器发正式请求之前必走这一步，回 204 就够 */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    send(res, 200, {
      ok: true,
      service: 'kaohe-relay',
      uptimeSec: Math.round(process.uptime()),
      target: KDOCS_URL.replace(/\/script\/[^/]+\//, '/script/***/'),   /* 不回显脚本 ID */
    }, cors);
    return;
  }

  if (req.method !== 'POST') {
    send(res, 405, { ok: false, error: '只接受 POST' }, cors);
    return;
  }

  if (rateLimited(ip)) {
    log('RATE ' + ip);
    send(res, 429, { ok: false, error: '提交太频繁，请等一分钟再试' }, cors);
    return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      aborted = true;
      send(res, 413, { ok: false, error: '请求体超过 ' + (MAX_BODY / 1048576) + 'MB，请减少照片后重试' }, cors);
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    const t0 = Date.now();
    forward(buf).then((r) => {
      const ms = Date.now() - t0;
      let brief = '';
      try {
        const j = JSON.parse(r.body.toString('utf8'));
        const inner = typeof j.data === 'object' && j.data && j.data.result ? j.data.result : j;
        brief = (inner && (inner.ok ? 'ok ' + (inner.rows || '') + '行' : (inner.error || 'fail'))) + '';
      } catch (e) { brief = '非 JSON 响应'; }
      log('POST ' + ip + ' ' + (buf.length / 1024).toFixed(0) + 'KB → ' + r.status + ' · ' + ms + 'ms · ' + brief);
      res.writeHead(r.status, Object.assign({ 'Content-Type': r.type }, cors));
      res.end(r.body);
    }).catch((e) => {
      log('ERR  ' + ip + ' ' + e.message);
      send(res, 502, {
        ok: false,
        error: '中转没能连上金山：' + e.message,
      }, cors);
    });
  });

  req.on('error', (e) => {
    log('REQERR ' + ip + ' ' + e.message);
    try { send(res, 400, { ok: false, error: '请求中断' }, cors); } catch (e2) { }
  });
});

server.listen(PORT, HOST, () => {
  log('中转已启动  http://' + HOST + ':' + PORT);
  log('转发目标    ' + KDOCS_URL.replace(/\/script\/[^/]+\//, '/script/***/'));
  log('允许来源    ' + ALLOW_ORIGIN);
  log('');
  log('下一步：用隧道把它暴露到公网，例如');
  log('  cloudflared tunnel --url http://127.0.0.1:' + PORT);
  log('然后把隧道域名填进 docs/assets/config.js 的 report.url（token 留空）');
  log('');
});
