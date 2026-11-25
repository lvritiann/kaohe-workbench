# -*- coding: utf-8 -*-
"""考核记录·月度同步（金山文档「PY 脚本编辑器」，跨工作簿）

适用工作簿：`考核记录_<年>.xlsx`（一个工作簿预建 12 个月，每月一张 sheet，每月 30 个物理站块）。
作用：每月定时运行，按「当天所属会计月」把「检查明细」的扣分落到对应月份 sheet 的 30 个站块。

块结构（一块 = 标题 1 + 信息 1 + 列头 1 + N 项 + 合计 1 + 尾行 1，N = 73 或 80）：
  r0      标题（含「二级运营检查记录」）
  r0+1    信息行（A:B 站名 / C:D 会计月 / E:F 检查人 / G:H 检查日期 / I 生成时间）
  r0+2    列头
  r0+3…r0+2+N   明细项（A序号 B大类 C项目 D标准分 E得分 F结果 G说明 H照片文件名 I照片附件ID）
  r0+3+N  合计
  r0+4+N  尾部（A:C 折算 / D:F 运营段 / G:I 否决项）

★ 块步长不写死：两种版式都在用——
   年度表（考核记录_2026.xlsx / 考核记录_2027.xlsx）= 79 行（块尾多 1 行分页空行）
   新版（考核记录_2027_新版.xlsx）= 78 行（无空行）
  写死任何一个，另一种就会从第 2 站起逐站错位（第 30 站错 29 行，整块落到别人身上）。
  故运行时按 A 列标题行探测块起点。★ 探测到的块数不等于 30 时**直接拒绝写入**——
  宁可这次不落表，也不能把 A 站的扣分写进 B 站。

★ 未检查 ≠ 满分，但「检查了、零扣分」= 满分。
  两者在「检查明细」里的差别是：后者有该站该月的行（哪怕序号为空），前者一行都没有。
  故判据是 `(站名, 会计月) 是否在明细里出现过`，不是「有没有扣分项」。

会计月：上月 26 日—本月 25 日；当天 ≥26 日算下月会计月。
历史：12 张 sheet 常驻同一工作簿，自动保留，无需另存。
"""
import datetime

# ★ 金山 PY 沙箱进程是 UTC：实测 15:36 运行，脚本里 now() 记成 07:36，差 8 小时。
#   必须显式换到东八区，否则有两个后果：
#     ① 「生成时间」永远显示清晨，看着像半夜自动跑的，对不上实际核对时间；
#     ② 北京时间凌晨 0-8 点运行时 UTC 还在前一天，_acct_month() 的 26 日分界
#        会算错整整一个月（26 日凌晨跑 → 落进上月 sheet）。
#   用 utcnow 派生而不是 now()+8h：不依赖沙箱时区设置本身准不准。
def _now():
    try:
        return (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                + datetime.timedelta(hours=8))
    except Exception:
        return datetime.datetime.utcnow() + datetime.timedelta(hours=8)


SRC_FILE_ID = "85jEfN5x3rM95XxYSTpi1xHALnB45UGde"   # 考核工作台数据源 file_id
SRC_SHEET = "检查明细"
MONTH = ""              # ""=按当天会计月；也可写 "2027-01" 固定月
INSPECT_BASE = 28.0     # V6：二级运营检查段基准分（V5 为 20）

BLOCK_H = 79            # 兜底步长（年度表版式）；正常以标题行探测结果为准
TITLE_KEY = "二级运营检查记录"
PROBE_ROWS = 2500       # 12 月 × 30 站 × 79 行 ≈ 2370，留余量
OFF_INFO = 1
OFF_ITEM_START = 3      # 列头在 +2，明细项从 +3 开始（块内固定）
TOTAL_WORDS = ("合计", "小计")

# ★ 2026-11-25：项数不再写死。
#   旧题库 73 项（块高 78±1），新《二级运营检查表8.21》80 项（块高 85±1）。
#   两个年度工作簿在过渡期会并存两种块，写死任一种都会把另一年的分数写错行。
#   故改为：逐块按 A 列「合计」行探测明细区间与尾行位置。

