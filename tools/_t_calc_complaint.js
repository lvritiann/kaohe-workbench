/* calc.html 投诉区块运行期冒烟测试
 *
 * 用最小假 DOM 把 calc.html 的内联脚本跑起来，验证：
 *   1. 页面初始化不抛错（fetch → pick → render 全链路）
 *   2. 「投诉扣分」卡片能渲染，三档填完算式与扣分正确
 *   3. 勾选重大投诉 → 一票否决，合计归 0
 *   4. 换站时投诉件数归零（不串站）
 *
 * 用法：node tools/_t_calc_complaint.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const DOCS = path.join(ROOT, 'docs');
let FAIL = [];
const chk = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) FAIL.push(m); };

/* ---------------- 最小假 DOM ---------------- */
const els = {};
function el(id) {
  if (els[id]) return els[id];
  const e = {
    id, value: '', checked: false, textContent: '', innerHTML: '',
    style: {}, children: [],
    appendChild(x) { this.children.push(x); },
    addEventListener(t, f) { (this._h = this._h || {})[t] = f; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  els[id] = e;
  return e;
}
const docHandlers = {};
global.document = {
  getElementById: el,
  createElement: (t) => ({ tag: t, value: '', textContent: '', style: {} }),
  addEventListener: (t, f) => { (docHandlers[t] = docHandlers[t] || []).push(f); },
  body: el('__body'),
  documentElement: el('__html')
};
global.window = global;
global.navigator = { userAgent: 'node-test' };

/* fetch 直接读本地 json */
global.fetch = (url) => {
  const p = path.join(DOCS, url.split('?')[0]);
  if (!fs.existsSync(p)) return Promise.reject(new Error('404 ' + url));
  const txt = fs.readFileSync(p, 'utf8');
  return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(txt)) });
};

/* UI / Status 桩 */
function loadScript(rel) { vm.runInThisContext(fs.readFileSync(path.join(DOCS, rel), 'utf8'), { filename: rel }); }
global.UI = { tabbar() {}, esc: (s) => String(s == null ? '' : s) };
global.Status = { load: () => Promise.resolve(), label: () => null };
global.CFG = undefined;

loadScript('assets/config.js');
loadScript('assets/engine.js');

const html = fs.readFileSync(path.join(DOCS, 'calc.html'), 'utf8');
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).pop()
  .replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
vm.runInThisContext(inline, { filename: 'calc.html:inline' });

/* ---------------- 跑起来 ---------------- */
(async function () {
  console.log('\n[1] 初始化（fetch → 填站名 → pick → render）');
  await new Promise(r => setTimeout(r, 50));
  chk(typeof pick === 'function', 'pick 可调用');
  chk(els.fStation && els.fStation.children.length > 0, '油站下拉已填充 ' + (els.fStation.children.length) + ' 项');
  chk(String(els.days.value) !== '', '会计月天数已带出：' + els.days.value);

  pick('汉中');
  let h = els.out.innerHTML;
  chk(h.length > 0, '结果区已渲染（' + h.length + ' 字符）');
  chk(h.indexOf('投诉扣分') >= 0, '出现「投诉扣分」行');
  chk(h.indexOf('无投诉 · 0') >= 0, '默认无投诉');
  chk(els.extraCard.style.display === 'block', '投诉卡片已显示');

  console.log('\n[2] 填三档 → 算式与扣分');
  els.cEsc.value = '2'; els.cRep.value = '1'; els.cReg.value = '1';
  compute();
  h = els.out.innerHTML;
  chk(h.indexOf('投诉扣分（4 件）') >= 0, '件数显示 4');
  chk(h.indexOf('升级 2×10 ＋ 重复 1×20 ＋ 监管 1×50 ＝ −90.00（共 4 件）') >= 0,
    '算式与扣分 = −90.00');
  const m = h.match(/合计<\/span><b>(-?[\d.]+) 分/);
  chk(!!m, '合计已渲染：' + (m ? m[1] : '未找到'));

  console.log('\n[3] 重大投诉 → 一票否决');
  els.cMajor.checked = true;
  compute();
  h = els.out.innerHTML;
  chk(h.indexOf('重大投诉 → 一票否决') >= 0, '出现否决提示');
  const m2 = h.match(/合计<\/span><b>(-?[\d.]+) 分/);
  chk(m2 && Math.abs(parseFloat(m2[1])) < 1e-9, '合计归 0（实际 ' + (m2 ? m2[1] : '未找到') + '）');

  console.log('\n[4] 换站归零，不串站');
  pick('富平');
  chk(els.cEsc.value === '0' && els.cRep.value === '0' && els.cReg.value === '0', '三档件数已归零');
  chk(els.cMajor.checked === false, '重大投诉已取消勾选');
  chk(els.out.innerHTML.indexOf('无投诉 · 0') >= 0, '新站显示无投诉');

  console.log('\n[5] 件数清空也不炸');
  els.cEsc.value = ''; els.cRep.value = 'abc'; els.cReg.value = '-1';
  compute();
  chk(els.out.innerHTML.indexOf('投诉扣分') >= 0, '非法输入仍能渲染');

  console.log('\n' + '='.repeat(58));
  if (FAIL.length) {
    console.log('失败 ' + FAIL.length + ' 项：');
    FAIL.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过');
})();
