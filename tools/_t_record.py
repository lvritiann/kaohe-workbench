# -*- coding: utf-8 -*-
"""落表验证：把 record_sync 的写入逻辑套到**真实**《考核记录》副本上，
覆盖 79 行/块（年度表）与 78 行/块（新版）两种版式。

四类站各验一遍：
  首块 华山南   —— 扣分 + NA，分数须与 engine.js 一致
  第 3 块 南沙南 —— 零扣分（meta 有、rec 空），须写 100 / 28 而不是被跳过
  第 6 块 旬阳北 —— 未检查（meta 无），整块须保持模板原样
  末块 略阳西   —— 扣 1 项，须落在自己块内（验证块步长无误）

跑法：python tools/_t_record.py
"""
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys

from openpyxl import load_workbook

ROOT = r"D:/加油站综合考核系统"
INBOX = os.path.join(ROOT, "inbox", "检查表")

# (记录表文件名, 目标 sheet, 期望块步长)
CASES = [
    ("考核记录_2026.xlsx", "2026-11", 79),
    ("考核记录_2027_新版.xlsx", "2027-01", 78),
]

ok_all, fail_all = [], []


def check(name, cond, detail=""):
    (ok_all if cond else fail_all).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (("  " + detail) if detail else ""))


class Cell:
    def __init__(self, ws, addr):
        self.ws, self.addr = ws, addr

    def _parse(self):
        a = self.addr.replace("$", "")
        p, q = (a.split(":") + [a])[:2] if ":" in a else (a, a)
        m1 = re.match(r"([A-Z]+)(\d+)", p)
        m2 = re.match(r"([A-Z]+)(\d+)", q)
        return (int(m1.group(2)), self._col(m1.group(1)),
                int(m2.group(2)), self._col(m2.group(1)))

    @staticmethod
    def _col(s):
        n = 0
        for ch in s:
            n = n * 26 + (ord(ch) - 64)
        return n

    @property
    def Value2(self):
        r1, c1, r2, c2 = self._parse()
        if r1 == r2 and c1 == c2:
            return self.ws.cell(row=r1, column=c1).value
        return [[self.ws.cell(row=r, column=c).value for c in range(c1, c2 + 1)]
                for r in range(r1, r2 + 1)]

    @Value2.setter
    def Value2(self, v):
        r1, c1, _, _ = self._parse()
        if isinstance(v, (list, tuple)) and v and isinstance(v[0], (list, tuple)):
            for i, row in enumerate(v):
                for j, val in enumerate(row):
                    self.ws.cell(row=r1 + i, column=c1 + j, value=val)
        else:
            self.ws.cell(row=r1, column=c1, value=v)


class FakeWs:
    def __init__(self, ws):
        self.ws = ws

    def Range(self, addr):
        return Cell(self.ws, addr)


