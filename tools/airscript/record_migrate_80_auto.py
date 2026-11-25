# -*- coding: utf-8 -*-
"""考核记录表 73 项 → 80 项改造 · 全自动零开关版（金山文档 PY 脚本编辑器）

★ 使用方法：把本文件全文贴进 PY 脚本编辑器，点一次「运行」，结束。
  没有任何开关要改、没有 dry 要跑两遍、不用选月份。

它会自己判断（全部自动）：
  · 当前工作簿有哪些月表 —— 只认 YYYY-MM 字样的表名，其余表（说明/汇总）不理
  · 哪些月表该改 —— 只改「2026-12 及以后」的月表；
                    2026-01 ~ 2026-11 是历史数据，一律不动
  · 哪些站块要插行 —— 73 项的块插 7 行变 80 项；已经是 80 项的直接跳过
  · 哪些表不能动 —— 该表已有得分数据（E 列有值）说明已经录过数，
                    改版式会毁掉已录的分，整张表拒绝改造
  · 哪些块是半成品 —— 插了行但内容没写完的（80 行却对不上题库、标准分合计≠100），
                    下次运行会自动补写内容，不会漏

三遍流程（中间不用人干预）：
  第 1 遍 预检（只读） 把每张表的块数、项数、得分状态全看一遍；
                      块数 ≠ 30 或项数异常的整张表不动，其它表照常进行
  第 2 遍 执行        从最后一个站块往上改，每块插 7 行 + 重写 80 项
  第 3 遍 自检        重新探测，逐块核对「80 项 / 首末项目名 / 标准分合计 100」

安全设计：
  · 可重复运行 —— 已改好的块跳过，不会重复插行（幂等）
  · 可断点续跑 —— 万一超过时间预算，会在**块边界**停下并提示再点一次运行，
                  下次从没改完的块接着改，不会半途留下错位的块
  · 失败即停 —— 某块插行失败或重写后自检不通过，本表立刻中止，不再往下改

★ 为什么必须从最后一个块往上改：
  在上方插行会把下面所有块整体下移，第 2 个站起就会错位，
  第 30 个站的分会落到别人身上（错 29 行）。从下往上改就没这个问题。

★ 为什么不能一次写整块二维数组：
  金山真表上 `Range('A2:S3000').Value2 = 二维数组` 只认第一行，不报错、不打日志。
  所以这里是逐行写（一行一次调用，尽量少调用），写完还要自检回来验证。
"""

import re
import time

# =====================================================================
# 固定参数（不用改，改了也不会更好）
# =====================================================================
START_MONTH = '2026-12'      # 换版生效的会计月；早于它的月表一律不动
TITLE_KEY = '二级运营检查记录'   # 站块标题里必含这几个字（用来找块起点）
OLD_COUNT = 73               # 旧题库项数
NEW_COUNT = 80               # 新题库项数（《二级运营检查表8.21》）
TOTAL_WORDS = ('合计', '小计')
PROBE_ROWS = 2600            # 12 月 × 30 块 × 86 行 ≈ 3096，探测到 2600 够用
OFF_ITEM_START = 3           # 块内固定：标题 +1 信息 +2 列头，明细从 +3 开始
TIME_BUDGET_SEC = 300        # 时间预算；到点会在块边界停下提示续跑