ACCEPT_TYPES = ("", "运营检查", "二级运营检查")   # 明细「表类型」白名单；神访等不得混入
OK_WORDS = ("符合", "合格", "ok", "OK")

STATIONS = [
    "华山南", "华山北", "南沙南", "南沙北", "旬阳南", "旬阳北", "照金南", "照金北",
    "白河南", "白河北", "富平东", "富平西", "汉中东", "汉中西", "秦岭东", "秦岭西",
    "宁陕东", "宁陕西", "韩城东", "韩城西", "天汉水城东", "天汉水城西", "洋县东", "洋县西",
    "玉华宫东", "玉华宫西", "富县东", "富县西", "略阳东", "略阳西",
]


def _num(v, d=0.0):
    try:
        return float(v)
    except Exception:
        return d


def _norm_month(v):
    """「月份」列归一成 'YYYY-MM'。
    明细经粘贴/导入后可能是 '2026-11'、日期时间对象、'2026/11'、或 202611 数字；
    不归一会导致键永远匹配不上，30 站全静默跳过（看着像跑成功了）。"""
    if v is None:
        return ""
    if hasattr(v, "year") and hasattr(v, "month"):
        return "%04d-%02d" % (int(v.year), int(v.month))
    s = str(v).strip()
    if not s:
        return ""
    if len(s) >= 7 and s[4] in "-/." and s[:4].isdigit() and s[5:7].isdigit():
        return "%s-%s" % (s[:4], s[5:7])
    digits = "".join(ch for ch in s if ch.isdigit())
    if len(digits) == 6:
        return "%s-%s" % (digits[:4], digits[4:6])
    return s


def _cell(r, i):
    return r[i] if len(r) > i else None


def _read_detail():
    g = Workbooks.Open(SRC_FILE_ID, "et")
    try:
        sh = g.Application.Sheets(SRC_SHEET)
        vals = sh.Range("A1:S3000").Value2 or ()
    finally:
        try:
            g.Application.Workbooks.Close()
        except Exception:
            pass
    return list(vals)


def _collect(rows):
    """→ rec[(站,月)] = {序号: (得分, 结果, 说明, 照片文件名, 照片附件ID)}
       meta[(站,月)] = (检查人, 检查日期, 否决串)
       months = 明细里出现过的会计月集合
       dropped = 因表类型不在白名单被丢弃的 (月, 站, 表类型)

    ★ meta 对**每一行**都登记（含序号为空/非数字的行），所以「该站该月检查过但零扣分」
      在 meta 里一定留下痕迹 —— main() 靠这个区分「未检查」与「检查了没问题」。"""
    rec, meta, months, dropped = {}, {}, set(), []
    for r in rows[1:]:
        if not r or len(r) < 2:
            continue
        m = _norm_month(_cell(r, 0))
        st = str(_cell(r, 1) or "").strip()
        if not m or not st:
            continue
        typ = str(_cell(r, 2) or "").strip()
        if typ not in ACCEPT_TYPES:
            dropped.append((m, st, typ))
            continue
        months.add(m)
        key = (st, m)
        who = str(_cell(r, 10) or "").strip()
        when = str(_cell(r, 11) or "").strip()
        veto = str(_cell(r, 16) or "").strip()
        w0, d0, v0 = meta.get(key, ("", "", ""))
        # ★ 必须去重：read_check_zip 把「一票否决项」文本写进了该站**每一行**明细，
        #   而这里每遇到一行就拼一次，N 行扣分项就会把同一条否决拼成 N 遍
        #   （实测「散装汽油销售管控；散装汽油销售管控；散装汽油销售管控」）。
        #   按分号拆开保序去重，旧包已粘进明细的也能自我纠正。
        if veto:
            parts = [x.strip() for x in v0.split("；") if x.strip()]
            for x in veto.split("；"):
                x = x.strip()
                if x and x not in parts:
                    parts.append(x)
            v0 = "；".join(parts)
        meta[key] = (who or w0, when or d0, v0)
        no = _cell(r, 3)
        if no in (None, ""):
            continue                    # 占位行（满分站）：只登记 meta，不参与计分
        try:
            no = int(no)
        except Exception:
            continue                    # 'v3' 等否决项序号：只贡献否决文本，不参与计分
        raw = _cell(r, 7)
        score = _num(raw, None) if raw not in (None, "") else None
        res = str(_cell(r, 8) or "").strip() or "扣分"
        note = str(_cell(r, 9) or "").strip()
        photo = str(_cell(r, 12) or "").strip()
        pid = str(_cell(r, 13) or "").strip()
        rec.setdefault(key, {})[no] = (score, res, note, photo, pid)
    return rec, meta, months, dropped


