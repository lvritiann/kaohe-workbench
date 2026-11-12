# -*- coding: utf-8 -*-
"""把现场导出的 zip 拆成「金山上传队列」，照片不进 GitHub。

用法：python tools/read_check_zip.py <检查表_xx.zip>
产出：inbox/检查表/<zip名>/  （xlsx + photos/ + manifest.json）
      inbox/检查表/<zip名>/wps_upload_queue.json
"""
import json, os, sys, zipfile

ROOT = r"D:/加油站综合考核系统"
OUT = os.path.join(ROOT, "inbox", "检查表")

if len(sys.argv) < 2:
    print("用法：python tools/read_check_zip.py <检查表_xx.zip>")
    sys.exit(1)

src = sys.argv[1]
name = os.path.splitext(os.path.basename(src))[0]
dest = os.path.join(OUT, name)
os.makedirs(dest, exist_ok=True)
with zipfile.ZipFile(src) as z:
    z.extractall(dest)

mf = os.path.join(dest, "manifest.json")
if not os.path.isfile(mf):
    print("[FAIL] 包内没有 manifest.json")
    sys.exit(1)
m = json.load(open(mf, encoding="utf-8"))

queue = []
for p in m.get("photos", []):
    queue.append({
        "station": m["station"], "month": m["month"],
        "inspector": m.get("inspector", ""),
        "itemNo": p["itemNo"], "item": p["item"], "reason": p.get("reason", ""),
        "localPath": os.path.join(dest, p["file"]).replace("\\", "/"),
        "wpsTarget": "考核工作台数据源（V2.1）→ 检查明细 / 照片附件列",
        "uploaded": False
    })
qpath = os.path.join(dest, "wps_upload_queue.json")
io = open(qpath, "w", encoding="utf-8")
json.dump(queue, io, ensure_ascii=False, indent=2)
io.close()

print("已拆包：" + dest)
print("  站点 %s / 月份 %s / 检查人 %s" % (m["station"], m["month"], m.get("inspector", "")))
print("  折算得分 %s / 运营段 %s" % (m.get("converted"), m.get("inspectScore")))
print("  否决：%s" % (("、".join(m["veto"]) if m.get("veto") else "无")))
print("  照片 %d 张 → wps_upload_queue.json" % len(queue))
print("  下一步：由科室把照片导入金山在线表对应扣分项的附件列；GitHub 不推照片。")
