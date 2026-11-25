'use strict';
/**
 * 中转 v2.0 的本地自测 —— 不碰真金山，用 mock 服务模拟三种情形。
 *
 * 跑法： node tools/relay/_test_scf.js
 *
 * 为什么要有它：
 *   中转一改，用户就得重新上传云函数，一轮往返好几分钟。异步/轮询这类
 *   带状态和时序的代码，光看是看不出问题的，必须真跑一遍三种分支。
 */

const http = require('http');
const path = require('path');

const PORT = 18099;
const SCRIPT_PATH = '/api/v3/ide/file/TESTFILE/script/TESTSID';

let mode = 'ok';          // ok | no-async | slow
let pollCount = 0;
let syncHit = 0;
let taskHit = 0;

function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');

  // 异步提交
  if (req.method === 'POST' && u.pathname === SCRIPT_PATH + '/task') {
    taskHit++;
    if (mode === 'no-async') return send(res, 404, { errno: 404, msg: 'not found' });
    return send(res, 200, { task_id: 'T-1', task_type: 'open_air_script' });
  }

  // 同步老路
  if (req.method === 'POST' && u.pathname === SCRIPT_PATH + '/sync_task') {
    syncHit++;
    return send(res, 200, { data: { result: '{"ok":true,"rows":99,"via":"sync"}' }, status: 'finished', error: '' });
  }

  // 轮询
  if (req.method === 'GET' && u.pathname === '/api/v3/script/task') {
    if (u.searchParams.get('task_id') !== 'T-1') return send(res, 400, { errno: 400, msg: 'bad task_id' });
    pollCount++;
    if (mode === 'slow' || pollCount < 3) {
      return send(res, 200, { data: { logs: [], result: null }, status: 'running', error: '' });
    }
    return send(res, 200, {
      data: {
        logs: [{ level: 'info', args: ['score_write v1.1 · 逐行写入版'] }],
        result: '{"ok":true,"rows":3,"photos":2,"via":"async"}',
      },
      status: 'finished',
      error: '',
    });
  }

  send(res, 404, { errno: 404, msg: 'no route ' + req.url });
});

function call(handler, ctx) {
  return handler({ httpMethod: 'POST', body: JSON.stringify({ Context: { argv: { station: '测试站', month: '2026-11' } } }) }, ctx || {});
}

function parseResult(r) {
  const outer = JSON.parse(r.body);
  const raw = outer.data && outer.data.result;
  return raw ? JSON.parse(raw) : outer;
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));

  process.env.KDOCS_URL = 'http://127.0.0.1:' + PORT + SCRIPT_PATH + '/sync_task';
  process.env.KDOCS_TOKEN = 'test-token';
  process.env.TIMEOUT_SEC = '5';
  process.env.ASYNC_POLL_SEC = '6';

  const { main_handler } = require(path.join(__dirname, 'scf.js'));

  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); }
  };

  // ---------- 情形 1：异步正常 ----------
  console.log('\n[1] 异步提交 + 轮询（前两次 running，第三次 finished）');
  mode = 'ok'; pollCount = 0; taskHit = 0; syncHit = 0;
  let r = await call(main_handler);
  let inner = parseResult(r);
  check('HTTP 200', r.statusCode === 200, r.statusCode);
  check('走了异步（/task 命中）', taskHit === 1, 'taskHit=' + taskHit);
  check('没走同步兜底', syncHit === 0, 'syncHit=' + syncHit);
  check('轮询了 3 次', pollCount === 3, 'pollCount=' + pollCount);
  check('结果 ok=true', inner.ok === true, inner);
  check('rows=3 原样带回', inner.rows === 3, inner);
  check('via=async', inner.via === 'async', inner);

  // ---------- 情形 2：异步接口不可用，退回同步 ----------
  console.log('\n[2] 异步接口 404 → 退回 sync_task');
  mode = 'no-async'; pollCount = 0; taskHit = 0; syncHit = 0;
  r = await call(main_handler);
  inner = parseResult(r);
  check('HTTP 200', r.statusCode === 200, r.statusCode);
  check('尝试过异步', taskHit === 1, 'taskHit=' + taskHit);
  check('退回同步且命中一次', syncHit === 1, 'syncHit=' + syncHit);
  check('拿到同步结果 rows=99', inner.rows === 99, inner);
  check('via=sync', inner.via === 'sync', inner);

  // ---------- 情形 3：脚本一直不结束 → pending ----------
  console.log('\n[3] 轮询超时（脚本一直在跑）→ 必须给 pending，不能报失败');
  mode = 'slow'; pollCount = 0; taskHit = 0; syncHit = 0;
  const t0 = Date.now();
  r = await call(main_handler);
  const cost = Date.now() - t0;
  inner = parseResult(r);
  check('HTTP 200（不是 5xx）', r.statusCode === 200, r.statusCode);
  check('ok=false', inner.ok === false, inner.ok);
  check('★ pending=true', inner.pending === true, inner);
  check('带回 taskId 便于追日志', inner.taskId === 'T-1', inner.taskId);
  check('提示里含「核对」字样', /核对/.test(inner.error || ''), inner.error);
  check('总耗时在 6 秒量级（' + Math.round(cost / 1000) + 's）', cost >= 5500 && cost < 12000, cost + 'ms');

  // ---------- 情形 4：按函数剩余时间自动收缩 ----------
  console.log('\n[4] context 只剩 3 秒 → 必须自动收缩，不能死等 6 秒上限');
  mode = 'slow'; pollCount = 0; taskHit = 0; syncHit = 0;
  const t1 = Date.now();
  r = await call(main_handler, { getRemainingTimeInMillis: () => 3000 });
  const cost4 = Date.now() - t1;
  inner = parseResult(r);
  check('仍是 pending 而不是失败', inner.pending === true, inner);
  check('★ 1.5 秒左右就收手（' + Math.round(cost4 / 100) / 10 + 's，上限 6s 未被打满）',
    cost4 < 3000, cost4 + 'ms');

  // ---------- 情形 5：只有 time_limit_in_ms（腾讯云 SCF 的字段） ----------
  console.log('\n[5] context 只给 time_limit_in_ms=8000、上限 6s → 应取 3s（8−5）');
  mode = 'slow'; pollCount = 0; taskHit = 0; syncHit = 0;
  const t2 = Date.now();
  r = await call(main_handler, { time_limit_in_ms: 8000 });
  const cost5 = Date.now() - t2;
  inner = parseResult(r);
  check('仍是 pending', inner.pending === true, inner);
  check('★ 约 3 秒收手（不是 6 秒上限，也不是 1.5 秒）',
    cost5 >= 2700 && cost5 < 4200, cost5 + 'ms');

  server.close();
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('自测崩了：', e);
  process.exit(1);
});
