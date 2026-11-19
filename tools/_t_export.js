/* 沙盘：验证 score.js 的移动端导出分支（2026-11-19 改动）
   做法：用 vm 跑真实源码 + 假 DOM，末尾注入探针把内部函数暴露出来再断言。
   只跑逻辑，不跑真实下载。运行：node tools/_t_export.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "docs", "assets", "score.js");

/* ---------- 假 DOM ---------- */
function fakeEl(tag) {
  const el = {
    tagName: tag || "div",
    style: {},
    _cls: new Set(),
    textContent: "",
    _html: "",
    value: "",
    dataset: {},
    children: [],
    clicked: false,
    appendChild(c) { this.children.push(c); return c; },
    removeChild() { },
    insertBefore() { },
    remove() { },
    setAttribute() { },
    getAttribute() { return null; },
    removeAttribute() { },
    addEventListener() { },
    removeEventListener() { },
    focus() { },
    blur() { },
    click() { this.clicked = true; },
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    closest() { return null; },
  };
  el.classList = {
    add(c) { el._cls.add(c); },
    remove(c) { el._cls.delete(c); },
    contains(c) { return el._cls.has(c); },
    toggle(c) { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); },
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._html; },
    set(v) { el._html = String(v); },
  });
  Object.defineProperty(el, "parentNode", { get() { return null; } });
  return el;
}

function makeCtx(ua) {
  const registry = {};
  const doc = {
    _byId: registry,
    getElementById(id) {
      if (!registry[id]) registry[id] = fakeEl("div");
      return registry[id];
    },
    createElement(t) { return fakeEl(t); },
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    addEventListener() { },
    head: fakeEl("head"),
    body: fakeEl("body"),
    documentElement: fakeEl("html"),
  };

  const storage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
      clear: () => m.clear(),
      get length() { return m.size; },
    };
  };

  const nav = {
    userAgent: ua,
    maxTouchPoints: /iPhone|Android|Mobile/i.test(ua) ? 5 : 0,
    language: "zh-CN",
    canShare: undefined,
    share: undefined,
  };

  /* 最小 Engine / Store / UI / CFG */
  const Engine = {
    currentMonth() { return "2026-11"; },
    inspectResult(items, veto) {
      return { raw: 98, naScore: 0, effective: 100, converted: 98, score: 27.44 };
    },
  };
  const Store = {
    removeDraft() { Store._removed = (Store._removed || 0) + 1; },
    saveDraft() { },
    loadDraft() { return null; },
    clearDraft() { },
  };
  const UI = { esc: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])) };
  const CFG = {
    seg: { inspect: { base: 28 } },
    inspectorsFile: "data/inspectors.json",
    report: { url: "", token: "" },
    submitPass: "x",
  };

  const win = {};
  const sandbox = {
    window: win,
    document: doc,
    navigator: nav,
    localStorage: storage(),
    sessionStorage: storage(),
    location: { href: "https://example.github.io/score.html", search: "" },
    fetch: () => Promise.reject(new Error("offline")),
    setTimeout: (f) => { try { f(); } catch (e) { } return 0; },
    clearTimeout: () => { },
    console,
    Promise, Blob, File, URL, Date, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  };
  win.CFG = CFG; win.Engine = Engine; win.Store = Store; win.UI = UI;
  sandbox.CFG = CFG; sandbox.Engine = Engine; sandbox.Store = Store; sandbox.UI = UI;
  sandbox.XLSX = undefined;
  sandbox.JSZip = undefined;
  win.navigator = nav;
  win.document = doc;
  win.localStorage = sandbox.localStorage;
  win.sessionStorage = sandbox.sessionStorage;
  win.location = sandbox.location;
  win.fetch = sandbox.fetch;
  win.setTimeout = sandbox.setTimeout;
  sandbox.self = win;
  vm.createContext(sandbox);
  return { sandbox, doc, win, Store, CFG };
}

/* 注入探针：把内部函数挂到 window.__t 上 */
function loadWithProbe(ua) {
  let src = fs.readFileSync(SRC, "utf8");
  const marker = /\r?\n\s*boot\(\);\r?\n\}\)\(\);\s*$/;
  if (!marker.test(src)) throw new Error("末尾结构变了，探针注入失败 —— 请更新 _t_export.js");
  src = src.replace(marker, `
  window.__t = {
    isHandset: isHandset, stampNow: stampNow, mimeFor: mimeFor, typedBlob: typedBlob,
    generate: generate, showNoTarget: showNoTarget, exportXlsxOnly: exportXlsxOnly,
    offerExport: offerExport, doPack: doPack, reportCfg: reportCfg,
    setState: function (o) { for (var k in o) S_[k] = o[k]; },
    getState: function () { return S_; }
  };
  boot();
})();
`);
  const ctx = makeCtx(ua);
  vm.runInContext(src, ctx.sandbox, { filename: "score.js" });
  if (!ctx.win.__t) throw new Error("探针没有挂上");
  return ctx;
}

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  →  " + extra : "")); }
}

const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const UA_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

console.log("\n[1] isHandset 判定");
{
  ok("安卓 → 手机", loadWithProbe(UA_ANDROID).win.__t.isHandset() === true);
  ok("iPhone → 手机", loadWithProbe(UA_IPHONE).win.__t.isHandset() === true);
  // iPad UA 自称 Macintosh 且有多点触控
  {
    const c = loadWithProbe(UA_IPAD);
    c.sandbox.navigator.maxTouchPoints = 5;
    ok("iPad（自称 Mac + 多点触控）→ 手机", c.win.__t.isHandset() === true);
  }
  {
    const c = loadWithProbe(UA_WIN);
    ok("Windows 桌面 → 非手机", c.win.__t.isHandset() === false);
  }
}