def load_rs():
    spec = importlib.util.spec_from_file_location(
        "rs", os.path.join(ROOT, "tools", "airscript", "record_sync.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def engine_expect(answers):
    return json.loads(subprocess.check_output(
        ["node", os.path.join(ROOT, "tools", "_t_expect.js"), json.dumps(answers)],
        cwd=ROOT).decode())


def build_rows(items, month, spec):
    """spec: {站名: {序号: (结果,)} }；另可给 ('__all_ok__', True) 表示只登记 meta 的满分站"""
    head = ["月份", "站名", "表类型", "序号", "大类", "检查项目", "标准分", "得分", "结果",
            "说明", "检查人", "提交时间", "照片文件名", "照片附件ID", "折算得分(100)",
            "运营段得分(28)", "一票否决项", "数据来源", "更新时间"]
    rows = [head]
    for st, nos in spec.items():
        if nos is None:                       # 满分站：只有占位行，序号空
            rows.append([month, st, "运营检查", "", "", "本次未发现不符合项", "", "",
                         "符合", "", "测试员", "2026-11-18 15:20", "", "", "100", "28",
                         "", "测试", "2026-11-18 15:20"])
            continue
        for it in items:
            if it["no"] not in nos:
                continue
            a = nos[it["no"]]
            if a == "__skip__":
                continue
            rows.append([month, st, "运营检查", str(it["no"]), it["cat"], it["name"],
                         str(it["score"]), "" if a == "na" else "0",
                         "NA" if a == "na" else "扣分",
                         "" if a == "na" else "现场不符合",
                         "测试员", "2026-11-18 15:20", "p.jpg", "att-1",
                         "", "", "", "测试", "2026-11-18 15:20"])
        # 补一条空序号占位，确保即使全是 NA 也留下 meta 痕迹
        rows.append([month, st, "运营检查", "", "", "", "", "", "", "",
                     "测试员", "2026-11-18 15:20", "", "", "", "", "", "测试",
                     "2026-11-18 15:20"])
    return rows


def run_case(rs, fname, sheet, want_step):
    print("\n=== %s / %s（期望步长 %d）===" % (fname, sheet, want_step))
    src = os.path.join(INBOX, fname)
    copy = os.path.join(INBOX, "_t_副本_%s" % os.path.basename(fname))
    shutil.copyfile(src, copy)
    wb = load_workbook(copy)
    ws = wb[sheet]
    fw = FakeWs(ws)

    items = json.load(open(os.path.join(ROOT, "docs", "data", "items.json"),
                           encoding="utf-8"))["items"]
    no_nos, na_nos = [3, 14, 41], [7, 55]

    starts = rs._block_starts(fw)
    check("%s 探测到 30 块" % fname, len(starts) == 30, "实际 %d" % len(starts))
    steps = sorted(set(starts[i + 1] - starts[i] for i in range(len(starts) - 1)))
    check("%s 步长 = %d" % (fname, want_step), steps == [want_step], str(steps))

    # 模板快照：未检查站写完后必须与快照逐格一致
    def snap(r0):
        return (ws.cell(row=r0, column=1).value,
                ws.cell(row=r0 + rs.OFF_ITEM_START, column=5).value,
                ws.cell(row=r0 + rs.OFF_TAIL, column=1).value,
                ws.cell(row=r0 + rs.OFF_TAIL, column=4).value)

    S = rs.STATIONS
    i_first, i_clean, i_none, i_last = 0, 2, 5, 29
    snap_none = snap(starts[i_none])

    spec = {
        S[i_first]: {n: "na" if n in na_nos else "no" for n in no_nos + na_nos},
        S[i_clean]: None,                      # 零扣分满分
        S[i_last]: {20: "no"},
    }
    rows = build_rows(items, sheet, spec)
    rec, meta, months, dropped = rs._collect(rows)
    check("%s _collect 认到 3 站" % fname, len(meta) == 3, "meta=%s" % list(meta.keys()))

    answers = {str(it["no"]): ("na" if it["no"] in na_nos else
                              ("no" if it["no"] in no_nos else "ok")) for it in items}
    exp_first = engine_expect(answers)
    item20 = next(x for x in items if x["no"] == 20)
    exp_last_conv = round((100 - item20["score"]), 2)
    exp_last_op = round(exp_last_conv / 100 * rs.INSPECT_BASE, 2)

    # 按 main() 的逻辑逐站写
    now = "2026-11-18 16:00"
    written = []
    for i, st in enumerate(S):
        r0 = starts[i]
        key = (st, sheet)
        if key not in meta:                    # 未检查 → 整块不动
            continue
        dct = rec.get(key, {}) or {}
        who, when, veto = meta.get(key, ("", "", ""))
        conv, op, used, conflict = rs._fill_block(fw, r0, dct)
        written.append((st, conv, op, used, conflict))
        ws.cell(row=r0 + rs.OFF_INFO, column=5, value="检查人：%s" % who)
        ws.cell(row=r0 + rs.OFF_INFO, column=7, value="检查日期：%s" % when)
        ws.cell(row=r0 + rs.OFF_INFO, column=9, value="生成 %s" % now)
        ws.cell(row=r0 + rs.OFF_TAIL, column=1, value="折算得分(100)：%s" % conv)
        ws.cell(row=r0 + rs.OFF_TAIL, column=4,
                value="运营段得分(%d)：%s" % (rs.INSPECT_BASE, op))
        ws.cell(row=r0 + rs.OFF_TAIL, column=7, value="一票否决项：%s" % (veto or "无"))

    check("%s 只写了 3 个站块" % fname, len(written) == 3,
          "写了 %s" % [w[0] for w in written])

    def tail(r0, col):
        return ws.cell(row=r0 + rs.OFF_TAIL, column=col).value

    def num(v):
        return float(str(v).split("：")[1])

    r0 = starts[i_first]
    check("%s 华山南 折算 = engine" % fname,
          abs(num(tail(r0, 1)) - exp_first["converted"]) < 0.02,
          "%s vs %.2f" % (tail(r0, 1), exp_first["converted"]))
    check("%s 华山南 运营段 = engine" % fname,
          abs(num(tail(r0, 4)) - exp_first["inspectScore"]) < 0.02,
          "%s vs %.2f" % (tail(r0, 4), exp_first["inspectScore"]))
    check("%s 华山南 尾行标签为 (28)" % fname, "运营段得分(28)" in str(tail(r0, 4)),
          tail(r0, 4))
    na_row = next(r for r in range(r0 + 3, r0 + 76)
                  if ws.cell(row=r, column=1).value == na_nos[0])
    no_row = next(r for r in range(r0 + 3, r0 + 76)
                  if ws.cell(row=r, column=1).value == no_nos[0])
    check("%s NA 项 结果列 = NA" % fname,
          ws.cell(row=na_row, column=6).value == "NA",
          str(ws.cell(row=na_row, column=6).value))
    check("%s 扣分项 得分 = 0" % fname, ws.cell(row=no_row, column=5).value == 0,
          str(ws.cell(row=no_row, column=5).value))
    check("%s 照片文件名写入 H 列" % fname,
          ws.cell(row=no_row, column=8).value == "p.jpg",
          str(ws.cell(row=no_row, column=8).value))
    check("%s 照片附件ID写入 I 列" % fname,
          ws.cell(row=no_row, column=9).value == "att-1",
          str(ws.cell(row=no_row, column=9).value))

    r0 = starts[i_clean]
    check("%s 南沙南（零扣分）折算 = 100" % fname, abs(num(tail(r0, 1)) - 100) < 0.01,
          str(tail(r0, 1)))
    check("%s 南沙南（零扣分）运营段 = 28" % fname, abs(num(tail(r0, 4)) - 28) < 0.01,
          str(tail(r0, 4)))
    check("%s 南沙南 第 1 项得分 = 标准分" % fname,
          ws.cell(row=r0 + rs.OFF_ITEM_START, column=5).value
          == items[0]["score"],
          str(ws.cell(row=r0 + rs.OFF_ITEM_START, column=5).value))

    r0 = starts[i_none]
    check("%s 旬阳北（未检查）整块与模板一致" % fname, snap(r0) == snap_none,
          "现在 %s / 模板 %s" % (snap(r0), snap_none))

    r0 = starts[i_last]
    check("%s 略阳西 落在自己块内" % fname,
          S[i_last] in str(ws.cell(row=r0, column=1).value),
          str(ws.cell(row=r0, column=1).value))
    check("%s 略阳西 折算 = %.2f" % (fname, exp_last_conv),
          abs(num(tail(r0, 1)) - exp_last_conv) < 0.02, str(tail(r0, 1)))
    check("%s 略阳西 运营段 = %.2f" % (fname, exp_last_op),
          abs(num(tail(r0, 4)) - exp_last_op) < 0.02, str(tail(r0, 4)))

    check("%s 合计行公式保留" % fname,
          "SUM" in str(ws.cell(row=starts[0] + 76, column=4).value).upper(),
          str(ws.cell(row=starts[0] + 76, column=4).value))

    wb.save(copy)
    wb.close()
    os.remove(copy)


def main():
    rs = load_rs()
    items = json.load(open(os.path.join(ROOT, "docs", "data", "items.json"), encoding="utf-8"))["items"]
    print("题目 %d 项 · 标准分合计 %d" % (len(items), sum(x["score"] for x in items)))

    for fname, sheet, step in CASES:
        if not os.path.exists(os.path.join(INBOX, fname)):
            check("%s 存在" % fname, False, "文件缺失")
            continue
        run_case(rs, fname, sheet, step)

    # 探测失败必须拒绝写入（不能兜底硬写）
    print("\n=== 块标题缺失 → 必须拒绝写入 ===")
    src = os.path.join(INBOX, "考核记录_2026.xlsx")
    copy = os.path.join(INBOX, "_t_缺标题.xlsx")
    shutil.copyfile(src, copy)
    wb = load_workbook(copy)
    ws = wb["2026-11"]
    ws.cell(row=1, column=1, value="（标题被删）")     # 破坏第 1 块标题
    wb.save(copy)
    wb.close()
    wb2 = load_workbook(copy)
    starts = rs._block_starts(FakeWs(wb2["2026-11"]))
    check("缺 1 个标题 → 探测到 29 块", len(starts) == 29, str(len(starts)))
    check("探测数 ≠ 30 → 应拒绝写入（main 里 return）", len(starts) != len(rs.STATIONS))
    wb2.close()
    os.remove(copy)

    print("\n===== 结果：%d 通过 / %d 失败 =====" % (len(ok_all), len(fail_all)))
    if fail_all:
        for f in fail_all:
            print("  失败：" + f)
        sys.exit(1)


if __name__ == "__main__":
    main()