# =====================================================================
# 新题库：80 项（序号 / 大类 / 项目 / 标准分），与 docs/data/items.json 逐条一致
# =====================================================================
ITEMS = [
    (1, '一、安全管理体系', '安全组织与持证安全员', 2),
    (2, '一、安全管理体系', '安全生产责任制签订', 1),
    (3, '一、安全管理体系', '双重预防机制建设', 2),
    (4, '一、安全管理体系', '三级安全教育培训', 1),
    (5, '一、安全管理体系', '常态化安全培训', 1),
    (6, '一、安全管理体系', '承包商与外来人员管理', 1),
    (7, '一、安全管理体系', '灭火器全生命周期管理', 2),
    (8, '一、安全管理体系', '消防沙、消防毯与消防通道', 1),
    (9, '一、安全管理体系', '隐患闭环治理', 2),
    (10, '一、安全管理体系', '危险作业全流程管控', 2),
    (11, '一、安全管理体系', '劳保用品与职业健康管理', 1),
    (12, '二、油罐区', '罐区围堰环境', 2),
    (13, '二、油罐区', '安全警示标识', 1),
    (14, '二、油罐区', '防雷接地装置检查', 1),
    (15, '二、油罐区', '油罐人孔井管理', 2),
    (16, '二、油罐区', '量油口密闭管控', 2),
    (17, '二、油罐区', '呼吸阀、阻火器完好', 1),
    (18, '二、油罐区', '卸油口阀门管理', 2),
    (19, '二、油罐区', '静电接地报警器', 1),
    (20, '二、油罐区', '卸油胶管完好', 1),
    (21, '二、油罐区', '液位仪与防渗监测系统', 1),
    (22, '三、加油作业区', '加油机外观、渗漏、铅封', 2),
    (23, '三、加油作业区', '加油机计量检定', 2),
    (24, '三、加油作业区', '加油枪胶管与自封功能', 2),
    (25, '三、加油作业区', '静电接地+紧急切断阀', 2),
    (26, '三、加油作业区', '摩托车加油专项管理', 1),
    (27, '三、加油作业区', '加油岛、防撞柱完好', 1),
    (28, '三、加油作业区', '前庭地坪与站区交通', 1),
    (29, '三、加油作业区', '雨棚与前厅照明', 1),
    (30, '三、加油作业区', '车道标识标线清晰', 1),
    (31, '三、加油作业区', '一二次油气回收系统', 1),
    (32, '三、加油作业区', '三次油气回收系统', 1),
    (33, '三、加油作业区', '站容标牌规范', 1),
    (34, '四、环保管理', '隔油池/油水分离器运维', 1),
    (35, '四、环保管理', '环保设施运维记录', 2),
    (36, '四、环保管理', '环保台账归档', 2),
    (37, '五、油品数质量管控', '油品入库质量验收', 2),
    (38, '五、油品数质量管控', '进销存损耗管控', 2),
    (39, '五、油品数质量管控', '加油机铅封管理', 2),
    (40, '五、油品数质量管控', '油品数质量台账完整', 1),
    (41, '六、营业室与便利店', '营业室整体环境', 2),
    (42, '六、营业室与便利店', '收银台规范管理', 1),
    (43, '六、营业室与便利店', '食品经营资质', 1),
    (44, '六、营业室与便利店', '收银系统全功能正常', 1),
    (45, '六、营业室与便利店', '现金投币与账实相符', 1),
    (46, '六、营业室与便利店', '咖啡区管理', 1),
    (47, '六、营业室与便利店', '加油卡管理', 1),
    (48, '六、营业室与便利店', '收款码合规管控', 1),
    (49, '六、营业室与便利店', '商品陈列与价签准确', 1),
    (50, '六、营业室与便利店', '商品保质期管控', 1),
    (51, '六、营业室与便利店', '钥匙管理', 1),
    (52, '六、营业室与便利店', '烟酒贵重商品管理', 1),
    (53, '七、监控与应急管理', '监控设备覆盖与存储', 1),
    (54, '七、监控与应急管理', '监控巡检自查记录', 1),
    (55, '七、监控与应急管理', '应急照明与疏散指示', 1),
    (56, '七、监控与应急管理', '应急预案完整适配', 1),
    (57, '七、监控与应急管理', '应急物资齐全完好', 1),
    (58, '七、监控与应急管理', '应急演练全流程闭环', 1),
    (59, '八、服务规范与运营执行', '员工仪容仪表规范', 1),
    (60, '八、服务规范与运营执行', '引车与安全提醒到位', 1),
    (61, '八、服务规范与运营执行', '加油收银操作规范', 1),
    (62, '八、服务规范与运营执行', '营销与道别服务规范', 1),
    (63, '八、服务规范与运营执行', '交接班管理规范', 1),
    (64, '八、服务规范与运营执行', '例会与高峰人员配置', 1),
    (65, '八、服务规范与运营执行', '客诉闭环管理', 1),
    (66, '九、办公区与文档管理', '办公室内务整洁', 1),
    (67, '九、办公区与文档管理', '运营展板管理', 1),
    (68, '九、办公区与文档管理', '财务室防盗设施完好', 1),
    (69, '九、办公区与文档管理', '证照档案分类归档', 1),
    (70, '九、办公区与文档管理', '人事与培训档案完整', 1),
    (71, '九、办公区与文档管理', '网络与数据安全管理', 1),
    (72, '九、办公区与文档管理', '三级运营检查体系完整', 2),
    (73, '九、办公区与文档管理', '运营与神访台账闭环', 1),
    (74, '十、辅助设施区', '配电房环境与安全', 1),
    (75, '十、辅助设施区', '绝缘防护工具齐全有效', 1),
    (76, '十、辅助设施区', '库房分区与危化品存放', 1),
    (77, '十、辅助设施区', '公共洗手间与计量器具', 1),
    (78, '十一、员工生活区', '餐厅食品安全与卫生', 1),
    (79, '十一、员工生活区', '宿舍内务与用电安全', 1),
    (80, '十一、员工生活区', '住宿登记与消防管理', 1),
]