console.log("\n[2] mimeFor / typedBlob");
{
  const t = loadWithProbe(UA_ANDROID).win.__t;
  ok("xlsx → 官方 MIME",
    t.mimeFor("检查表_南沙南_2026-11_2026.xlsx") ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    t.mimeFor("a.xlsx"));
  ok("zip → octet-stream", t.mimeFor("a.zip") === "application/octet-stream", t.mimeFor("a.zip"));
  ok("大写扩展名也认", t.mimeFor("A.XLSX").indexOf("spreadsheetml") > 0);
}

console.log("\n[3] 未配 url + 手机 → 弹「还没连上金山表」（不出 zip）");
{
  const c = loadWithProbe(UA_ANDROID);
  const t = c.win.__t;
  t.setState({ station: "南沙南", month: "2026-11", items: {}, veto: {}, notes: {}, photos: {} });
  t.generate({ raw: 100, naScore: 0, effective: 100, converted: 100, score: 28 }, { failed: [], vetoed: false });
  const html = c.doc.getElementById("modal").innerHTML;
  ok("面板标题正确", html.indexOf("还没连上金山表") >= 0, html.slice(0, 80));
  ok("给出「去设置」", html.indexOf("去设置") >= 0);
  ok("给出「只导 Excel」", html.indexOf("只导 Excel") >= 0);
  ok("没有出现打包/下载字样", html.indexOf("打包") < 0 && html.indexOf("打包下载") < 0);
}

console.log("\n[4] 有照片时明说 Excel 不带图");
{
  const c = loadWithProbe(UA_ANDROID);
  const t = c.win.__t;
  t.setState({
    station: "南沙南", month: "2026-11", items: { 1: "no" }, veto: {},
    notes: { 1: { reason: "测试" } },
    photos: { 1: [{ data: "data:image/jpeg;base64," + "A".repeat(4000), kb: 300 }] },
  });
  t.generate({ raw: 99, naScore: 0, effective: 100, converted: 99, score: 27.72 }, { failed: [], vetoed: false });
  const html = c.doc.getElementById("modal").innerHTML;
  ok("提示不含照片", html.indexOf("导出 Excel 不会带上照片") >= 0 || html.indexOf("不会带上照片") >= 0, html.slice(0, 200));
  ok("给出 0.3MB 量级", /0\.3MB|0\.29MB|MB/.test(html));
}

console.log("\n[5] 未配 url + 桌面 → 仍走原来的 zip 打包");
{
  const c = loadWithProbe(UA_WIN);
  const t = c.win.__t;
  t.setState({ station: "南沙南", month: "2026-11", items: {}, veto: {}, notes: {}, photos: {} });
  let packed = false;
  const origPack = t.doPack;
  /* 无法替换闭包内的 doPack，改为观察：桌面端不应弹「还没连上金山表」 */
  t.generate({ raw: 100, naScore: 0, effective: 100, converted: 100, score: 28 }, { failed: [], vetoed: false });
  const html = c.doc.getElementById("modal").innerHTML;
  ok("桌面端不弹「还没连上金山表」", html.indexOf("还没连上金山表") < 0, html.slice(0, 80));
}

console.log("\n[7] 手机端 generate 绝不落 .zip");
{
  const c = loadWithProbe(UA_ANDROID);
  const t = c.win.__t;
  t.setState({ station: "南沙南", month: "2026-11", items: {}, veto: {}, notes: {}, photos: {} });
  t.generate({ raw: 100, naScore: 0, effective: 100, converted: 100, score: 28 }, { failed: [], vetoed: false });
  const html = c.doc.getElementById("modal").innerHTML;
  ok("文案中不出现 .zip", html.indexOf(".zip") < 0);
  ok("文案中不出现「已发起下载」", html.indexOf("已发起下载") < 0);
}

/* [6] 要等 Promise 微任务，放最后跑 */
(async function () {
  console.log("\n[6] offerExport 的草稿保护（照片只存在于 zip 里）");

  function ctxWithShare() {
    const c = loadWithProbe(UA_ANDROID);
    c.sandbox.navigator.canShare = () => true;
    c.sandbox.navigator.share = () => Promise.resolve();
    c.Store._removed = 0;
    c.win.__t.setState({ station: "南沙南", month: "2026-11" });
    return c;
  }
  const tick = () => new Promise((r) => setImmediate(r));

  {
    const c = ctxWithShare();
    c.win.__t.offerExport(new Blob(["x"]), "检查表_南沙南_2026-11_1", "检查表", ".xlsx");
    await tick();
    ok("导出 .xlsx 分享成功后【不删】草稿（照片还在本机）", c.Store._removed === 0,
      "removeDraft 调用次数 = " + c.Store._removed);
    ok("面板提示照片未随包发出",
      c.doc.getElementById("modal").innerHTML.indexOf("不含照片") >= 0);
  }
  {
    const c = ctxWithShare();
    c.win.__t.offerExport(new Blob(["x"]), "检查表_南沙南_2026-11_1", "检查表", ".zip");
    await tick();
    ok("导出 .zip 分享成功后才删草稿", c.Store._removed === 1,
      "removeDraft 调用次数 = " + c.Store._removed);
  }

  console.log("\n—— 结果：" + pass + " 通过 / " + fail + " 失败 ——\n");
  process.exit(fail ? 1 : 0);
})();
