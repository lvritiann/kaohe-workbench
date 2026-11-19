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
    /* video 元素要有这两个：startCamera 里 video.play() 缺了会抛错，
       被 openCamera 的 catch 当成「相机不可用」而回退，测试就会误判 */
    play() { return Promise.resolve(); },
    pause() { },
    load() { },
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

  if (String(tag || "").toLowerCase() === "canvas") {
    el.width = 300;
    el.height = 150;
    el.getContext = () => ({ clearRect() { }, drawImage() { }, translate() { }, scale() { }, canvas: el });
    /* 140000 个 base64 字符 ≈ 105KB，落在 500KB 上限内，压缩循环一轮就结束 */
    el.toDataURL = () => "data:image/jpeg;base64," + "A".repeat(140000);
  }
  return el;
}

/* 假 Image：设 src 后异步触发 onload，尺寸固定 1600×1200（长边正好等于上限，不触发缩放） */
function FakeImage() {
  this.width = 1600;
  this.height = 1200;
  this.onload = null;
  this.onerror = null;
  let _src = "";
  const self = this;
  Object.defineProperty(this, "src", {
    get() { return _src; },
    set(v) {
      _src = v;
      setImmediate(() => { if (self.onload) self.onload(); });
    },
  });
}

function makeCtx(ua, opts) {
  opts = opts || {};
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
    head: null,
    body: null,
  };
  /* 真 DOM 里 appendChild 之后 getElementById 就能找到；沙盘要手动把 id 登记进去，
     否则 camEl() 里的 getElementById('camMask') 永远拿不到刚建的面板 */
  doc.head = fakeEl("head");
  doc.body = fakeEl("body");
  function regChild(parent) {
    parent.appendChild = function (c) {
      if (c && c.id) doc._byId[c.id] = c;
      this.children.push(c);
      return c;
    };
  }
  regChild(doc.head);
  regChild(doc.body);

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
    mediaDevices: undefined,
  };
  if (opts.camera) {
    nav.mediaDevices = {
      getUserMedia(opt) {
        nav._lastOpt = opt;
        if (opts.camera === "deny") {
          const e = new Error("denied");
          e.name = "NotAllowedError";
          return Promise.reject(e);
        }
        return Promise.resolve({
          getTracks: () => [{ stopped: false, stop() { this.stopped = true; } }],
        });
      },
    };
  }
  if (opts.canvas === false) nav._noCanvas = true;

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

  /* 题目数据要喂给 refresh()：shoot 后入库会触发 refresh，DATA 为 null 会直接崩。
     用仓库里真实的 items.json，顺带保证字段名没记错。 */
  let MIN_DATA = null;
  try {
    MIN_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "data", "items.json"), "utf8"));
  } catch (e) { MIN_DATA = { items: [], veto: [], categories: [] }; }

  const win = {};
  const sandbox = {
    window: win,
    document: doc,
    navigator: nav,
    localStorage: storage(),
    sessionStorage: storage(),
    location: { href: "https://example.github.io/score.html", search: "" },
    fetch: (url) => {
      if (String(url).indexOf("items.json") >= 0) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MIN_DATA) });
      }
      return Promise.reject(new Error("offline"));
    },
    setTimeout: (f) => { try { f(); } catch (e) { } return 0; },
    clearTimeout: () => { },
    console,
    Promise, Blob, File, URL, Date, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
    Image: FakeImage,
    setImmediate,
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
function loadWithProbe(ua, opts) {
  let src = fs.readFileSync(SRC, "utf8");
  const marker = /\r?\n\s*boot\(\);\r?\n\}\)\(\);\s*$/;
  if (!marker.test(src)) throw new Error("末尾结构变了，探针注入失败 —— 请更新 _t_export.js");
  src = src.replace(marker, `
  window.__t = {
    stampNow: stampNow, mimeFor: mimeFor, typedBlob: typedBlob,
    generate: generate, showNoTarget: showNoTarget, exportXlsxOnly: exportXlsxOnly,
    offerExport: offerExport, reportCfg: reportCfg,
    camSupported: camSupported, openCamera: openCamera, closeCamera: closeCamera,
    shoot: shoot, deductHtml: deductHtml,
    setFacing: function (v) { camFacing = v; },
    getCamKey: function () { return camKey; },
    setState: function (o) { for (var k in o) S_[k] = o[k]; },
    getState: function () { return S_; }
  };
  boot();
})();
`);
  const ctx = makeCtx(ua, opts);
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

console.log("\n[1] mimeFor / typedBlob");
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
  ok("给出「先存一份 Excel」", html.indexOf("先存一份 Excel") >= 0);
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

