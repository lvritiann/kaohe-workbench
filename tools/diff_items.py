# -*- coding: utf-8 -*-
"""比对「现行题库 items.json」与「新版 8.21 检查表」，输出逐条差异。

用法：
    python tools/diff_items.py _tmp/new_inspect_table.json

输出：
    1. 大类级差异（项数、分值、名称）
    2. 逐项差异：新增 / 删除 / 改名称 / 改分值 / 改内容 / 改判定标准 / 改大类归属
    3. 序号变化统计
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = os.path.join(ROOT, "docs", "data", "items.json")


def norm(s):
    return (s or "").strip().replace("\u3000", " ")


def load_new(path):
    d = json.load(io.open(path, encoding="utf-8"))
    out = []
    for ci, c in enumerate(d.get("categories", [])):
        for it in c.get("items", []):
            out.append({
                "no": it.get("no"),
                "cat": c.get("name"),
                "name": norm(it.get("name")),
                "content": norm(it.get("content")),
                "standard": norm(it.get("standard")),
                "score": it.get("score"),
            })
    return out, d.get("veto", []), d.get("stats", {})


def main():
    if len(sys.argv) < 2:
        print("用法: python tools/diff_items.py _tmp/new_inspect_table.json")
        return
    new_items, new_veto, stats = load_new(sys.argv[1])
    old = json.load(io.open(OLD, encoding="utf-8"))
    old_items = [{
        "no": i["no"], "cat": norm(i["cat"]), "name": norm(i["name"]),
        "content": norm(i.get("content")), "standard": norm(i.get("std")),
        "score": i.get("score"),
    } for i in old["items"]]

    print("=" * 78)
    print("现行: %d 项 / %d 分    新版: %d 项 / %s 分"
          % (len(old_items), sum(x["score"] or 0 for x in old_items),
             len(new_items), stats.get("total_score", sum(x["score"] or 0 for x in new_items))))
    print("=" * 78)

    # ---- 大类级 ----
    def cats(items):
        d = {}
        for x in items:
            d.setdefault(x["cat"], []).append(x)
        return d
    oc, nc = cats(old_items), cats(new_items)
    print("\n【大类对比】")
    keys = list(dict.fromkeys(list(nc.keys()) + list(oc.keys())))
    for k in keys:
        o, n = oc.get(k, []), nc.get(k, [])
        os_ = sum(x["score"] or 0 for x in o)
        ns_ = sum(x["score"] or 0 for x in n)
        flag = "" if (len(o) == len(n) and os_ == ns_) else "  ← 变化"
        print("  %-24s 旧 %2d项/%3d分  →  新 %2d项/%3d分%s" % (k, len(o), os_, len(n), ns_, flag))

    # ---- 逐项按名称匹配 ----
    print("\n【逐项差异】（按项目名称匹配，名称改过的会同时出现在删除与新增里）")
    on = {x["name"]: x for x in old_items}
    nn = {x["name"]: x for x in new_items}
    only_old = [x for x in old_items if x["name"] not in nn]
    only_new = [x for x in new_items if x["name"] not in on]

    if only_old:
        print("\n-- 删除（旧有新无）%d 项 --" % len(only_old))
        for x in only_old:
            print("   [旧%02d] %s / %s (%s分)" % (x["no"], x["cat"], x["name"], x["score"]))
    if only_new:
        print("\n-- 新增（新有旧无）%d 项 --" % len(only_new))
        for x in only_new:
            print("   [新%02d] %s / %s (%s分)" % (x["no"], x["cat"], x["name"], x["score"]))

    print("\n-- 同名项字段变化 --")
    n_chg = 0
    for name, o in on.items():
        n = nn.get(name)
        if not n:
            continue
        diffs = []
        if o["cat"] != n["cat"]:
            diffs.append("大类: %s → %s" % (o["cat"], n["cat"]))
        if o["score"] != n["score"]:
            diffs.append("分值: %s → %s" % (o["score"], n["score"]))
        if o["content"] != n["content"]:
            diffs.append("检查内容有改动")
        if o["standard"] != n["standard"]:
            diffs.append("判定标准有改动")
        if diffs:
            n_chg += 1
            print("   [旧%02d→新%02d] %s" % (o["no"], n["no"], name))
            for d in diffs:
                print("        %s" % d)
    if not n_chg:
        print("   （无）")

    # ---- 否决 ----
    print("\n【一票否决】")
    print("  旧 %d 项：%s" % (len(old["veto"]), "、".join(v["name"] for v in old["veto"])))
    newv = [norm(v.get("name")) for v in new_veto]
    print("  新 %d 项：%s" % (len(newv), "、".join(newv) if newv else "（新版未检出）"))

    # ---- 序号 ----
    print("\n【序号】")
    onos = [x["no"] for x in old_items]
    nnos = [x["no"] for x in new_items]
    print("  旧: 1..%d 连续=%s" % (max(onos), onos == list(range(1, len(onos) + 1))))
    print("  新: 1..%s 连续=%s" % (max(nnos) if nnos else '-', nnos == list(range(1, len(nnos) + 1))))
    if len(onos) != len(nnos):
        print("  ★ 项数变化 %d → %d：记录表 78 行/块 的模板必须同步改造" % (len(onos), len(nnos)))


if __name__ == "__main__":
    main()