TOT = sum(x[3] for x in ITEMS)
METHOD = ['']                # 记一下实际生效的插行方法名，只用于日志


# =====================================================================
# 基础工具
# =====================================================================
def _say(*a):
    try:
        print(*a)
    except Exception:
        pass


def _clock():
    try:
        return time.monotonic()
    except Exception:
        return time.time()


def _val(rng):
    """取单个单元格的值（金山 Value2 可能返回 [[v]] / [v] / v）。"""
    v = rng.Value2
    if isinstance(v, (list, tuple)):
        if v and isinstance(v[0], (list, tuple)):
            return v[0][0] if v[0] else None
        return v[0] if v else None
    return v


def _col_a(ws, r1, r2):
    """读 A 列一段，返回一维列表。"""
    vals = ws.Range('A%d:A%d' % (r1, r2)).Value2 or ()
    out = []
    for row in vals:
        out.append(row[0] if isinstance(row, (list, tuple)) else row)
    return out


def _norm_month(name):
    """表名 → 'YYYY-MM'；不是月表返回 ''。"""
    m = re.search(r'(20\d{2})\D{0,3}(\d{1,2})', str(name))
    if not m:
        return ''
    y, mo = int(m.group(1)), int(m.group(2))
    if not (1 <= mo <= 12):
        return ''
    return '%04d-%02d' % (y, mo)


def _sheet_names():
    """取工作表名列表，几种对象模型轮着试。"""
    getters = [
        ('Application.Sheets', lambda: Application.Sheets),
        ('Application.ActiveWorkbook.Sheets', lambda: Application.ActiveWorkbook.Sheets),
        ('Application.ActiveWorkbook.Worksheets', lambda: Application.ActiveWorkbook.Worksheets),
    ]
    for _label, g in getters:
        try:
            S = g()
        except Exception:
            continue
        try:
            n = S.Count or S.length or 0
        except Exception:
            n = 0
        out = []
        for i in range(1, n + 1):
            try:
                nm = S.Item(i).Name
                if nm:
                    out.append(str(nm))
            except Exception:
                pass
        if out:
            return out
    return []


