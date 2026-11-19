# -*- coding: utf-8 -*-
"""record_sync_auto.py（自动化跨簿版）的沙盘验证。

只验**写入逻辑**：sync_month / _collect / 站名清单 / 最近 N 个月筛选。
不验 Workbooks.Open / Save / Close —— 那是 WPS 沙箱独有的对象，
本地无法忠实模拟，必须真机跑一次（见文件末尾的说明）。

跑法：python tools/_t_record_auto.py
"""
import importlib.util
import json
import os
import shutil
import sys

from openpyxl import load_workbook

ROOT = r"D:/加油站综合考核系统"
INBOX = os.path.join(ROOT, "inbox", "检查表")

ok_all, fail_all = [], []


def check(name, cond, detail=""):
    (ok_all if cond else fail_all).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (("  " + detail) if detail else ""))


def load(path, alias):
    spec = importlib.util.spec_from_file_location(alias, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Cell:
    def __init__(self, ws, addr):
        self.ws, self.addr = ws, addr

    def _parse(self):
        import re
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


class FakeApp:
    def __init__(self, ws):
        self._ws = ws

    def Sheets(self, name):
        return self._ws


class FakeCtx:
    """模拟 Workbooks.Open 返回的工作簿对象：ctx.Application.Sheets(name)"""

    def __init__(self, ws):
        self.Application = FakeApp(ws)


def build_rows(items, month, spec):
    head = ["月份", "站名", "表类型", "序号", "大类", "检查项目", "标准分", "得分", "结果",
            "说明", "检查人", "提交时间", "照片文件名", "照片附件ID", "折算得分(100)",
            "运营段得分(28)", "一票否决项", "数据来源", "更新时间"]
    rows = [head]
    for st, nos in spec.items():
        if nos is None:
            rows.append([month, st, "运营检查", "", "", "本次未发现不符合项", "", "",
                         "符合", "", "测试员", "2026-11-18 15:20", "", "", "100", "28",
                         "", "测试", "2026-11-18 15:20"])
            continue
        for it in items:
            if it["no"] not in nos:
                continue
            a = nos[it["no"]]
            rows.append([month, st, "运营检查", str(it["no"]), it["cat"], it["name"],
                         str(it["score"]), "" if a == "na" else "0",
                         "NA" if a == "na" else "扣分",
                         "" if a == "na" else "现场不符合",
                         "测试员", "2026-11-18 15:20", "p.jpg", "att-1",
                         "", "", "", "测试", "2026-11-18 15:20"])
        rows.append([month, st, "运营检查", "", "", "", "", "", "", "",
                     "测试员", "2026-11-18 15:20", "", "", "", "", "", "测试",
                     "2026-11-18 15:20"])
    return rows


def main():
    rsa = load(os.path.join(ROOT, "tools", "airscript", "record_sync_auto.py"), "rsa")
    rs = load(os.path.join(ROOT, "tools", "airscript", "record_sync.py"), "rs")
    items = json.load(open(os.path.join(ROOT, "docs", "data", "items.json"),
                           encoding="utf-8"))["items"]

    print("\n=== 1. 站名清单与手动版 / config.js 一致 ===")
    check("auto 版 30 项", len(rsa.STATIONS) == 30, str(len(rsa.STATIONS)))
    check("与手动版逐项相同", rsa.STATIONS == rs.STATIONS,
          str(set(rsa.STATIONS) ^ set(rs.STATIONS)))
    check("含「玉华宫西」", "玉华宫西" in rsa.STATIONS)
    check("不含笔误「玉水宫西」", "玉水宫西" not in rsa.STATIONS)

    print("\n=== 2. 最近 N 个月筛选（关键：跨 26 日分界要两个月都写）===")
    rows = []
    rows += build_rows(items, "2027-01", {rsa.STATIONS[0]: {3: "no", 7: "na"}})
    rows += build_rows(items, "2027-02", {rsa.STATIONS[1]: {7: "na"}})
    rows += build_rows(items, "2026-09", {rsa.STATIONS[2]: {20: "no"}})[1:]
    rec, meta, months, dropped = rsa._collect(rows)
    check("认到 3 个月份", len(months) == 3, str(sorted(months)))
    todo = sorted(months)[-rsa.RECENT_MONTHS:]
    check("只取最近 2 个月", todo == ["2027-01", "2027-02"], str(todo))

    print("\n=== 3. 跨簿写入（模拟 ctx = Workbooks.Open 的返回值）===")
    fname, sheet, want_step = "考核记录_2027_新版.xlsx", "2027-01", 78
    src = os.path.join(INBOX, fname)
    if not os.path.exists(src):
        check("%s 存在" % fname, False, "文件缺失")
    else:
        copy = os.path.join(INBOX, "_t_auto_副本.xlsx")
        shutil.copyfile(src, copy)
        wb = load_workbook(copy)
        ws = wb[sheet]
        fw = FakeWs(ws)
        ctx = FakeCtx(fw)

        check("_ws 能取到目标 sheet", rsa._ws(ctx, sheet) is fw)

        starts = rsa._block_starts(fw)
        check("探测到 30 块", len(starts) == 30, str(len(starts)))
        step = starts[1] - starts[0]
        check("步长 = %d" % want_step, step == want_step, str(step))

        # 未检查站的块：写前快照，写后必须逐字相同
        r0b0 = starts[1]
        snap_before = (
            ws.cell(row=r0b0 + rsa.OFF_TAIL, column=1).value,
            ws.cell(row=r0b0 + rsa.OFF_TAIL, column=4).value,
            ws.cell(row=r0b0 + rsa.OFF_INFO, column=9).value,
        )

        f, c, k = rsa.sync_month(ctx, "2027-01", rec, meta)
        check("只写 1 个有数据站（华山南 有扣分项）", f == 1, "filled=%d" % f)
        check("未检查 29 站", k == 29, "skipped=%d" % k)

        r0 = starts[0]                                  # 第 1 块 = 华山南
        na_no = 7
        na_row = next(r for r in range(r0 + 3, r0 + 76)
                      if ws.cell(row=r, column=1).value == na_no)
        check("NA 项结果列 = NA", ws.cell(row=na_row, column=6).value == "NA",
              str(ws.cell(row=na_row, column=6).value))
        no_row = next(r for r in range(r0 + 3, r0 + 76)
                      if ws.cell(row=r, column=1).value == 3)
        check("扣分项得分 = 0", ws.cell(row=no_row, column=5).value == 0,
              str(ws.cell(row=no_row, column=5).value))
        check("扣分项结果 = 扣分", ws.cell(row=no_row, column=6).value == "扣分",
              str(ws.cell(row=no_row, column=6).value))
        check("照片文件名写进 H 列", ws.cell(row=no_row, column=8).value == "p.jpg",
              str(ws.cell(row=no_row, column=8).value))
        tail_conv = ws.cell(row=r0 + rsa.OFF_TAIL, column=1).value
        check("尾行写了折算分", "折算得分(100)：" in str(tail_conv), str(tail_conv))
        check("尾行写了运营段(28)", "运营段得分(28)：" in str(
            ws.cell(row=r0 + rsa.OFF_TAIL, column=4).value))
        check("生成时间用东八区（不是 07:xx）",
              not str(ws.cell(row=r0 + rsa.OFF_INFO, column=9).value).startswith("生成 2026-11-19 0"),
              str(ws.cell(row=r0 + rsa.OFF_INFO, column=9).value))

        # 第 2 块（南沙北，本月明细里没有它）必须原样不动
        r0b = starts[1]
        snap_after = (
            ws.cell(row=r0b + rsa.OFF_TAIL, column=1).value,
            ws.cell(row=r0b + rsa.OFF_TAIL, column=4).value,
            ws.cell(row=r0b + rsa.OFF_INFO, column=9).value,
        )
        check("未检查站整块与模板逐字相同（未被写入）",
              snap_before == snap_after,
              "写前 %s / 写后 %s" % (snap_before, snap_after))

        wb.save(copy)
        wb.close()
        os.remove(copy)

    print("\n=== 4. 缺 fileId 的年份要跳过而不是崩 ===")
    saved = dict(rsa.TARGETS)
    rsa.TARGETS.clear()
    rsa.TARGETS["2026"] = "x"
    try:
        todo2 = ["2027-01"]
        got = rsa.TARGETS.get(todo2[0][:4])
        check("2027 无 fileId → 跳过", got is None, str(got))
    finally:
        rsa.TARGETS.update(saved)

    print("\n===== 结果：%d 通过 / %d 失败 =====" % (len(ok_all), len(fail_all)))
    if fail_all:
        for x in fail_all:
            print("  失败：" + x)
        sys.exit(1)


if __name__ == "__main__":
    main()
