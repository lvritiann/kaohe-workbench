# -*- coding: utf-8 -*-
"""score_write.js 本地沙盘：用假的 Application / HTTP 跑一遍，验证落表的行列不错位。

不连金山、不连 GitHub，纯内存模拟。
    python tools/_t_direct.py
"""
import json
import os
import re
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, "tools", "airscript", "score_write.js")

HARNESS = r"""
const fs = require('fs');
const vm = require('vm');

/* ---------------- 内存工作表 ---------------- */
function colIdx(letter) {
  let n = 0;
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
}
function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  if (!m) throw new Error('bad ref ' + ref);
  const c1 = colIdx(m[1]), r1 = Number(m[2]) - 1;
  const c2 = m[3] ? colIdx(m[3]) : c1, r2 = m[4] ? Number(m[4]) - 1 : r1;
  return { r1, r2, c1, c2 };
}

function makeSheet(name, initial) {
  const grid = {};   // grid[r][c] = value
  (initial || []).forEach((row, r) => {
    row.forEach((v, c) => {
      if (v !== '' && v !== null && v !== undefined) {
        (grid[r] = grid[r] || {})[c] = v;
      }
    });
  });
  const stats = { writes: 0, formulas: [], images: [], clears: [] };

  function Rng(ref) {
    const { r1, r2, c1, c2 } = parseRef(ref);
    this.ref = ref;
    Object.defineProperty(this, 'Value2', {
      get() {
        const out = [];
        for (let r = r1; r <= r2; r++) {
          const line = [];
          for (let c = c1; c <= c2; c++) {
            line.push((grid[r] && grid[r][c] !== undefined) ? grid[r][c] : '');
          }
          out.push(c2 === c1 ? line : line);
        }
        return out;
      },
      set(v) {
        stats.writes++;
        /* 单格赋标量（字符串/数字）：真实 AirScript 对 Range('J2').Value2 = '文本' 是合法的 */
        if (v === null || typeof v !== 'object') {
          if (!grid[r1]) grid[r1] = {};
          if (v === '' || v === null || v === undefined) delete grid[r1][c1];
          else grid[r1][c1] = v;
          return;
        }
        for (let i = 0; i < v.length; i++) {
          const r = r1 + i;
          if (!grid[r]) grid[r] = {};
          const line = v[i];
          if (line === null || typeof line !== 'object') {
            if (line === '' || line === null || line === undefined) delete grid[r][c1];
            else grid[r][c1] = line;
            continue;
          }
          for (let j = 0; j < line.length; j++) {
            const c = c1 + j;
            if (line[j] === '' || line[j] === null || line[j] === undefined) delete grid[r][c];
            else grid[r][c] = line[j];
          }
        }
      }
    });
    Object.defineProperty(this, 'Formula', {
      set(f) { stats.writes++; stats.formulas.push({ ref, f }); grid[r1] = grid[r1] || {}; grid[r1][c1] = f; },
      get() { return (grid[r1] && grid[r1][c1]) || ''; }
    });
    /* 真实 AirScript：Range('N5').InsertImage('data:image/jpeg;base64,...')
       插的是单元格图片，不写值。这里只登记调用，方便断言。 */
    this.InsertImage = (d) => {
      const str = String(d);
      stats.images.push({ ref: ref, len: str.length, head: str.substring(0, 30) });
      grid[r1] = grid[r1] || {};
      grid[r1][c1] = '[图片]';
    };
    this.Clear = () => { stats.clears.push(ref); if (grid[r1]) delete grid[r1][c1]; };
  }

  return {
    Name: name,
    Range: (ref) => new Rng(ref),
    _grid: grid,
    _stats: stats,
    cell(r, c) { return (grid[r] && grid[r][c] !== undefined) ? grid[r][c] : ''; },
    row(r) { const o = []; for (let c = 0; c < 19; c++) o.push(this.cell(r, c)); return o; },
    usedRows() { let n = 0; Object.keys(grid).forEach(k => { if (Number(k) + 1 > n) n = Number(k) + 1; }); return n; }
  };
}

/* 预置表头（真实表第 1 行） */
const HEAD = ['月份','站名','表类型','序号','大类','检查项目','标准分','得分','结果',
              '说明','检查人','提交时间','照片文件名','照片附件ID','折算得分(100)',
              '运营段得分(28)','一票否决项','数据来源','更新时间'];
const shDetail = makeSheet('检查明细', [HEAD]);

/* ---------------- 73 项：标准分合计 100 ---------------- */
const items = [];
let left = 100;
for (let i = 1; i <= 73; i++) {
  const std = i < 73 ? 1 : left;         // 前 72 项各 1 分，第 73 项补齐
  left -= std;
  items.push({ no: i, cat: '测试大类', name: '项目' + i, std: std, res: 'ok', note: '' });
}
/* 3 号扣分（原因「货架积压」）、7 号 NA、9 号扣分 */
items[2].res = 'no';  items[2].note = '货架积压未清理';
items[6].res = 'na';  items[6].note = '本站无此设备';
items[8].res = 'no';  items[8].note = '价签与实物不符';

const argv = {
  payload: {
    station: '韩城东', month: '2026-11', inspector: '刘龙伟',
    submittedAt: '2026-11-18 22:10', type: '运营检查',
    items: items,
    veto: [],
    vetoItems: [],
    photos: [
      { no: 3, name: 'IMG_0001.jpg', data: 'data:image/jpeg;base64,/9j/AAA=', mime: 'image/jpeg' },
      { no: 3, name: 'IMG_0002.jpg', data: '/9j/BBB=', mime: 'image/jpeg' },
      { no: 9, name: 'IMG_0003.jpg', data: '/9j/CCC=', mime: 'image/jpeg' }
    ]
  }
};

/* ---------------- 假 HTTP：记录每个 PUT ---------------- */
const puts = [];
const HTTP = {
  fetch(url, opts) {
    puts.push({ url: url, method: opts.method, body: opts.body });
    return { status: 201, text: () => '{"content":{"sha":"abc"}}' };
  }
};

const ctx = {
  Application: { Sheets: { Item: (n) => (n === '检查明细' ? shDetail : null) } },
  HTTP: HTTP,
  Context: { argv: argv },
  console: { log: (m) => console.log('  [script] ' + m) }
};
ctx.globalThis = ctx;

let src = fs.readFileSync(process.argv[2], 'utf8');
/* 去掉入口（var __ret = main(); console.log; return），改由下面手动调用 —— 否则顶层 return 在 vm 里会报错 */
src = src.replace(/\nvar __ret = main\(\);[\s\S]*$/, '\n');
vm.runInNewContext(src, ctx);

const out = ctx.main();
const res = JSON.parse(out);
const used1 = shDetail.usedRows();
const images1 = shDetail._stats.images.slice();
const clears1 = shDetail._stats.clears.slice();
const rows1 = (() => { const o = []; for (let r = 0; r < used1; r++) o.push(shDetail.row(r)); return o; })();

/* 同站同月再提一次：必须整体替换，不能叠加 */
const out2 = JSON.parse(ctx.main());
const used2 = shDetail.usedRows();

console.log(JSON.stringify({
  result: res,
  result2: out2,
  writes: shDetail._stats.writes,
  images: images1,
  clears: clears1,
  usedRows: used1,
  usedRows2: used2,
  rows: rows1
}, null, 1));
"""


