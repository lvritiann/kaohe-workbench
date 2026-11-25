# -*- coding: utf-8 -*-
"""record_sync 块布局与计分回归测试（不依赖金山环境）

验证点：
  1. _block_layout 能正确定位 73 项旧块（78 行 / 79 行两种）与 80 项新块（85 行 / 86 行）
  2. _fill_block 在两种块上都能把 E:I 写对，且折算分/运营段算对
  3. 合计行缺失时能按块步长兜底，不静默写错

用法：python tools/_t_record_layout.py
"""
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "record_sync", os.path.join(ROOT, "tools", "airscript", "record_sync.py"))
rs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rs)

FAIL = []


def chk(cond, msg):
    if cond:
        print("  ok   %s" % msg)
    else:
        print("  FAIL %s" % msg)
        FAIL.append(msg)


# ---------------------------------------------------------------- Range mock
class FakeRange:
    def __init__(self, ws, ref):
        self.ws = ws
        self.ref = ref

    def _parse(self):
        r = self.ref
        if ":" in r:
            a, b = r.split(":")
            return a, b
        return r, r

    @staticmethod
    def _split(cell):
        col = ""
        for ch in cell:
            if ch.isalpha():
                col += ch
            else:
                break
        return col.upper(), int(cell[len(col):])

    @staticmethod
    def _ci(col):
        n = 0
        for ch in col:
            n = n * 26 + (ord(ch) - 64)
        return n - 1

    @staticmethod
    def _cl(i):
        s = ""
        i += 1
        while i:
            i, rem = divmod(i - 1, 26)
            s = chr(65 + rem) + s
        return s

    def _cells(self):
        a, b = self._parse()
        c1, r1 = self._split(a)
        c2, r2 = self._split(b)
        return self._ci(c1), r1, self._ci(c2), r2

    @property
    def Value2(self):
        c1, r1, c2, r2 = self._cells()
        g = self.ws.grid
        if r1 == r2 and c1 == c2:
            return g[r1 - 1][c1] if r1 - 1 < len(g) and c1 < len(g[r1 - 1]) else None
        out = []
        for r in range(r1, r2 + 1):
            row = g[r - 1] if r - 1 < len(g) else []
            out.append([(row[c] if c < len(row) else None) for c in range(c1, c2 + 1)])
        return out

    @Value2.setter
    def Value2(self, val):
        c1, r1, c2, r2 = self._cells()
        g = self.ws.grid
        while len(g) < r2:
            g.append([])
        if r1 == r2 and c1 == c2:
            row = g[r1 - 1]
            while len(row) <= c1:
                row.append(None)
            row[c1] = val
            return
        for i, r in enumerate(range(r1, r2 + 1)):
            row = g[r - 1]
            while len(row) <= c2:
                row.append(None)
            src = val[i] if i < len(val) else []
            for j, c in enumerate(range(c1, c2 + 1)):
                row[c] = src[j] if j < len(src) else None


class FakeWS:
    def __init__(self, nrows):
        self.grid = [[None] * 9 for _ in range(nrows)]

    def Range(self, ref):
        return FakeRange(self, ref)


# ---------------------------------------------------------------- 造块
def make_block(ws, r0, items, blank_tail=False):
    """r0 为 1-based 标题行。items: [(no, std)]"""
    ws.Range("A%d" % r0).Value2 = "二级运营检查记录"
    ws.Range("A%d" % (r0 + 2)).Value2 = "序号"
    for i, (no, std) in enumerate(items):
        r = r0 + 3 + i
        ws.Range("A%d" % r).Value2 = no
        ws.Range("D%d" % r).Value2 = std
    tr = r0 + 3 + len(items)
    ws.Range("A%d" % tr).Value2 = "合计"
    ws.Range("G%d" % tr).Value2 = sum(s for _, s in items)
    if blank_tail:
        ws.Range("A%d" % (tr + 2)).Value2 = None


def std_items(n, per):
    return [(i + 1, per[i]) for i in range(n)]


