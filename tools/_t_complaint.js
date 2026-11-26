/* 投诉三档回归测试（Node 直接跑，不需要浏览器）
 *
 * 验证方案第八章（一）的四档口径真的落到了 engine.js：
 *   一般升级投诉 10 分/件 · 重复投诉 20 分/件 · 监管介入 50 分/件 · 重大投诉一票否决
 * 以及旧格式（直接给总扣分 complaint）仍然兼容。
 *
 * 用法：node tools/_t_complaint.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
global.window = {};
eval(fs.readFileSync(path.join(ROOT, 'docs/assets/config.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'docs/assets/engine.js'), 'utf8'));

const E = window.Engine;
const CFG = window.CFG;
let FAIL = [];

function chk(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) FAIL.push(msg);
}
function eq(a, b, msg) { chk(Math.abs(a - b) < 1e-9, msg + '（实际 ' + a + '，应 ' + b + '）'); }

/* 四项满配：油40 + 非10 + 人效12 + 现场(5+28+5)=38 = 100 */
const BASE = {
  oilScore: 40, nonoilScore: 10, effScore: 12,
  primaryScore: 5, inspectScore: 28, mysteryScore: 5
};
function withC(c) { return Object.assign({}, BASE, c); }

console.log('\n[1] 三档单算');
eq(E.complaintOf({ escalate: 1 }).deduct, 10, '一般升级投诉 1 件 = 10');
eq(E.complaintOf({ repeat: 1 }).deduct, 20, '重复投诉 1 件 = 20');
eq(E.complaintOf({ regulator: 1 }).deduct, 50, '监管介入 1 件 = 50');
eq(E.complaintOf({ escalate: 3 }).deduct, 30, '一般升级投诉 3 件 = 30');
eq(E.complaintOf({ repeat: 2 }).deduct, 40, '重复投诉 2 件 = 40');

console.log('\n[2] 三档混合');
const mix = E.complaintOf({ escalate: 2, repeat: 1, regulator: 1 });
eq(mix.deduct, 90, '2×10 + 1×20 + 1×50 = 90');
eq(mix.count, 4, '总件数 4');
chk(mix.basis === 'tiers', '来源标记为 tiers（实际 ' + mix.basis + '）');

console.log('\n[3] 重大投诉 = 一票否决，不按分扣');
const maj = E.complaintOf({ major: true });
chk(maj.vetoed === true, 'major → vetoed');
eq(maj.deduct, 0, '重大投诉本身不产生扣分数');
eq(E.composite(withC({ major: true })), 0, '综合记 0 分');
eq(E.composite(withC({ major: true, escalate: 5 })), 0, '既有件数又有重大投诉 → 仍记 0');

console.log('\n[4] 旧格式兼容（直接给总扣分）');
const old = E.complaintOf({ complaint: 25 });
eq(old.deduct, 25, 'complaint:25 → 扣 25');
chk(old.basis === 'legacy', '来源标记为 legacy（实际 ' + old.basis + '）');
eq(E.composite(withC({ complaint: 25 })), 75, '综合 100 − 25 = 75');

console.log('\n[5] 件数优先于旧总数');
const both = E.complaintOf({ complaint: 999, escalate: 1 });
eq(both.deduct, 10, '件数为 1 时按件算 10，不采信 999');
chk(both.basis === 'tiers', '来源标记为 tiers（实际 ' + both.basis + '）');

console.log('\n[6] 综合得分真接上了扣分');
eq(E.totalBase(), 100, '四项基准合计 100');
eq(E.composite(BASE), 100, '无投诉 = 100');
eq(E.composite(withC({ escalate: 1 })), 90, '1 件升级投诉 → 90');
eq(E.composite(withC({ repeat: 1 })), 80, '1 件重复投诉 → 80');
eq(E.composite(withC({ regulator: 1 })), 50, '1 件监管介入 → 50');
eq(E.composite(withC({ escalate: 1, repeat: 1 })), 70, '升级+重复 → 70');

console.log('\n[7] 不设下限（可为负） / 仍受 120 封顶');
eq(E.composite(withC({ regulator: 3 })), -50, '监管 3 件 → 100 − 150 = −50');
eq(E.composite({ oilScore: 50, nonoilScore: 12, effScore: 20, primaryScore: 5, inspectScore: 28, mysteryScore: 5 }), 120, '满配 120');
eq(E.composite({ oilScore: 50, nonoilScore: 12, effScore: 20, primaryScore: 5, inspectScore: 28, mysteryScore: 5, complaint: 30 }), 90, '120 − 30 = 90');

console.log('\n[8] 与 config 档位一致（防以后改配置没同步）');
chk(CFG.complaint.escalate === 10, 'config 升级投诉 10');
chk(CFG.complaint.repeat === 20, 'config 重复投诉 20');
chk(CFG.complaint.regulator === 50, 'config 监管介入 50');
chk(CFG.complaint.major === 'veto', 'config 重大投诉 = veto');
eq(E.complaintDeduct({ escalate: 1 }), CFG.complaint.escalate, 'complaintDeduct 仍可用（旧调用签名）');

console.log('\n' + '='.repeat(58));
if (FAIL.length) {
  console.log('失败 ' + FAIL.length + ' 项：');
  FAIL.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部通过');
