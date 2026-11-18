/* 用线上 engine.js 算「标准答案」，供链路测试对照。
   node tools/_t_expect.js '<answersJson>'   → 打印 JSON */
global.window = {};
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };
var path = require('path');
var ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'docs', 'assets', 'config.js'));
require(path.join(ROOT, 'docs', 'assets', 'engine.js'));

var data = require(path.join(ROOT, 'docs', 'data', 'items.json'));
var answers = JSON.parse(process.argv[2] || '{}');
var res = window.Engine.inspectResult(data, { items: answers, veto: {} });
console.log(JSON.stringify({
  raw: res.raw, naScore: res.naScore, naCount: res.naCount,
  noCount: res.noCount, effective: res.effective,
  converted: res.converted, inspectScore: res.score,
  base: window.CFG.seg.inspect.base, cap: window.CFG.seg.inspect.cap,
  total: window.CFG.inspect.total
}));