def _get_sheet(name):
    """按名字取工作表，几种调用方式轮着试。"""
    for fn in (lambda: Application.Sheets.Item(name),
               lambda: Application.Sheets(name),
               lambda: Application.ActiveWorkbook.Sheets.Item(name)):
        try:
            s = fn()
            if s is not None:
                return s
        except Exception:
            continue
    return None


# =====================================================================
# 块结构探测（与 record_sync.py 同口径）
# =====================================================================
def _block_starts(ws):
    """A 列里含「二级运营检查记录」的行号列表 = 各站块起点。"""
    out = []
    for i, v in enumerate(_col_a(ws, 1, PROBE_ROWS)):
        if isinstance(v, str) and TITLE_KEY in v:
            out.append(i + 1)
    return out


def _item_range(ws, r0, next_r0):
    """→ (item_start, item_end, tail_row, count, how)

    先找块内「合计/小计」行定明细上界；找不到就退而用块内最后一个整数序号行；
    再不行才用 73 项的固定偏移。how 只用于日志。
    """
    limit = (next_r0 - 1) if next_r0 else (r0 + 100)
    a = r0 + OFF_ITEM_START
    vals = _col_a(ws, r0, max(limit, r0 + 1))
    for i, v in enumerate(vals):
        if isinstance(v, str) and v.strip() in TOTAL_WORDS:
            tr = r0 + i
            if tr - 1 >= a:
                return a, tr - 1, tr + 1, tr - a, 'probe'
            break
    last = None
    for i, v in enumerate(vals):
        try:
            no = int(v)
        except Exception:
            continue
        if 1 <= no <= 200:
            last = r0 + i
    if last and last >= a:
        return a, last, last + 2, last - a + 1, 'seq'
    return a, r0 + 76, r0 + 78, OLD_COUNT, 'fallback'


def _insert_rows(ws, at, n):
    """在第 at 行之前插 n 行。金山 PY 各版本方法名不一，逐个试。→ (ok, 方法名)"""
    tries = [
        ('Rows(a:b).Insert', lambda: ws.Rows('%d:%d' % (at, at + n - 1)).Insert()),
        ('Range(A).EntireRow.Insert', lambda: ws.Range('A%d' % at).EntireRow.Insert()),
        ('Range(A).EntireRow.Insert(1)', lambda: ws.Range('A%d' % at).EntireRow.Insert(1)),
        ('Rows(a).Insert', lambda: ws.Rows('%d' % at).Insert()),
    ]
    for name, fn in tries:
        try:
            fn()
            return True, name
        except Exception:
            continue
    return False, ''


def _sheet_has_scores(ws, r0, item_end):
    """E 列（得分）有没有内容 —— 有就说明这张表已经录过数。"""
    try:
        vals = ws.Range('E%d:E%d' % (r0 + OFF_ITEM_START, item_end)).Value2 or ()
    except Exception:
        return False
    for row in vals:
        v = row[0] if isinstance(row, (list, tuple)) else row
        if v is not None and str(v).strip() != '':
            return True
    return False


def _d_sum(ws, a, b):
    """D 列标准分合计；读不到返回 -1。"""
    try:
        vals = ws.Range('D%d:D%d' % (a, b)).Value2 or ()
    except Exception:
        return -1.0
    s = 0.0
    for row in vals:
        v = row[0] if isinstance(row, (list, tuple)) else row
        try:
            s += float(v)
        except Exception:
            pass
    return s


def _block_ok(ws, a):
    """校验一个 80 项块的内容是否真的写对了（防「插了行没写内容」的半成品）。"""
    b = a + NEW_COUNT - 1
    try:
        v0 = str(_val(ws.Range('C%d' % a)) or '').strip()
        v1 = str(_val(ws.Range('C%d' % b)) or '').strip()
    except Exception:
        return False
    if v0 != ITEMS[0][2] or v1 != ITEMS[-1][2]:
        return False
    s = _d_sum(ws, a, b)
    if s < 0 or abs(s - TOT) > 0.01:
        return False
    return True


