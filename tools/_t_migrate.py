# -*- coding: utf-8 -*-
"""record_migrate_80 回归测试（模拟金山表格，不碰真表）

验证：
  1. 30 块 × 73 项 → 30 块 × 80 项，序号/项目/分值逐项正确，合计 100
  2. 已录过得分（E 列有值）的表默认拒绝改版式
  3. FORCE=True 时才放行
  4. dry 模式一格不改
  5. 已经是 80 项的表不重复插行（幂等）

用法：python tools/_t_migrate.py
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "airscript", "record_migrate_80.py")

FAIL = []


def chk(cond, msg):
    if cond:
        print("  ok   %s" % msg)
    else:
        print("  FAIL %s" % msg)
        FAIL.append(msg)


class FakeRange:
    def __init__(self, ws, ref):
        self.ws = ws
        self.ref = ref
        self.NumberFormat = None

    def _parse(self):
        r = self.ref
        return r.split(":") if ":" in r else (r, r)

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

    def EntireRow(self):
        return self

    def Insert(self, *a):
        self.ws._insert(self._split(self.ref)[1], 1)


class FakeRows:
    def __init__(self, ws, ref):
        self.ws = ws
        self.ref = ref

    def Insert(self, *a):
        if ":" in self.ref:
            x, y = self.ref.split(":")
            at, n = int(x), int(y) - int(x) + 1
        else:
            at, n = int(self.ref), 1
        self.ws._insert(at, n)


class FakeWS:
    def __init__(self, name, nrows, ncols=9):
        self.Name = name
        self.grid = [[None] * ncols for _ in range(nrows)]

    def Range(self, ref):
        return FakeRange(self, ref)

    def Rows(self, ref):
        return FakeRows(self, ref)

    def _insert(self, at, n):
        self.grid[at - 1:at - 1] = [[None] * 9 for _ in range(n)]


class FakeSheets:
    def __init__(self, lst):
        self._lst = lst
        self.Count = len(lst)

    def Item(self, i):
        if isinstance(i, int):
            return self._lst[i - 1]
        for s in self._lst:
            if s.Name == i:
                return s
        raise KeyError(i)

    def __call__(self, i):
        return self.Item(i)


class FakeApp:
    def __init__(self, sheets):
        self.Sheets = sheets


def build_sheet(name, nblocks=30, ncols=9, filled=False, blank_tail=False):
    """造一张 30 块 × 73 项的月表"""
    import json
    old = json.load(io.open(os.path.join(ROOT, "inbox", "_backup",
                                         sorted(f for f in os.listdir(os.path.join(ROOT, "inbox", "_backup"))
                                                if f.startswith("items_V2.1"))[0]),
                            encoding="utf-8"))
    its = [(i["no"], i["cat"], i["name"], i["score"]) for i in old["items"]]
    per = nblocks * (78 + (1 if blank_tail else 0)) + 10
    ws = FakeWS(name, per, ncols)
    for b in range(nblocks):
        r0 = 1 + b * (78 + (1 if blank_tail else 0))
        ws.Range("A%d" % r0).Value2 = "二级运营检查记录（%d）" % (b + 1)
        ws.Range("A%d" % (r0 + 2)).Value2 = "序号"
        for k, (no, cat, nm, sc) in enumerate(its):
            r = r0 + 3 + k
            ws.Range("A%d" % r).Value2 = no
            ws.Range("B%d" % r).Value2 = cat
            ws.Range("C%d" % r).Value2 = nm
            ws.Range("D%d" % r).Value2 = sc
            if filled and k == 4:
                ws.Range("E%d" % r).Value2 = 1.5
        ws.Range("A%d" % (r0 + 3 + 73)).Value2 = "合计"
    return ws


def load_module():
    src = io.open(SRC, encoding="utf-8").read()
    # 去掉末尾的 main() 调用，手动控制执行时机
    src = src.replace("\nmain()\n", "\n")
    ns = {"__name__": "migrate_test"}
    exec(compile(src, SRC, "exec"), ns)
    return ns


def run_case(title, ws, mode="run", force=False, months=None):
    print("\n[%s]" % title)
    ns = load_module()
    ns["MODE"] = mode
    ns["FORCE"] = force
    ns["TARGET_MONTHS"] = months or []
    ns["Application"] = FakeApp(FakeSheets([ws]))
    ns["main"]()
    return ns, ws


def block_shape(ws, ns):
    starts = ns["_block_starts"](ws)
    out = []
    for i, r0 in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
        a, b, tail, cnt, how = ns["_item_range"](ws, r0, nxt)
        out.append((r0, a, b, tail, cnt, how))
    return starts, out


def main():
    # ---------- 1. 正常改造 ----------
    ws = build_sheet("2027-01")
    ns, ws = run_case("30 块 73 项 → 80 项", ws)
    starts, shapes = block_shape(ws, ns)
    chk(len(starts) == 30, "仍是 30 块（实际 %d）" % len(starts))
    chk(all(s[4] == 80 for s in shapes), "每块 80 项（实际分布 %s）"
        % sorted(set(s[4] for s in shapes)))
    chk(all(s[5] == "probe" for s in shapes), "全部靠「合计」行探测定位")
    a0, b0, tail0, cnt0, _ = shapes[0][1], shapes[0][2], shapes[0][3], shapes[0][4], shapes[0][5]
    tot = sum((ws.Range("D%d" % (a0 + k)).Value2 or 0) for k in range(cnt0))
    chk(tot == 100, "第 1 块标准分合计 = %s（应 100）" % tot)
    chk(ws.Range("A%d" % a0).Value2 == 1, "第 1 项序号 = %s" % ws.Range("A%d" % a0).Value2)
    chk(ws.Range("A%d" % (a0 + 79)).Value2 == 80, "第 80 项序号 = %s" % ws.Range("A%d" % (a0 + 79)).Value2)
    chk(ws.Range("C%d" % (a0 + 79)).Value2 == "住宿登记与消防管理",
        "第 80 项名称正确")
    chk(ws.Range("A%d" % (a0 + 80)).Value2 == "合计", "80 项后紧跟合计行")
    # 第 30 块也要对
    last = shapes[29]
    chk(last[4] == 80, "第 30 块也是 80 项")

    # ---------- 2. 幂等：再跑一次不应再插行 ----------
    print("\n[再跑一次（幂等）]")
    ns = load_module()
    ns["MODE"] = "run"
    ns["FORCE"] = False
    ns["Application"] = FakeApp(FakeSheets([ws]))
    ns["main"]()
    starts2, shapes2 = block_shape(ws, ns)
    chk(len(starts2) == 30 and all(s[4] == 80 for s in shapes2),
        "重复运行不改变块数/项数（块 %d，项数 %s）"
        % (len(starts2), sorted(set(s[4] for s in shapes2))))

    # ---------- 3. 已有得分 → 拒绝 ----------
    ws3 = build_sheet("2026-11", filled=True)
    ns3, ws3 = run_case("已有得分数据应拒绝", ws3, force=False)
    starts3, shapes3 = block_shape(ws3, ns3)
    chk(all(s[4] == 73 for s in shapes3), "拒绝改造，仍为 73 项（实际 %s）"
        % sorted(set(s[4] for s in shapes3)))

    # ---------- 4. FORCE 放行 ----------
    ns4, ws4 = run_case("FORCE=True 时放行", ws3, force=True)
    starts4, shapes4 = block_shape(ws4, ns4)
    chk(all(s[4] == 80 for s in shapes4), "已改为 80 项")

    # ---------- 5. dry 模式不动 ----------
    ws5 = build_sheet("2027-02")
    ns5, ws5 = run_case("dry 模式不改动", ws5, mode="dry")
    starts5, shapes5 = block_shape(ws5, ns5)
    chk(all(s[4] == 73 for s in shapes5), "dry 后仍是 73 项")

    # ---------- 6. 带分页空行的 79 行/块 ----------
    ws6 = build_sheet("2026-12", blank_tail=True)
    ns6, ws6 = run_case("79 行/块（块尾空行）也能改", ws6)
    starts6, shapes6 = block_shape(ws6, ns6)
    chk(len(starts6) == 30, "块数 30（实际 %d）" % len(starts6))
    chk(all(s[4] == 80 for s in shapes6), "全部 80 项（实际 %s）"
        % sorted(set(s[4] for s in shapes6)))

    print("\n" + "=" * 60)
    if FAIL:
        print("失败 %d 项：" % len(FAIL))
        for f in FAIL:
            print("  -", f)
        sys.exit(1)
    print("全部通过")


if __name__ == "__main__":
    main()
