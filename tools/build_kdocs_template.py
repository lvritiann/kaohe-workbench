# -*- coding: utf-8 -*-
"""生成「考核工作台数据源」扩列版 xlsx（本地预览 / 回滚备份 / 可选整表覆盖上传）

两张表：
  检查明细  原 12 列 + 7 列（照片、折算分、否决、来源、时间）
  月度汇总  30 列，一行一站一月；自带 2026-10 真实柴汽销量（来自中转簿站级明细）

本文件只在本机 inbox/ 生成，不推 GitHub。需要整表覆盖金山文档时，
用 mcp__kdocs__upload_replace_file 上传生成结果。
"""
import datetime as dt
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "inbox", "油源")
OIL_JSON = os.path.join(OUT_DIR, "oil_sales_all.json")

DETAIL_OLD = ["月份", "站名", "表类型", "序号", "大类", "检查项目",
              "标准分", "得分", "结果", "说明", "检查人", "提交时间"]
DETAIL_NEW = ["照片文件名", "照片附件ID", "折算得分(100)", "运营段得分(20)",
              "一票否决项", "数据来源", "更新时间"]

SUMMARY = [
    "会计月", "站名", "会计月起始", "会计月截止", "天数",
    "汽油销量(吨)", "柴油销量(吨)", "零售合计(吨)", "油品任务(吨)", "油品段得分",
    "非油销售额(不含烟)", "非油毛利额(含烟)", "非油段得分",
    "月均在岗人数", "分母(在岗−4)", "当量SGE", "人效", "人效段得分",
    "运营检查折算分", "运营段得分", "神访百分制", "神访段得分",
    "投诉扣分", "进步加分", "一票否决", "综合得分", "名次",
    "运营状态", "数据来源", "更新时间"
]

# 运营状态按「会计月」判定，不能套当前状态：
# 华山自 2026-11-01 起临时关停，但 2026-10 会计月（9/26–10/25）仍正常营业。
# 需要按其他会计月生成时，用 docs/data/station_status.json 的 from/to 逐站判定。
STATUS = {}
SRC_NOTE = "成品油经营数据中转簿·站级明细"


def style_header(ws, ncol):
    fill = PatternFill("solid", fgColor="1F4E5F")
    for c in range(1, ncol + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "C2"
    for c in range(1, ncol + 1):
        ws.column_dimensions[get_column_letter(c)].width = 16


def main():
    if not os.path.isfile(OIL_JSON):
        raise SystemExit("先运行 python tools/build_oil_sales.py")
    with open(OIL_JSON, encoding="utf-8") as f:
        oil = json.load(f)
    latest = oil["latest"]
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    y, m = (int(x) for x in latest.split("-"))
    start = dt.date(y - (1 if m == 1 else 0), 12 if m == 1 else m - 1, 26).isoformat()
    end = dt.date(y, m, 25).isoformat()

    wb = Workbook()
    ws1 = wb.active
    ws1.title = "检查明细"
    ws1.append(DETAIL_OLD + DETAIL_NEW)
    style_header(ws1, len(DETAIL_OLD) + len(DETAIL_NEW))

    ws2 = wb.create_sheet("月度汇总")
    ws2.append(SUMMARY)
    rowmap = {}
    for s in oil["stations"]:
        v = s["byMonth"].get(latest)
        if not v:
            continue
        row = {h: "" for h in SUMMARY}
        row.update({
            "会计月": latest, "站名": s["name"],
            "会计月起始": start, "会计月截止": end, "天数": v["days"],
            "汽油销量(吨)": v["gasTon"], "柴油销量(吨)": v["dieselTon"],
            "零售合计(吨)": v["retailTon"],
            "运营状态": STATUS.get(s["name"], "正常营业"),
            "数据来源": SRC_NOTE, "更新时间": now
        })
        rowmap[s["name"]] = [row[h] for h in SUMMARY]
    # 按工作台固定 15 站顺序输出
    for name in ["富平", "汉中", "秦岭", "华山", "白河", "宁陕", "韩城", "南沙",
                 "旬阳", "天汉水城", "洋县", "玉华宫", "富县", "照金", "略阳"]:
        if name in rowmap:
            ws2.append(rowmap[name])
    style_header(ws2, len(SUMMARY))
    ws2.freeze_panes = "C2"
    for c in range(1, len(SUMMARY) + 1):
        ws2.column_dimensions[get_column_letter(c)].width = 18
    for h in ["油品段得分", "非油段得分", "人效段得分", "运营段得分", "神访段得分"]:
        ci = SUMMARY.index(h) + 1
        for r in range(2, ws2.max_row + 1):
            ws2.cell(row=r, column=ci).number_format = "0.00"

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "考核工作台数据源_扩列_%s.xlsx" % dt.date.today().isoformat())
    wb.save(out)
    print("已生成 %s" % out)
    print("  检查明细：%d 列（原 12 + 新 %d）" % (len(DETAIL_OLD) + len(DETAIL_NEW), len(DETAIL_NEW)))
    print("  月度汇总：%d 列 × %d 行（%s 真实柴汽销量）" % (len(SUMMARY), ws2.max_row - 1, latest))
    print("  新增明细列：" + " / ".join(DETAIL_NEW))
    print("  汇总列：" + " / ".join(SUMMARY))


if __name__ == "__main__":
    main()