# =====================================================================
# 写内容
# =====================================================================
def _write_row4(ws, r, no, cat, name, std):
    """一行四列一次写。成功返回 True。"""
    try:
        ws.Range('A%d:D%d' % (r, r)).Value2 = [[no, cat, name, std]]
        return True
    except Exception:
        return False


def _write_row_cell(ws, r, no, cat, name, std):
    """逐格写（兜底，慢但不挑版本）。"""
    try:
        ws.Range('A%d' % r).Value2 = no
        ws.Range('B%d' % r).Value2 = cat
        ws.Range('C%d' % r).Value2 = name
        ws.Range('D%d' % r).Value2 = std
        return True
    except Exception:
        return False


def _write_block(ws, a, bulk):
    try:
        ws.Range('A%d:A%d' % (a, a + NEW_COUNT - 1)).NumberFormat = '@'
    except Exception:
        pass
    writer = _write_row4 if bulk else _write_row_cell
    for k, (no, cat, nm, std) in enumerate(ITEMS):
        if not writer(ws, a + k, no, cat, nm, std):
            return False
    try:
        ws.Range('D%d' % (a + NEW_COUNT)).Value2 = TOT
    except Exception:
        pass
    return True


def _rewrite_items(ws, a):
    """重写一个块的 80 项；先快写，自检不过再逐格重写一遍。"""
    if _write_block(ws, a, True) and _block_ok(ws, a):
        return True
    if _write_block(ws, a, False) and _block_ok(ws, a):
        return True
    return False


# =====================================================================
# 第 1 遍：预检
# =====================================================================
def _plan_sheet(ws, key):
    """只读探测一张表。→ dict(status=run/skip/reject, reason, starts, need, repair)"""
    p = {'status': 'skip', 'reason': '', 'starts': [], 'need': [], 'repair': []}

    starts = _block_starts(ws)
    p['starts'] = starts
    if len(starts) != 30:
        p['status'] = 'reject'
        p['reason'] = '站块探测到 %d 块（应为 30 块），这张表不动' % len(starts)
        return p

    counts = []
    for i, r0 in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
        _a, _b, _t, cnt, _h = _item_range(ws, r0, nxt)
        counts.append(cnt)

    odd = sorted(set(c for c in counts if c not in (OLD_COUNT, NEW_COUNT)))
    if odd:
        p['status'] = 'reject'
        p['reason'] = '存在异常块（项数 %s），这张表不动' % odd
        return p

    need = [c == OLD_COUNT for c in counts]
    repair = []
    for i, r0 in enumerate(starts):
        if need[i]:
            continue
        if not _block_ok(ws, r0 + OFF_ITEM_START):
            repair.append(i)          # 80 行但内容不对 → 半成品，只补内容

    moving = [i for i in range(len(starts)) if need[i] or i in repair]
    if not moving:
        p['status'] = 'skip'
        p['reason'] = '30 块已是 80 项且内容正确，无需改造'
        return p

    for i in moving:
        r0 = starts[i]
        nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
        _a, b, _t, _cnt, _h = _item_range(ws, r0, nxt)
        if _sheet_has_scores(ws, r0, b):
            p['status'] = 'reject'
            p['reason'] = ('第 %d 块（行 %d）已有得分数据，这张表已录过数，'
                           '改版式会毁掉已录的分' % (i + 1, r0))
            return p

    p['status'] = 'run'
    p['need'] = need
    p['repair'] = repair
    return p