def _block_starts(ws):
    """按 A 列「二级运营检查记录」标题行探测块起点（1-based）。探测不到返回 []。"""
    vals = ws.Range("A1:A%d" % PROBE_ROWS).Value2 or ()
    out = []
    for i, row in enumerate(vals):
        v = row[0] if isinstance(row, (list, tuple)) else row
        if isinstance(v, str) and TITLE_KEY in v:
            out.append(i + 1)
    return out


def _block_layout(ws, r0, next_r0):
    """探测一个站块的三处关键行号，兼容 73 项旧块与 80 项新块。

    返回 (item_start, item_end, tail_row, item_count, how)
      item_start = r0 + 3                         固定（标题/信息/列头各 1 行）
      item_end   = 合计行 - 1
      tail_row   = 合计行 + 1
      how        = 'probe'（按「合计」字样定位）/ 'step'（按块步长推算）

    为什么必须探测：2026 年度表的历史月份是 73 项、块高 78/79；
    2027 起按 80 项、块高 85/86。同一脚本要能同时写这两种块。
    """
    limit = (next_r0 - 1) if next_r0 else (r0 + 100)
    if limit <= r0:
        limit = r0 + 100
    vals = ws.Range("A%d:A%d" % (r0, limit)).Value2 or ()
    for i, row in enumerate(vals):
        v = row[0] if isinstance(row, (list, tuple)) else row
        if isinstance(v, str) and v.strip() in TOTAL_WORDS:
            tr = r0 + i
            a = r0 + OFF_ITEM_START
            if tr - 1 < a:                     # 异常块：合计行跑到了明细之前
                break
            return a, tr - 1, tr + 1, tr - a, 'probe'

    # 兜底一：合计行没有文字，就按「块内最后一个整数序号行」定位明细末尾。
    # 不能用「末行是否为空」猜有没有分页空行 —— 新建模板时尾行本来就是空的，
    # 尾行的文字是脚本自己写进去的，靠它判断会少一行。
    a = r0 + OFF_ITEM_START
    last_no_row = None
    for i, row in enumerate(vals):
        v = row[0] if isinstance(row, (list, tuple)) else row
        try:
            n = int(v)
        except Exception:
            continue
        if 1 <= n <= 200:
            last_no_row = r0 + i
    if last_no_row and last_no_row >= a:
        return a, last_no_row, last_no_row + 2, last_no_row - a + 1, 'seq'

    # 兜底二：整块没有任何序号，按块步长推
    if next_r0:
        last = next_r0 - 1
        try:
            tailval = ws.Range("A%d" % last).Value2
            if isinstance(tailval, (list, tuple)):
                tailval = tailval[0] if tailval else None
            if tailval is None or str(tailval).strip() == "":
                last -= 1
        except Exception:
            pass
        return a, last - 1, last, last - a, 'step'

    return a, r0 + 77, r0 + 78, 75, 'fallback'


def _acct_month():
    t = _now().date()          # ★ 必须用东八区，不能用 date.today()（UTC 会在凌晨错一天）
    if t.day >= 26:
        y = t.year + (1 if t.month == 12 else 0)
        m = 1 if t.month == 12 else t.month + 1
    else:
        y, m = t.year, t.month
    return "%d-%02d" % (y, m)


