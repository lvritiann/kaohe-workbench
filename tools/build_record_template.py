# -*- coding: utf-8 -*-
"""生成「考核记录」全年工作簿（一个工作簿 = 12 个月，每月一张 sheet，每月 30 个物理站块）

版式（A4 横向、每块一页、打印 30 页/sheet）：
  r0       标题（合并 A:I）
  r0+1     信息行：A:B=站名  C:D=会计月  E:F=检查人  G:H=检查日期  I=生成时间（全部在 9 列内，不出格）
  r0+2     列头（9 列）
  r0+3..   73 项（行高 6.5、字号 6 → 一块 78 行可压进 A4 横向一页）
  r0+76    合计
  r0+77    尾部：A:C=折算  D:F=运营段  G:I=否决项
每块之间强制分页 → 一张 sheet 正好 30 页。历史 12 个月同簿保留。
"""
import datetime as dt
import json
import os
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.page import PageMargins
from openpyxl.worksheet.pagebreak import Break

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITEMS = os.path.join(ROOT, "docs", "data", "items.json")
CFG = os.path.join(ROOT, "tools", "config.json")
OUT_DIR = os.path.join(ROOT, "inbox", "检查表")

HEAD = ["序号", "大类", "检查项目", "标准分", "得分", "结果", "说明", "照片文件名", "照片附件ID"]
WIDTHS = [5, 17, 36, 6, 6, 7, 40, 12, 14]   # 9 列，合计 143 字符 ≈ 277mm，铺满 A4 横向（可用 284mm）
BLOCK_ROWS = 78

FS_TITLE, FS_INFO, FS_HDR, FS_ITEM, FS_TAIL = 11, 7.5, 7.5, 6, 7
H_TITLE, H_INFO, H_HDR, H_ITEM, H_SUM, H_TAIL = 15, 12, 11, 6.5, 8, 9

thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HDR_FILL = PatternFill("solid", fgColor="1F4E5F")
TITLE_FILL = PatternFill("solid", fgColor="E7F0F3")
SUM_FILL = PatternFill("solid", fgColor="F2F7F9")
INFO_FILL = PatternFill("solid", fgColor="FBFCFD")


def build_block(ws, r0, station, month, items, stamp):
    # 标题
    ws.merge_cells("A%d:I%d" % (r0, r0))
    c = ws.cell(row=r0, column=1, value="%s  ·  二级运营检查记录（会计月 %s）" % (station, month))
    c.font = Font(size=FS_TITLE, bold=True, color="1F4E5F")
    c.alignment = Alignment(horizontal="center", vertical="center")
    c.fill = TITLE_FILL
    ws.row_dimensions[r0].height = H_TITLE

    # 信息行（全部在 A:I 内，用合并段，杜绝第 10 列出格）
    pairs = [("站名", station, 1, 2), ("会计月", month, 3, 4),
             ("检查人", "", 5, 6), ("检查日期", "", 7, 8)]
    for label, val, c1, c2 in pairs:
        ws.merge_cells(start_row=r0 + 1, start_column=c1, end_row=r0 + 1, end_column=c2)
        cell = ws.cell(row=r0 + 1, column=c1, value="%s：%s" % (label, val))
        cell.font = Font(size=FS_INFO, color="333333")
        cell.alignment = Alignment(horizontal="left", vertical="center")
        cell.fill = INFO_FILL
    ic = ws.cell(row=r0 + 1, column=9, value="生成 %s" % stamp)
    ic.font = Font(size=FS_INFO, color="666666")
    ic.alignment = Alignment(horizontal="left", vertical="center")
    ic.fill = INFO_FILL
    ws.row_dimensions[r0 + 1].height = H_INFO

    # 列头
    for j, h in enumerate(HEAD, 1):
        cell = ws.cell(row=r0 + 2, column=j, value=h)
        cell.font = Font(bold=True, color="FFFFFF", size=FS_HDR)
        cell.fill = HDR_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[r0 + 2].height = H_HDR

    # 73 项（紧凑行高，一页装得下）
    r = r0 + 3
    prev_cat = None
    for it in items:
        vals = [it.get("no"), it.get("cat", ""), it.get("name", ""), it.get("score", ""), "", "", "", "", ""]
        new_cat = it.get("cat", "") != prev_cat
        prev_cat = it.get("cat", "")
        for j, v in enumerate(vals, 1):
            cell = ws.cell(row=r, column=j, value=v)
            cell.font = Font(size=FS_ITEM, bold=(j == 2 and new_cat))
            cell.border = Border(left=thin, right=thin, bottom=thin,
                                 top=(Side(style="medium", color="8EA9B4") if new_cat else thin))
            if j in (3, 7):
                cell.alignment = Alignment(horizontal="left", vertical="center",
                                           wrap_text=False, shrink_to_fit=True)
            else:
                cell.alignment = Alignment(horizontal="center" if j in (1, 4, 5, 6) else "left",
                                           vertical="center", shrink_to_fit=True)
        ws.row_dimensions[r].height = H_ITEM
        r += 1
    last_item = r - 1

    # 合计
    ws.cell(row=r, column=1, value="合计").font = Font(bold=True, size=FS_TAIL)
    ws.cell(row=r, column=3, value="73 项标准分合计").font = Font(bold=True, size=FS_TAIL)
    ws.cell(row=r, column=4, value="=SUM(D%d:D%d)" % (r0 + 3, last_item)).font = Font(bold=True, size=FS_TAIL)
    for j in range(1, 10):
        ws.cell(row=r, column=j).border = BORDER
        ws.cell(row=r, column=j).fill = SUM_FILL
    ws.row_dimensions[r].height = H_SUM
    r += 1

    # 尾部：3 个合并段（标签+值同格，脚本整串回填）
    tail = [("折算得分(100)：", 1, 3), ("运营段得分(28)：", 4, 6), ("一票否决项：", 7, 9)]
    for txt, c1, c2 in tail:
        ws.merge_cells(start_row=r, start_column=c1, end_row=r, end_column=c2)
        cell = ws.cell(row=r, column=c1, value=txt)
        cell.font = Font(size=FS_TAIL, bold=True)
        cell.alignment = Alignment(horizontal="left", vertical="center")
        cell.border = BORDER
    ws.row_dimensions[r].height = H_TAIL