# =====================================================================
# 第 2 遍：执行
# =====================================================================
def _run_sheet(ws, plan, t0):
    starts = plan['starts']
    need = plan['need']
    repair = plan['repair']
    done = 0
    total_blocks = len(starts)

    # ★ 从最后一个块往上改
    for i in range(total_blocks - 1, -1, -1):
        if not (need[i] or i in repair):
            continue
        if _clock() - t0 > TIME_BUDGET_SEC:
            _say('      [暂停] 时间预算 %d 秒用尽，停在块边界（已改 %d 块）'
                 % (TIME_BUDGET_SEC, done))
            _say('             再点一次「运行」会从没改完的块接着改，不会重复插行。')
            return done, True

        r0 = starts[i]
        nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
        a, b, _t, cnt, _how = _item_range(ws, r0, nxt)

        # ★ 插行之前先验位：A(a+cnt) 必须正好是「合计」行。
        #   靠「合计」行探测出来的块（how='probe'）一定满足；只有靠序号法/兜底法
        #   猜出来的块才会在这里被拦下。拦下时不插任何行 —— 否则会留下 7 行空行，
        #   下次运行又插 7 行，块越滚越长。
        try:
            mark = _val(ws.Range('A%d' % (a + cnt)))
        except Exception:
            mark = None
        if not (isinstance(mark, str) and mark.strip() in TOTAL_WORDS):
            _say('      [失败] 第 %d 块结构不明：明细下界第 %d 行应为「合计」，'
                 '实际读到 %r，本表中止（已改 %d 块，未插任何行）'
                 % (i + 1, a + cnt, mark, done))
            return done, False

        if cnt == OLD_COUNT:
            ok, m = _insert_rows(ws, b + 1, NEW_COUNT - OLD_COUNT)
            if not ok:
                _say('      [失败] 第 %d 块插行失败，本表中止（已改 %d 块）'
                     % (i + 1, done))
                return done, False
            METHOD[0] = m
        elif cnt != NEW_COUNT:
            _say('      [跳过] 第 %d 块项数 %d 异常' % (i + 1, cnt))
            continue

        if not _rewrite_items(ws, a):
            _say('      [失败] 第 %d 块重写后自检不通过，本表中止（已改 %d 块）'
                 % (i + 1, done))
            _say('             已插的行保留着，再点一次运行会自动补写内容。')
            return done, False

        done += 1
        if done % 10 == 0:
            _say('      已改 %d 块…（%.0f 秒）' % (done, _clock() - t0))

    return done, False


# =====================================================================
# 第 3 遍：自检
# =====================================================================
def _verify_sheet(ws):
    """→ (ok, 描述)"""
    starts = _block_starts(ws)
    if len(starts) != 30:
        return False, '站块 %d 块（应为 30）' % len(starts)
    bad = []
    for i, r0 in enumerate(starts):
        if not _block_ok(ws, r0 + OFF_ITEM_START):
            bad.append(i + 1)
    if bad:
        return False, '第 %s 块内容不对' % '、'.join(str(x) for x in bad[:6])
    return True, '30 块 × 80 项 · 标准分合计 %d' % TOT