console.log("\n[5] 桌面端也一样：不再有 zip 备胎，统一引导直落表");
{
  const c = loadWithProbe(UA_WIN);
  const t = c.win.__t;
  t.setState({ station: "南沙南", month: "2026-11", items: {}, veto: {}, notes: {}, photos: {} });
  t.generate({ raw: 100, naScore: 0, effective: 100, converted: 100, score: 28 }, { failed: [], vetoed: false });
  const html = c.doc.getElementById("modal").innerHTML;
  ok("桌面端同样弹「还没连上金山表」", html.indexOf("还没连上金山表") >= 0, html.slice(0, 80));
  ok("桌面端也没有 zip 字样", html.indexOf(".zip") < 0);
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
  const tick = () => new Promise((r) => setImmediate(r));

  function ctxWithShare() {
    const c = loadWithProbe(UA_ANDROID);
    c.sandbox.navigator.canShare = () => true;
    c.sandbox.navigator.share = () => Promise.resolve();
    c.Store._removed = 0;
    c.win.__t.setState({ station: "南沙南", month: "2026-11" });
    return c;
  }

  console.log("\n[6] 导 Excel 时保住草稿（xlsx 里没有照片）");
  {
    const c = ctxWithShare();
    c.win.__t.offerExport(new Blob(["x"]), "检查表_南沙南_2026-11_1", "检查表");
    await tick();
    ok("分享成功后【不删】草稿", c.Store._removed === 0, "removeDraft 次数 = " + c.Store._removed);
    ok("面板明说照片没随包发出", c.doc.getElementById("modal").innerHTML.indexOf("不含照片") >= 0);
    ok("文件名是 .xlsx", c.doc.getElementById("modal").innerHTML.indexOf(".xlsx") >= 0);
  }

  console.log("\n[8] 原生相机（三星拍不了照的正解）");
  {
    const c = loadWithProbe(UA_ANDROID);
    ok("没有 mediaDevices 时 camSupported=false", c.win.__t.camSupported() === false);
  }
  {
    const c = loadWithProbe(UA_ANDROID, { camera: true });
    ok("有 getUserMedia 时 camSupported=true", c.win.__t.camSupported() === true);
  }
  {
    /* 入口必须是 button + data-cam，不能再靠 input 的 capture */
    const c = loadWithProbe(UA_ANDROID, { camera: true });
    c.win.__t.setState({ photos: {}, notes: {}, items: { 1: "no" } });
    const html = c.win.__t.deductHtml(1, false);
    ok("拍照入口是 button[data-cam]", /<button[^>]*data-cam="1"/.test(html), html.slice(0, 120));
    ok("保留了隐藏的 capture input 作兜底", html.indexOf('id="camfallback-1"') >= 0);
    ok("相册入口还在", html.indexOf("从相册选") >= 0);
  }
  {
    /* 正常开相机：拿后置、面板显示、记下 key */
    const c = loadWithProbe(UA_ANDROID, { camera: true });
    const t = c.win.__t;
    t.setState({ photos: {}, notes: {}, items: { 3: "no" } });
    t.openCamera("3");
    await tick();
    ok("面板已显示", c.doc.getElementById("camMask")._cls.has("on"));
    ok("camKey 记住了项号", t.getCamKey() === "3");
    ok("默认要后置摄像头",
      c.sandbox.navigator._lastOpt.video.facingMode === "environment",
      JSON.stringify(c.sandbox.navigator._lastOpt.video));
  }
  {
    /* 拍照出图 → 压缩 → 入库，且摄像头必须被关掉 */
    const c = loadWithProbe(UA_ANDROID, { camera: true });
    const t = c.win.__t;
    t.setState({ photos: { 5: [] }, notes: { 5: { reason: "x" } }, items: { 5: "no" } });
    t.openCamera("5");
    await tick();
    const v = c.doc.getElementById("camVideo");
    v.videoWidth = 1600;
    v.videoHeight = 1200;
    t.shoot();
    await tick();
    await tick();
    const st = t.getState();
    ok("照片已入库", (st.photos["5"] || []).length === 1, JSON.stringify((st.photos["5"] || []).length));
    ok("入库的是 jpeg dataURL", /^data:image\/jpeg/.test((st.photos["5"][0] || {}).data || ""));
    ok("带 kb 体积提示", typeof (st.photos["5"][0] || {}).kb === "number");
    ok("拍完自动关面板", c.doc.getElementById("camMask")._cls.has("on") === false);
    ok("拍完 camKey 已释放", t.getCamKey() === null);
  }
  {
    /* 名额已满 → 不打开相机 */
    const c = loadWithProbe(UA_ANDROID, { camera: true });
    const t = c.win.__t;
    t.setState({ photos: { 7: [{ data: "data:image/jpeg;base64,AA", kb: 10 }] }, items: { 7: "no" } });
    t.openCamera("7");
    await tick();
    ok("满额时不打开相机", c.doc.getElementById("camMask")._cls.has("on") === false);
  }
  {
    /* 授权被拒 → 回退到隐藏 input（相册里仍能选图） */
    const c = loadWithProbe(UA_ANDROID, { camera: "deny" });
    const t = c.win.__t;
    t.setState({ photos: {}, notes: {}, items: { 9: "no" } });
    t.openCamera("9");
    await tick();
    await tick();
    ok("拒绝授权时不留在相机面板", c.doc.getElementById("camMask")._cls.has("on") === false);
    ok("回退点了隐藏 input", c.doc.getElementById("camfallback-9").clicked === true);
  }

  console.log("\n—— 结果：" + pass + " 通过 / " + fail + " 失败 ——\n");
  process.exit(fail ? 1 : 0);
})();
