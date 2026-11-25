# -*- coding: utf-8 -*-
"""把 _tmp/new_inspect_table.json（8.21 表结构化导出）转成 docs/data/items.json

口径决策（2026-11-25）：
  大类标注分合计 99、明细合计 100、表尾合计格 100。
  以**逐项明细**为准（100 分），大类标注分统一改为与明细一致。
  理由：分数是逐项加出来的，标注只是印刷数字；表尾与评分说明的折算公式都以 100 为基数。
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "_tmp", "new_inspect_table.json")
OUT = os.path.join(ROOT, "docs", "data", "items.json")


def main():
    d = json.load(io.open(SRC, encoding="utf-8"))

    cats, items, report = [], [], []
    for c in d["categories"]:
        its = c["items"]
        real = sum(i["score"] for i in its)
        label = c.get("label_score")
        cats.append({"title": c["name"], "score": real})
        if label is not None and label != real:
            report.append("  %-22s 标注 %2d → 明细 %2d（差 %+d）" % (c["name"], label, real, real - label))
        for i in its:
            items.append({
                "no": i["no"], "cat": c["name"], "name": i["name"],
                "content": i["content"], "method": i.get("method", ""),
                "std": i["standard"], "score": i["score"],
            })

    total = sum(i["score"] for i in items)
    nos = [i["no"] for i in items]
    assert nos == list(range(1, len(items) + 1)), "序号不连续：%s" % nos
    assert total == 100, "明细分合计 = %d，应为 100" % total
    assert len(cats) == 11, "大类数 = %d，应为 11" % len(cats)

    out = {
        "version": "8.21",
        "source": "二级运营检查表8.21.xlsx（二级运营检查评分表·修订版）",
        "total": 100,
        "veto": [{"no": v["no"], "name": v["name"], "content": v["content"],
                  "method": v.get("method", ""), "std": v["standard"]} for v in d["veto"]],
        "categories": cats,
        "items": items,
    }
    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n")

    print("已写出:", OUT)
    print("大类 %d / 检查项 %d / 合计 %d 分 / 否决 %d 项"
          % (len(cats), len(items), total, len(out["veto"])))
    print("\n大类标注分与明细不一致（已按明细修正）：")
    print("\n".join(report) if report else "  （无）")
    print("\n各大类：")
    for c in cats:
        n = sum(1 for i in items if i["cat"] == c["title"])
        print("  %-22s %2d 项 / %2d 分" % (c["title"], n, c["score"]))


if __name__ == "__main__":
    main()