def build_month_sheet(ws, month, items, stations, stamp):
    r = 1
    for st in stations:
        build_block(ws, r, st, month, items, stamp)
        ws.row_breaks.append(Break(id=r + BLOCK_ROWS - 1))   # 每块最后一行分页，页面无空行
        r += BLOCK_ROWS

    for j, w in enumerate(WIDTHS, 1):
        ws.column_dimensions[get_column_letter(j)].width = w

    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.scale = 100                     # 不缩放，靠列宽/行高控制
    ws.page_margins = PageMargins(left=0.25, right=0.25, top=0.25, bottom=0.25, header=0.1, footer=0.1)
    ws.print_options.horizontalCentered = True
    ws.oddFooter.center.text = "打印时间：&D &T"
    ws.oddFooter.right.text = "第 &P 页 / 共 &N 页"


def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else dt.date.today().year
    with open(ITEMS, encoding="utf-8") as f:
        items = sorted(json.load(f)["items"], key=lambda x: x["no"])
    with open(CFG, encoding="utf-8") as f:
        stations = json.load(f).get("physical_stations") or []
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M")

    wb = Workbook()
    wb.remove(wb.active)
    for m in range(1, 13):
        month = "%d-%02d" % (year, m)
        ws = wb.create_sheet(title=month)
        build_month_sheet(ws, month, items, stations, stamp)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "考核记录_%d.xlsx" % year)
    tmp = os.path.join(OUT_DIR, "考核记录_%d.tmp.xlsx" % year)
    wb.save(tmp)                       # 先写临时文件，避免目标被 WPS 占用时直接失败
    try:
        os.replace(tmp, out)           # 原子替换；目标被占用会抛 OSError
        print("已替换正式文件（旧文件已释放）")
    except OSError:
        out = os.path.join(OUT_DIR, "考核记录_%d_新版.xlsx" % year)
        if os.path.exists(out):
            try:
                os.replace(tmp, out)
            except OSError:
                out = os.path.join(OUT_DIR, "考核记录_%d_新版2.xlsx" % year)
                os.replace(tmp, out)
        else:
            os.replace(tmp, out)
        print("！正式文件正被 WPS/Excel 占用，本次输出到：%s" % os.path.basename(out))
    blk_mm = (H_TITLE + H_INFO + H_HDR + len(items) * H_ITEM + H_SUM + H_TAIL) * 0.3528
    print("已生成 %s（%.1f MB）" % (out, os.path.getsize(out) / 1048576.0))
    print("  月份 sheet：12 张（%d-01 … %d-12）" % (year, year))
    print("  每块高度 ≈ %.1f mm（A4 横向可用 ≈ 192mm）；每块一页，一张 sheet 打印 30 页" % blk_mm)


if __name__ == "__main__":
    main()