def main():
    # ---------- 情形 1：73 项 · 78 行/块（新版无空行） ----------
    print("\n[1] 73 项 / 78 行每块")
    per73 = [2] * 27 + [1] * 46          # 27*2+46 = 100
    ws = FakeWS(78 * 2 + 5)
    make_block(ws, 1, std_items(73, per73))
    make_block(ws, 79, std_items(73, per73))
    starts = rs._block_starts(ws)
    chk(starts == [1, 79], "块起点探测 = %s" % starts)
    a, b, tail, cnt, how = rs._block_layout(ws, 1, 79)
    chk((a, b, tail, cnt) == (4, 76, 78, 73), "布局 a=%d b=%d tail=%d cnt=%d how=%s" % (a, b, tail, cnt, how))
    chk(how == "probe", "靠「合计」行探测（不是步长兜底）")

    # ---------- 情形 2：73 项 · 79 行/块（年度表，块尾多 1 空行） ----------
    print("\n[2] 73 项 / 79 行每块（块尾分页空行）")
    ws2 = FakeWS(79 * 2 + 5)
    make_block(ws2, 1, std_items(73, per73))
    make_block(ws2, 80, std_items(73, per73))
    starts2 = rs._block_starts(ws2)
    chk(starts2 == [1, 80], "块起点探测 = %s" % starts2)
    a, b, tail, cnt, how = rs._block_layout(ws2, 1, 80)
    chk((a, b, tail, cnt) == (4, 76, 78, 73), "布局 a=%d b=%d tail=%d cnt=%d how=%s" % (a, b, tail, cnt, how))

    # ---------- 情形 3：80 项 · 85 行/块（新口径） ----------
    print("\n[3] 80 项 / 85 行每块（8.21 新表）")
    per80 = [2] * 27 + [1] * 53          # 27*2+53 = 107 → 太高，改用真实分布
    # 真实：2 分项 14 个，1 分项 66 个 → 28+66 = 94？不对，重算：
    # 8.21 明细：2 分 14 项（28）+ 1 分 66 项（66）= 94 ≠ 100
    # 实际逐个核过：2 分项 22 个（44）+ 1 分项 58 个（58）= 102？
    # 用 items.json 真实分值，避免手算出错
    import json
    import io
    d = json.load(io.open(os.path.join(ROOT, "docs", "data", "items.json"), encoding="utf-8"))
    per80 = [it["score"] for it in d["items"]]
    chk(len(per80) == 80 and sum(per80) == 100,
        "items.json 80 项 / 合计 %d 分" % sum(per80))
    ws3 = FakeWS(85 * 2 + 5)
    make_block(ws3, 1, std_items(80, per80))
    make_block(ws3, 86, std_items(80, per80))
    starts3 = rs._block_starts(ws3)
    chk(starts3 == [1, 86], "块起点探测 = %s" % starts3)
    a, b, tail, cnt, how = rs._block_layout(ws3, 1, 86)
    chk((a, b, tail, cnt) == (4, 83, 85, 80), "布局 a=%d b=%d tail=%d cnt=%d how=%s" % (a, b, tail, cnt, how))

    # ---------- 情形 4：合计行缺失 → 步长兜底 ----------
    print("\n[4] 合计行缺失时的兜底（不能写错行）")
    ws4 = FakeWS(85 * 2 + 5)
    make_block(ws4, 1, std_items(80, per80))
    ws4.Range("A84").Value2 = None        # 抹掉「合计」
    make_block(ws4, 86, std_items(80, per80))
    a, b, tail, cnt, how = rs._block_layout(ws4, 1, 86)
    chk(how == "seq", "退化为「最后序号行」推算（how=%s）" % how)
    chk(tail == 85, "尾行仍为 85（实际 %d）" % tail)
    chk(b == 83, "明细末尾仍为 83（实际 %d）" % b)

    # ---------- 情形 5：计分正确性（扣 1 项 2 分 + 1 项 NA 1 分） ----------
    print("\n[5] 计分：扣 1 项(2分) + NA 1 项(1分)，其余符合")
    ws5 = FakeWS(85 + 5)
    make_block(ws5, 1, std_items(80, per80))
    a, b, tail, cnt, how = rs._block_layout(ws5, 1, 86)
    dct = {5: (None, "扣分", "灭火器过期", "p1.jpg", ""),
           8: (None, "NA", "无此项", "", "")}
    conv, op, used, conflict = rs._fill_block(ws5, 1, dct, a, b)
    got = 100 - per80[4] - per80[7]
    exp_conv = round(got / 100.0 * 100, 2)      # NA 项不进分母时：got/(100-NA)
    exp_conv = round(got / (100 - per80[7]) * 100, 2)
    chk(used == {5, 8}, "已消费序号 = %s" % sorted(used))
    chk(abs(conv - exp_conv) < 0.02, "折算分 %s（应 %.2f）" % (conv, exp_conv))
    chk(abs(op - round(conv / 100 * 28, 2)) < 0.02, "运营段 %s" % op)
    chk(ws5.Range("E%d" % (4 + 4)).Value2 == 0 or ws5.Range("E%d" % 8).Value2 == 0,
        "第 5 项得 0 分已写入 E 列")
    chk(ws5.Range("E%d" % 11).Value2 == "NA", "第 8 项写 NA（实际 %s）" % ws5.Range("E%d" % 11).Value2)
    chk(ws5.Range("F%d" % 11).Value2 == "NA", "第 8 项结果列 = NA")

    # ---------- 情形 6：旧 73 项块上跑同一套代码 ----------
    print("\n[6] 同一脚本在 73 项旧块上不串行")
    ws6 = FakeWS(78 * 2 + 5)
    make_block(ws6, 1, std_items(73, per73))
    make_block(ws6, 79, std_items(73, per73))
    a, b, tail, cnt, how = rs._block_layout(ws6, 1, 79)
    conv, op, used, conflict = rs._fill_block(ws6, 1, {3: (None, "扣分", "x", "", "")}, a, b)
    chk(used == {3}, "旧块消费序号 = %s" % sorted(used))
    chk(abs(conv - round((100 - per73[2]) / 100 * 100, 2)) < 0.02, "旧块折算分 = %s" % conv)

    print("\n" + "=" * 60)
    if FAIL:
        print("失败 %d 项：" % len(FAIL))
        for f in FAIL:
            print("  -", f)
        sys.exit(1)
    print("全部通过")


if __name__ == "__main__":
    main()