# =====================================================================
# 主流程
# =====================================================================
def main():
    t0 = _clock()
    _say('=' * 62)
    _say('  考核记录表  73 项 → 80 项  改造 · 全自动版')
    _say('  题库：%d 项 / 标准分合计 %d　换版生效月：%s'
         % (NEW_COUNT, TOT, START_MONTH))
    _say('  规则：只改 ' + START_MONTH + ' 及以后的月表；已有得分的表整张不动')
    _say('=' * 62)

    if len(ITEMS) != NEW_COUNT or abs(TOT - 100) > 0.01:
        _say('[中止] 内置题库自检失败：%d 项 / 合计 %d 分。请勿使用，找维护人。'
             % (len(ITEMS), TOT))
        return

    names = _sheet_names()
    if not names:
        _say('[中止] 取不到工作表列表。')
        _say('       请确认这个脚本是在《考核记录_xxxx.xlsx》里运行的（不是数据源表）。')
        return

    targets, history = [], []
    for nm in names:
        key = _norm_month(nm)
        if not key:
            continue
        (targets if key >= START_MONTH else history).append((nm, key))

    _say('')
    _say('本簿工作表 %d 张，其中月表 %d 张' % (len(names), len(targets) + len(history)))
    if history:
        _say('历史月表 %d 张（不动）：%s'
             % (len(history), '、'.join(sorted(k for _n, k in history))))
    if not targets:
        _say('')
        _say('[结束] 本簿没有 %s 及以后的月表，无需改造。' % START_MONTH)
        return
    _say('目标月表 %d 张：%s' % (len(targets), '、'.join(k for _n, k in targets)))

    # ---------------- 第 1 遍：预检 ----------------
    _say('')
    _say('【第 1 遍】预检（只读，一个格子都不改）')
    plans = []
    for nm, key in targets:
        ws = _get_sheet(nm)
        if ws is None:
            _say('  %-9s [跳过] 取不到工作表对象' % key)
            continue
        p = _plan_sheet(ws, key)
        p['name'] = nm
        p['key'] = key
        p['done'] = 0
        plans.append(p)
        if p['status'] == 'run':
            nn = sum(1 for x in p['need'] if x)
            msg = '  %-9s 可改 %d 块 / 30 块' % (key, nn)
            if p['repair']:
                msg += '，另补写 %d 块半成品' % len(p['repair'])
            _say(msg)
        elif p['status'] == 'skip':
            _say('  %-9s [跳过] %s' % (key, p['reason']))
        else:
            _say('  %-9s [不动] %s' % (key, p['reason']))

    todo = [p for p in plans if p['status'] == 'run']
    if not todo:
        _say('')
        _say('[结束] 没有需要改造的表。%s' % ('全部已就绪。' if plans else ''))
        return

    _say('')
    _say('预检结果：%d 张可改，%d 张跳过，%d 张不动'
         % (len(todo),
            sum(1 for p in plans if p['status'] == 'skip'),
            sum(1 for p in plans if p['status'] == 'reject')))

    # ---------------- 第 2 遍：执行 ----------------
    _say('')
    _say('【第 2 遍】开始改造（从最后一个站块往上，防止块位移）')
    paused = False
    for p in todo:
        ws = _get_sheet(p['name'])
        if ws is None:
            _say('  %s：[跳过] 取不到工作表对象' % p['key'])
            continue
        _say('')
        _say('  --- %s ---' % p['key'])
        d, stop = _run_sheet(ws, p, t0)
        p['done'] = d
        _say('      小计：%d 块 · 插行方法 %s' % (d, METHOD[0] or '未用'))
        if stop:
            paused = True
            break

    # ---------------- 第 3 遍：自检 ----------------
    _say('')
    _say('【第 3 遍】自检')
    all_ok = True
    left = 0
    for p in plans:
        if p['status'] != 'run':
            continue
        ws = _get_sheet(p['name'])
        if ws is None:
            continue
        ok, desc = _verify_sheet(ws)
        flag = 'OK ' if ok else 'BAD'
        _say('  %-9s %s  %s' % (p['key'], flag, desc))
        if not ok:
            all_ok = False
            left += 1

    # ---------------- 汇总 ----------------
    _say('')
    _say('=' * 62)
    plan_blocks = sum(sum(1 for x in p['need'] if x) + len(p['repair']) for p in todo)
    done_blocks = sum(p['done'] for p in todo)
    _say('应改 %d 块 · 实改 %d 块 · 耗时 %.0f 秒'
         % (plan_blocks, done_blocks, _clock() - t0))
    _say('=' * 62)

    if all_ok and done_blocks >= plan_blocks:
        _say('全部完成。')
        _say('下一步：把 record_sync.py 贴到本簿的 PY 编辑器，等检查明细有数据时再跑月度同步。')
        return

    if paused or not all_ok:
        _say('还没全部完成 —— 再点一次「运行」即可，会从没改完的块接着改。')
        _say('（已改好的块会跳过，不会重复插行，放心多点几次。）')
        if left:
            _say('自检未通过的表：%d 张，见上面 BAD 行。' % left)


main()
