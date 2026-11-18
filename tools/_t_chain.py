# -*- coding: utf-8 -*-
"""落表链路端到端测试（tools/ 下 .py 入库留档）

链路：合成现场 zip → read_check_zip.py 拆包 → 检查明细_导入行.tsv
      → record_sync._collect / _fill_block（假 sheet）→ 对照线上 engine.js 的标准答案

覆盖三类包：
  A 有扣分 + 有 NA + 只有 1 项带照片（其余无照片，验证「不按照片出行」）
  B 零扣分满分（deductions=[]，验证占位行 → 该站记 100/28 而不是被当未检查跳过）
  C 触发一票否决（序号 'v3'，验证只贡献否决文本、不参与计分；照片能合并）

跑法：python tools/_t_chain.py
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = r"D:/加油站综合考核系统"
sys.path.insert(0, os.path.join(ROOT, "tools"))
INBOX = os.path.join(ROOT, "inbox", "检查表")

ok_all, fail_all = [], []


def check(name, cond, detail=""):
    (ok_all if cond else fail_all).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (("  " + detail) if detail else ""))


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class FakeSheet:
    def __init__(self, rows):
        self.rows = rows
        self.written = {}

    def Range(self, addr):
        return FakeRange(self, addr)


class FakeRange:
    def __init__(self, sh, addr):
        self.sh, self.addr = sh, addr

    @property
    def Value2(self):
        return self.sh.rows

    @Value2.setter
    def Value2(self, v):
        self.sh.written[self.addr] = v


def run_zip(tag, manifest):
    zpath = os.path.join(INBOX, "_t_%s.zip" % tag)
    with zipfile.ZipFile(zpath, "w") as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for p in manifest.get("photos", []) or []:
            z.writestr(p["file"], b"\xff\xd8\xff\xd9")
        z.writestr("检查表_%s_%s_test.xlsx" % (manifest["station"], manifest["month"]),
                   b"PK\x05\x06" + b"\x00" * 18)
    out = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "read_check_zip.py"), zpath],
                         capture_output=True, text=True, encoding="utf-8", cwd=ROOT)
    dest = os.path.join(INBOX, "_t_%s" % tag)
    tsv = os.path.join(dest, "检查明细_导入行.tsv")
    lines = []
    if os.path.isfile(tsv):
        lines = open(tsv, encoding="utf-8-sig").read().strip().split("\n")
    return out, tsv, lines


def read_tsv(lines):
    head = lines[0].split("\t") if lines else []
    body = [l.split("\t") for l in lines[1:]] if len(lines) > 1 else []
    return head, body


def main():
    items_doc = json.load(open(os.path.join(ROOT, "docs", "data", "items.json"), encoding="utf-8"))
    items = items_doc["items"]
    print("题目 %d 项 · 标准分合计 %d" % (len(items), sum(x["score"] for x in items)))

    rs = load_module(os.path.join(ROOT, "tools", "airscript", "record_sync.py"), "rs")
    block_rows = [[it["no"], it["cat"], it["name"], it["score"]] for it in items]

    no_nos, na_nos = [3, 14, 41], [7, 55]
    answers = {str(it["no"]): ("na" if it["no"] in na_nos else
                              ("no" if it["no"] in no_nos else "ok")) for it in items}
    expect = json.loads(subprocess.check_output(
        ["node", os.path.join(ROOT, "tools", "_t_expect.js"), json.dumps(answers)],
        stderr=subprocess.STDOUT, cwd=ROOT).decode("utf-8"))
    print("engine.js 标准答案：折算 %.2f / 运营段 %.2f（NA %d 项 %.0f 分）"
          % (expect["converted"], expect["inspectScore"], expect["naCount"], expect["naScore"]))

    # ================= A. 有扣分 + NA，只有 1 项带照片 =================
    station, month, inspector = "华山南", "2026-11", "测试员"
    deductions = []
    for it in items:
        a = answers[str(it["no"])]
        if a == "ok":
            continue
        deductions.append({
            "itemNo": it["no"], "item": it["name"], "cat": it["cat"], "std": it["score"],
            "result": "NA" if a == "na" else "扣分",
            "score": None if a == "na" else 0,
            "reason": "" if a == "na" else "现场核查不符合"
        })
    first_no = deductions[0]["itemNo"]
    mf = {
        "version": "V6", "station": station, "month": month, "inspector": inspector,
        "submittedAt": "2026-11-18 15:20",
        "converted": expect["converted"], "inspectScore": expect["inspectScore"],
        "veto": [], "deductions": deductions,
        "photos": [{"itemNo": first_no, "item": deductions[0]["item"],
                    "file": "photos/华山南_项%d_1.jpg" % first_no, "reason": "现场核查不符合"}]
    }
    out, tsv, lines = run_zip("现场包", mf)
    print("--- A. 有扣分 + NA（%d 项，仅 1 张照片）---" % len(deductions))
    if out.returncode != 0:
        print(out.stdout, out.stderr)
        sys.exit(1)

    head, body = read_tsv(lines)
    check("A 表头 19 列", len(head) == 19, "实际 %d" % len(head))
    check("A 第16列 = 运营段得分(28)", head[15] == "运营段得分(28)", head[15])
    check("A 行数 = 扣分/NA 项数（不按照片数）", len(body) == len(deductions),
          "行 %d / 项 %d" % (len(body), len(deductions)))
    check("A 每行 19 列", all(len(r) == 19 for r in body))
    check("A 无照片的扣分项也在 TSV 内",
          set(int(r[3]) for r in body) == set(d["itemNo"] for d in deductions))
    check("A 照片名合并进了对应项", any("项%d_" % first_no in r[12] for r in body),
          str([r[12] for r in body if r[12]]))

    rec, meta, months, dropped = rs._collect([list(head)] + body)
    key = (station, month)
    check("A _collect 认到该站该月", key in rec, "keys=%s" % list(rec.keys()))
    check("A _collect 收下项数 = 扣分+NA 项数", len(rec.get(key, {})) == len(deductions),
          "%d / %d" % (len(rec.get(key, {})), len(deductions)))

    ws = FakeSheet(block_rows)
    conv, op, used, conflict = rs._fill_block(ws, 0, rec.get(key, {}))
    print("A record_sync：折算 %.2f / 运营段 %.2f（消费 %d 项 · 矛盾 %d）"
          % (conv, op, len(used), conflict))
    check("A 折算分与 engine.js 一致", abs(conv - expect["converted"]) < 0.02,
          "%.2f vs %.2f" % (conv, expect["converted"]))
    check("A 运营段与 engine.js 一致", abs(op - expect["inspectScore"]) < 0.02,
          "%.2f vs %.2f" % (op, expect["inspectScore"]))
    check("A 运营段 ≤ 28", op <= rs.INSPECT_BASE, "%.2f" % op)
    check("A 全部扣分项都被消费（无丢项）", used == set(d["itemNo"] for d in deductions),
          "未消费 %s" % sorted(set(d["itemNo"] for d in deductions) - used))
    check("A 无结果/得分矛盾", conflict == 0, str(conflict))
    check("A E:I 共 5 列写回",
          len((ws.written.get("E3:I75") or [[]])[0]) == 5
          and len(ws.written.get("E3:I75")) == len(items),
          "key=%s 行数=%d" % (list(ws.written.keys()),
                              len(ws.written.get("E3:I75") or [])))

    conv1, op1, _, _ = rs._fill_block(FakeSheet(block_rows), 0, {first_no: rec[key][first_no]})
    check("A （反证）只落 1 项时分数明显偏高", conv1 > conv + 1, "%.2f > %.2f" % (conv1, conv))

    # ================= B. 零扣分满分（deductions=[]）=================
    mf_b = {
        "version": "V6", "station": "南沙南", "month": month, "inspector": inspector,
        "submittedAt": "2026-11-18 15:30", "converted": 100, "inspectScore": 28,
        "veto": [], "deductions": [], "photos": []
    }
    out, tsv, lines = run_zip("满分包", mf_b)
    print("--- B. 零扣分满分（deductions=[]）---")
    check("B 不再误报「无 deductions 字段」", "无 deductions 字段" not in (out.stdout or ""),
          (out.stdout or "").strip().split("\n")[0])
    check("B 提示生成了占位行", "占位行" in (out.stdout or ""))
    head, body = read_tsv(lines)
    check("B 有 1 条数据行（不是只有表头）", len(body) == 1, "行 %d" % len(body))
    check("B 占位行序号为空", body and body[0][3] == "", body[0][3] if body else "-")
    check("B 占位行结果=符合", body and body[0][8] == "符合", body[0][8] if body else "-")
    rec_b, meta_b, months_b, _ = rs._collect([list(head)] + body)
    kb = ("南沙南", month)
    check("B meta 登记了该站该月（关键：靠这个区分未检查）", kb in meta_b, str(list(meta_b.keys())))
    check("B rec 里没有可计分项", len(rec_b.get(kb, {})) == 0, str(rec_b.get(kb, {})))
    conv_b, op_b, _, _ = rs._fill_block(FakeSheet(block_rows), 0, rec_b.get(kb, {}))
    check("B 满分站折算 = 100", abs(conv_b - 100) < 0.01, "%.2f" % conv_b)
    check("B 满分站运营段 = 28", abs(op_b - 28) < 0.01, "%.2f" % op_b)

    # ================= C. 一票否决 =================
    mf_c = {
        "version": "V6", "station": "略阳东", "month": month, "inspector": inspector,
        "submittedAt": "2026-11-18 15:40", "converted": 100, "inspectScore": 28,
        "veto": ["重大安全事故"],
        "deductions": [{"itemNo": "v3", "item": "重大安全事故", "cat": "一票否决",
                        "std": None, "result": "否决", "score": None, "reason": "现场确认"}],
        "photos": [{"itemNo": "v3", "item": "重大安全事故",
                    "file": "photos/否决3_1.jpg", "reason": "现场确认"}]
    }
    out, tsv, lines = run_zip("否决包", mf_c)
    print("--- C. 一票否决 ---")
    head, body = read_tsv(lines)
    check("C 有 1 行且序号为小写 v3", len(body) == 1 and body[0][3] == "v3",
          body[0][3] if body else "-")
    check("C 否决项照片名合并进否决行", body and "否决3_1.jpg" in body[0][12],
          body[0][12] if body else "-")
    rec_c, meta_c, _, _ = rs._collect([list(head)] + body)
    kc = ("略阳东", month)
    check("C 否决项不参与 73 项计分", len(rec_c.get(kc, {})) == 0, str(rec_c.get(kc, {})))
    check("C 否决文本已收进 meta", meta_c.get(kc, ("", "", ""))[2] != "",
          str(meta_c.get(kc)))

    # ================= D. 会计月一致性告警 =================
    mf_d = dict(mf)
    mf_d = json.loads(json.dumps(mf))
    mf_d["submittedAt"] = "2026-11-27 10:00"      # 26 日之后 → 应属 2026-12
    out, _, _ = run_zip("跨月包", mf_d)
    check("D 26 日提交但月份填上月 → 给会计月告警", "会计月不一致" in (out.stdout or ""),
          (out.stdout or "").strip().split("\n")[-1])

    # ================= E. 「月份」列形态归一 =================
    import datetime as _dt
    check("E '2026-11' → 2026-11", rs._norm_month("2026-11") == "2026-11")
    check("E datetime → 2026-11", rs._norm_month(_dt.datetime(2026, 11, 1)) == "2026-11")
    check("E 202611 数字 → 2026-11", rs._norm_month(202611) == "2026-11")
    check("E '2026/11/01 08:00' → 2026-11", rs._norm_month("2026/11/01 08:00") == "2026-11")
    check("E '2026-11-01 00:00:00' → 2026-11", rs._norm_month("2026-11-01 00:00:00") == "2026-11")

    # ================= F. 表类型过滤 + 诊断语分流 =================
    rows_x = [list(head),
              ["2026-11", "华山南", "神秘访客", "3", "x", "x", "2", "0", "扣分", "x",
               "甲", "2026-11-18", "", "", "100", "28", "", "x", "x"]]
    rec_x, meta_x, months_x, dropped_x = rs._collect(rows_x)
    check("F 非「运营检查」表类型被丢弃", len(dropped_x) == 1 and not rec_x,
          "dropped=%s" % (dropped_x,))
    check("F 全被丢弃 → 诊断为「表类型写错」而非「没人填」",
          "表类型" in rs._no_month_message(dropped_x)
          and "暂无数据" not in rs._no_month_message(dropped_x),
          rs._no_month_message(dropped_x).split("\n")[0])
    check("F 真无数据 → 诊断为「暂无数据」",
          rs._no_month_message([]) == "检查明细暂无数据，跳过",
          rs._no_month_message([]))
    check("F 「二级运营检查」在白名单内",
          "二级运营检查" in rs.ACCEPT_TYPES, str(rs.ACCEPT_TYPES))

    # ================= H. 部分得分计入 conflict =================
    ws_p = FakeSheet(block_rows)
    std3 = next(x["score"] for x in items if x["no"] == 3)
    _, _, _, cf_ok = rs._fill_block(ws_p, 0, {3: (std3 - 1, "符合", "", "", "")})
    check("H 结果=符合但得分更低 → 计入 conflict", cf_ok == 1, str(cf_ok))
    _, _, _, cf_eq = rs._fill_block(FakeSheet(block_rows), 0, {3: (std3, "符合", "", "", "")})
    check("H 结果=符合且得分=标准分 → 不算 conflict", cf_eq == 0, str(cf_eq))
    _, _, _, cf_no = rs._fill_block(FakeSheet(block_rows), 0, {3: (0.5, "扣分", "", "", "")})
    check("H 部分得分 → 计入 conflict", cf_no == 1, str(cf_no))
    _, _, _, cf_se = rs._fill_block(FakeSheet(block_rows), 0, {3: (0, "扣分", "", "", "")})
    check("H 全扣 0 分 → 不算 conflict", cf_se == 0, str(cf_se))

    # ================= G. engine.currentMonth =================
    cm = json.loads(subprocess.check_output(
        ["node", "-e", "global.window={};require('./docs/assets/config.js');"
                       "require('./docs/assets/engine.js');"
                       "console.log(JSON.stringify(window.Engine.currentMonth()))"], cwd=ROOT).decode())
    check("G currentMonth 返回 YYYY-MM", len(cm) == 7 and cm[4] == "-", cm)

    # ================= 清理 =================
    for tag in ("现场包", "满分包", "否决包", "跨月包"):
        for p in (os.path.join(INBOX, "_t_%s" % tag), os.path.join(INBOX, "_t_%s.zip" % tag)):
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            elif os.path.isfile(p):
                os.remove(p)
    print("临时产物已清理")

    print("\n===== 结果：%d 通过 / %d 失败 =====" % (len(ok_all), len(fail_all)))
    if fail_all:
        for f in fail_all:
            print("  失败：" + f)
        sys.exit(1)


if __name__ == "__main__":
    main()