def _fill_block(ws, r0, dct, a=None, b=None):
    """写一块的明细得分/结果/说明/照片列。a/b 由 _block_layout 探测传入，
    不传则退回旧行为（从 r0+3 起 73 行）。
    → (折算分, 运营段得分, 消费掉的序号集合, 结果与得分矛盾的项数)

    计分与 docs/assets/engine.js 的 inspectResult() 对齐：
      NA 项  → 标准分不进分母、不记得分（effective = 100 − NA标准分）
      符合   → 得标准分（得分栏若给了更小的值，以结果列为准并计入 conflict）
      扣分   → 该项全扣；若手工填了 0<得分<标准分，按部分得分采信
      未出现 → 视为符合（该项不在明细里 = 没被挑出毛病）"""
    if a is None:
        a = r0 + OFF_ITEM_START
    if b is None:
        b = a + 72                      # 旧行为兜底：73 项
    block = ws.Range("A%d:D%d" % (a, b)).Value2 or ()
    out, got, na, total = [], 0.0, 0.0, 0.0
    used, conflict = set(), 0
    for row in block:
        no, std = row[0], _num(row[3])
        try:
            no = int(no)
        except Exception:
            no = None
        total += std
        if no is not None and no in dct:
            used.add(no)
            sc, res, note, photo, pid = dct[no]
            rn = str(res).strip()
            if rn.upper() == "NA":
                na += std
                out.append(["NA", "NA", note, photo, pid])
                continue
            if rn in OK_WORDS:
                if sc is not None and sc < std:
                    conflict += 1           # 结果=符合却给了更低的得分
                score = std
            elif sc is not None and 0 < sc < std:
                # 手工填的部分得分：采信，但与打分页口径（只有 ok/na/no 三态）会不一致，
                # 计入 conflict 让运维看得到，否则两份表数字不同却查不出来
                score = sc
                conflict += 1
            else:
                if sc is not None and sc >= std:
                    conflict += 1           # 结果=扣分但得分≥标准分，按扣分记
                score = 0.0
            got += score
            if score >= std:
                out.append([std, "符合", "", photo, pid])
            else:
                out.append([score, rn or "扣分", note, photo, pid])
        else:
            got += std
            out.append([std, "符合", "", "", ""])
    ws.Range("E%d:I%d" % (a, b)).Value2 = out
    eff = total - na
    conv = round(got / eff * 100.0, 2) if eff > 0 else 0.0
    op = round(conv / 100.0 * INSPECT_BASE, 2)
    if op > INSPECT_BASE:                        # 与 config.js 的 cap 一致
        op = INSPECT_BASE
    if abs(total - 100.0) > 0.01:
        print("[WARN] 第 %d-%d 行站块的标准分合计 = %.2f（应为 100），"
              "折算分按块内合计算，请核对模板是否被改动。" % (a, b, total))
    return conv, op, used, conflict


def _no_month_message(dropped):
    """明细里没有任何可用会计月时的诊断语。
    ★ 有行但不进白名单 → 是「表类型写错了」，不是「没人填」。两者处置完全不同，
      必须分开报，否则运维会去查错方向。"""
    if dropped:
        return ("[ERROR] 检查明细有 %d 行，但「表类型」都不在白名单 %s 内"
                "（实际出现：%s），本表不动。\n"
                "        表类型应填「运营检查」或留空。"
                % (len(dropped), ACCEPT_TYPES,
                   "、".join(sorted(set(t for _, _, t in dropped)))))
    return "检查明细暂无数据，跳过"


