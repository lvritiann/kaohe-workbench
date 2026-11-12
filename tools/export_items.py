# -*- coding: utf-8 -*-
"""从权威 Excel 评分表导出网页用数据源 data/items.json
口径唯一来源：附件2-二级运营检查评分表（V2·重排版·100分）.xlsx
"""
import json
import os
import openpyxl

SRC = r"D:/加油站综合考核系统/附件2-二级运营检查评分表（V2·重排版·100分）.xlsx"
OUT = r"D:/加油站综合考核系统/docs/data/items.json"

wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb["评分表"]

# ---- 一票否决项：第 5~10 行（第 3 行是分区标题，第 4 行是表头）----
veto = []
for r in range(5, 11):
    name = ws.cell(row=r, column=2).value
    if not name:
        continue
    veto.append({
        "no": int(ws.cell(row=r, column=1).value),
        "name": str(name).strip(),
        "content": (ws.cell(row=r, column=4).value or "").strip(),
        "method": (ws.cell(row=r, column=5).value or "").strip(),
    })

# ---- 运营检查项：第 13~85 行 ----
items = []
cats = []
cur_cat = None
for r in range(13, 86):
    seq = ws.cell(row=r, column=2).value
    if not seq:
        continue
    cat_cell = ws.cell(row=r, column=1).value
    if cat_cell:
        raw = str(cat_cell).replace("\n", " ").strip()
        title = raw.split("（")[0].strip()
        score = raw.split("（")[1].replace("分）", "").replace(")", "").strip() if "（" in raw else ""
        cur_cat = title
        cats.append({"title": title, "score": int(score) if score.isdigit() else None})
    items.append({
        "no": int(seq),
        "cat": cur_cat,
        "name": (ws.cell(row=r, column=3).value or "").strip(),
        "content": (ws.cell(row=r, column=4).value or "").strip(),
        "method": (ws.cell(row=r, column=5).value or "").strip(),
        "std": (ws.cell(row=r, column=6).value or "").strip(),
        "score": int(ws.cell(row=r, column=7).value),
    })

payload = {
    "version": "V2.1",
    "source": "附件2-二级运营检查评分表（V2·重排版·100分）.xlsx",
    "total": sum(i["score"] for i in items),
    "veto": veto,
    "categories": cats,
    "items": items,
}

# ---- 校验：任何一项不合格就拒绝导出，避免把错表发到网页 ----
errors = []
if payload["total"] != 100:
    errors.append("逐项分值合计 %s ≠ 100" % payload["total"])
if len(items) != 73:
    errors.append("判定项 %d 项 ≠ 73" % len(items))
if len(veto) != 6:
    errors.append("否决项 %d 项 ≠ 6" % len(veto))
cat_sum = sum(c["score"] or 0 for c in cats)
if cat_sum != 100:
    errors.append("11 大类标注分值合计 %s ≠ 100" % cat_sum)
no_seq = [i["no"] for i in items]
if no_seq != list(range(1, len(items) + 1)):
    errors.append("序号不连续")
for i in items:
    if i["score"] not in (1, 2):
        errors.append("第 %d 项分值异常：%s" % (i["no"], i["score"]))

if errors:
    raise SystemExit("导出中止：\n  - " + "\n  - ".join(errors))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

print("OK ->", OUT)
print("否决 %d 项 / 判定 %d 项 / 合计 %d 分 / 大类 %d 个" % (
    len(veto), len(items), payload["total"], len(cats)))
for c in cats:
    n = sum(1 for i in items if i["cat"] == c["title"])
    print("  %-22s %3s 分  %2d 项" % (c["title"], c["score"], n))