def main():
    if not os.path.exists(JS):
        print("[ERROR] 找不到", JS)
        return 1
    fd, path = tempfile.mkstemp(suffix=".js")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as f:
        f.write(HARNESS)

    r = subprocess.run(["node", path, JS], capture_output=True, text=True, encoding="utf-8")
    os.unlink(path)
    if r.returncode != 0:
        print("[ERROR] node 跑挂：\n", r.stderr)
        return 1

    raw = r.stdout
    # 前面的 [script] 日志原样打印
    lines = [ln for ln in raw.splitlines() if ln.startswith("  [script]")]
    for ln in lines:
        print(ln)
    json_start = raw.find("{")
    data = json.loads(raw[json_start:])

    print("\n===== 结果 =====")
    print(json.dumps(data["result"], ensure_ascii=False, indent=1))

    fails = []

    def chk(cond, msg):
        if not cond:
            fails.append(msg)

    res = data["result"]
    chk(res.get("ok") is True, "main() 返回 ok=false")

    # 计分：total=100, na=1, 扣 1+1=2 → got=97, eff=99, conv=97.98, op=27.43
    conv = round(97 / 99 * 100, 2)
    op = round(conv / 100 * 28, 2)
    op = min(op, 28)
    chk(abs(res.get("converted", 0) - conv) < 0.02,
        f"折算分应为 {conv}，实得 {res.get('converted')}")
    chk(abs(res.get("op", 0) - op) < 0.02,
        f"运营段应为 {op}，实得 {res.get('op')}")

    # 行数：表头 1 + 3 行明细 = 4
    chk(data["usedRows"] == 4, f"应有 4 行（表头+3），实得 {data['usedRows']}")

    rows = data["rows"]
    head = rows[0]
    chk(head[0] == "月份" and head[18] == "更新时间", "表头被冲掉")

    body = rows[1:]
    chk(all(len(x) == 19 for x in body), "明细行列数不是 19")

    nos = [x[3] for x in body]
    chk(nos == [3, 7, 9], f"写入序号应为 [3,7,9]，实得 {nos}")

    r3 = body[0]
    chk(r3[1] == "韩城东" and r3[0] == "2026-11", "站名/月份写错")
    chk(r3[8] == "扣分" and r3[7] == 0, "3 号应为扣分且得分 0")
    chk(r3[9] == "货架积压未清理", f"扣分原因丢了：{r3[9]!r}")
    chk("IMG_0001" in str(r3[12]), f"3 号照片文件名没写进 M 列：{r3[12]!r}")
    chk("IMG_0002" not in str(r3[12]),
        f"每项只落第 1 张，M 列不该出现第 2 张：{r3[12]!r}")

    r7 = body[1]
    chk(r7[8] == "NA", "7 号应为 NA")
    chk(r7[7] in ("", None), f"NA 项得分列应为空，实得 {r7[7]!r}")

    # 单元格图片：3 号第 1 张 + 9 号 1 张 → 2 次 InsertImage
    # 3 号本来传了 2 张，第 2 张必须被丢掉（N 列一格一张，插第 2 张会盖掉第 1 张）
    imgs = data["images"]
    chk(len(imgs) == 2, f"应插 2 张单元格图片，实得 {len(imgs)} → {imgs}")
    refs = sorted(i["ref"] for i in imgs)
    chk(refs == ["N2", "N4"], f"插图位置应为 N2/N4（3 号、9 号），实得 {refs}")
    for i in imgs:
        chk(i["head"].startswith("data:image/"),
            f"InsertImage 收到的不像 dataURL：{i['head']}")

    # cell 模式不该写 =IMAGE，也不该把照片传出去
    chk(all("=IMAGE" not in (i.get("head") or "") for i in imgs),
        "cell 模式不该写 =IMAGE 公式")
    chk(len(data["clears"]) == 2,
        f"每张插图前应先清空格子（防旧图残留），应 2 次，实得 {len(data['clears'])}")
    chk(data["result"].get("mode") == "cell",
        f"返回值应标明 mode=cell，实得 {data['result'].get('mode')}")

    # 重新提交同一站同一月：应整体替换而不是叠加
    print("\n===== 复跑（同站同月再提一次）=====")
    chk(data["result2"].get("ok") is True, "复跑返回失败")
    chk(data["usedRows2"] == 4,
        f"重复提交后应仍为 4 行，实得 {data['usedRows2']}（叠加了）")

    print("\n===== 断言 =====")
    if fails:
        for f in fails:
            print("[FAIL]", f)
        print(f"\n{len(fails)} 条不通过")
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