def main():
    rows = _read_detail()
    rec, meta, months, dropped = _collect(rows)
    if not months:
        print(_no_month_message(dropped))
        return
    month = MONTH or _acct_month()
    try:
        ws = Application.Sheets(month)
    except Exception:
        print("当前工作簿无「%s」sheet（12 个月已预建，请确认会计月）" % month)
        return
    if month not in months:
        print("[ERROR] 检查明细里没有会计月「%s」的行，本表不动。" % month)
        print("        明细现有会计月：%s" % "、".join(sorted(months)))
        print("        常见原因：明细「月份」列不是 YYYY-MM（已自动归一日期/202611 等形态），"
              "或现场检查跨了会计月分界（26 日）。")
        return
    now = _now().strftime("%Y-%m-%d %H:%M")

    # 块起点：按标题行探测。★ 数目对不上就拒绝写入，绝不兜底硬写
    starts = _block_starts(ws)
    if len(starts) != len(STATIONS):
        print("[ERROR] 「%s」块标题探测到 %d 块，期望 %d 块，本表不动。"
              % (month, len(starts), len(STATIONS)))
        print("        块标题须为 A 列含「%s」的行。若确实改过版式，请先修模板再跑。" % TITLE_KEY)
        return
    step = starts[1] - starts[0] if len(starts) > 1 else BLOCK_H
    print("块起点探测：%d 块 · 步长 %d" % (len(starts), step))

    layouts = []
    for i, st in enumerate(STATIONS):
        r0 = starts[i]
        next_r0 = starts[i + 1] if i + 1 < len(starts) else (r0 + step)
        layouts.append((r0, next_r0))

    filled, clean, skipped, conflicts = 0, 0, [], 0
    unconsumed = {}
    for i, st in enumerate(STATIONS):
        r0, next_r0 = layouts[i]
        key = (st, month)
        dct = rec.get(key, {}) or {}
        who, when, veto = meta.get(key, ("", "", ""))
        # ★ 判据是「明细里有没有这个站这个月」，不是「有没有扣分项」。
        #   检查了、零扣分 → 该写 100 / 28；一行都没有 → 才是未检查，整块留空。
        if key not in meta:
            skipped.append(st)
            continue
        a, b, tail, icount, how = _block_layout(ws, r0, next_r0)
        if how != 'probe':
            print("  [WARN] %s 块未找到「合计」行，按块步长推算（%d 项）" % (st, icount))
        conv, op, used, conflict = _fill_block(ws, r0, dct, a, b)
        conflicts += conflict
        if dct:
            filled += 1
        else:
            clean += 1
        if dct and set(dct.keys()) - used:
            unconsumed[st] = sorted(set(dct.keys()) - used)
        ws.Range("E%d" % (r0 + OFF_INFO)).Value2 = "检查人：%s" % who
        ws.Range("G%d" % (r0 + OFF_INFO)).Value2 = "检查日期：%s" % when
        ws.Range("I%d" % (r0 + OFF_INFO)).Value2 = "生成 %s" % now
        ws.Range("A%d" % tail).Value2 = "折算得分(100)：%s" % conv
        ws.Range("D%d" % tail).Value2 = "运营段得分(%d)：%s" % (INSPECT_BASE, op)
        ws.Range("G%d" % tail).Value2 = "一票否决项：%s" % (veto or "无")

    print("已同步 %s · 有扣分 %d 站 / 零扣分满分 %d 站 / 未检查留空 %d 站 · %s"
          % (month, filled, clean, len(skipped), now))
    if skipped:
        print("  未检查（留空，不给分）：%s" % "、".join(skipped))

    # ---- 收尾校验：宁可吵，不要静默丢分 ----
    if unconsumed:
        print("[WARN] 下列扣分项的序号在记录表里找不到对应行，扣分已丢失，请核对序号：")
        for st, nos in unconsumed.items():
            print("       %s：序号 %s" % (st, nos))
    if conflicts:
        print("[WARN] 有 %d 处「结果」与「得分」不一致（含手工填的部分得分），已按结果列计分，"
              "请人工复核；这些项的记录分与打分页口径可能不同。" % conflicts)
    stray = [k for k in rec if k[1] == month and k[0] not in STATIONS]
    if stray:
        print("[WARN] 明细里有 %d 个站名不在 30 物理站清单内，这些行未被消费：%s"
              % (len(stray), "、".join(sorted(set(k[0] for k in stray)))))
        print("       现场按服务区（如「华山」）录的应改成物理站（华山南 / 华山北）。")
    if dropped:
        print("[WARN] 有 %d 行「表类型」不是运营检查，已忽略：%s"
              % (len(dropped), "、".join(sorted(set(t for _, _, t in dropped)))))


if __name__ == "__main__":
    main()
