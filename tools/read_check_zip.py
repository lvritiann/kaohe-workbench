# -*- coding: utf-8 -*-
"""把现场导出的 zip 拆成「金山上传队列 + 可直接上传的 payload + 可粘贴 TSV」

用法：python tools/read_check_zip.py <检查表_xx.zip>

产出（inbox/检查表/<zip名>/）：
  检查表.xlsx / photos/ / manifest.json          原始包内容
  wps_upload_queue.json                         人类可读上传队列（含回填字段）
  kdocs_upload_payload.json                     可直接交给金山连接器的 base64 清单
  检查明细_导入行.tsv                            可直接粘贴进在线表格的扁平行

链路：现场 zip → 本脚本 → ① TSV 粘进「检查明细」→ ② 用金山连接器上传
      kdocs_upload_payload.json 里的每张照片 → 拿 attachment_id →
      ③ create_float_images 插到对应行 → ④ 回填 attachment_id 到队列。
★ 照片只进金山在线表，GitHub 仓库零照片。
"""
import base64
import json
import mimetypes
import os
import sys
import zipfile

ROOT = r"D:/加油站综合考核系统"
OUT = os.path.join(ROOT, "inbox", "检查表")
CFG_PATH = os.path.join(ROOT, "tools", "config.json")


def load_cfg():
    try:
        with open(CFG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"kdocs": {}, "columns": []}


def mime_of(path):
    m = mimetypes.guess_type(path)[0]
    if m:
        return m
    return "image/jpeg" if path.lower().endswith((".jpg", ".jpeg")) else "application/octet-stream"


def main():
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
        print("[FAIL] 包内没有 manifest.json，无法定位照片与扣分项")
        sys.exit(1)
    with open(mf, encoding="utf-8") as f:
        m = json.load(f)

    cfg = load_cfg()
    kd = cfg.get("kdocs", {})
    station = m.get("station", "")
    month = m.get("month", "")
    inspector = m.get("inspector", "")
    submitted = m.get("submittedAt", "")

    queue, photos_payload = [], []
    for p in m.get("photos", []):
        rel = p.get("file", "")
        local = os.path.join(dest, rel.replace("/", os.sep))
        if not os.path.isfile(local):
            print("[WARN] 照片缺失，跳过：%s" % rel)
            continue
        with open(local, "rb") as f:
            raw = f.read()
        b64 = base64.b64encode(raw).decode("ascii")
        filename = os.path.basename(rel)

        queue.append({
            "station": station, "month": month, "inspector": inspector,
            "itemNo": p.get("itemNo"), "item": p.get("item", ""),
            "reason": p.get("reason", ""),
            "localPath": local.replace("\\", "/"),
            "filename": filename,
            "wpsTarget": "考核工作台数据源 → 检查明细 / 照片附件列",
            "attachmentId": "",
            "uploaded": False
        })
        photos_payload.append({
            "filename": filename,
            "content_type": mime_of(local),
            "content_base64": b64,
            "sizeBytes": len(raw),
            "itemNo": p.get("itemNo"), "item": p.get("item", ""),
            "reason": p.get("reason", ""),
            "note": "上传后把返回的 object_id 回填到 wps_upload_queue.json 的 attachmentId"
        })

    def dump(fn, obj):
        with open(os.path.join(dest, fn), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)

    dump("wps_upload_queue.json", queue)
    dump("kdocs_upload_payload.json", {
        "target": {
            "file_id": kd.get("file_id", ""),
            "worksheet_id": kd.get("worksheet_id", 1),
            "sheet_id": kd.get("worksheet_id", 1),
            "sheet_name": kd.get("sheet_name", "检查明细"),
            "drive_id": kd.get("drive_id", ""),
            "link_url": kd.get("link_url", "")
        },
        "station": station, "month": month, "inspector": inspector,
        "submittedAt": submitted,
        "converted": m.get("converted"), "inspectScore": m.get("inspectScore"),
        "veto": m.get("veto", []),
        "photos": photos_payload,
        "note": "逐张调用 upload_attachment(file_id, filename, content_base64, content_type) "
                "拿到 object_id；再用 sheet.create_float_images 以 "
                "tag=sheet_pic_type_attachment 插到对应行。"
    })

    # 可粘贴 TSV：前 12 列与在线表列序一致，末 2 列为建议新增列
    cols = cfg.get("columns") or [
        "月份", "站名", "表类型", "序号", "大类", "检查项目",
        "标准分", "得分", "结果", "说明", "检查人", "提交时间"
    ]
    cols = list(cols) + ["照片文件名", "照片附件ID"]
    lines = ["\t".join(cols)]
    for q in queue:
        row = {
            "月份": month, "站名": station, "表类型": "运营检查",
            "序号": q["itemNo"], "大类": "", "检查项目": q["item"],
            "标准分": "", "得分": "", "结果": "扣分", "说明": q["reason"],
            "检查人": inspector, "提交时间": submitted,
            "照片文件名": q["filename"], "照片附件ID": ""
        }
        lines.append("\t".join(str(row.get(c, "")).replace("\t", " ").replace("\n", " ")
                              for c in cols))
    with open(os.path.join(dest, "检查明细_导入行.tsv"), "w", encoding="utf-8-sig") as f:
        f.write("\n".join(lines) + "\n")

    print("已拆包：" + dest)
    print("  站点 %s / 月份 %s / 检查人 %s" % (station, month, inspector))
    print("  折算得分 %s / 运营段 %s" % (m.get("converted"), m.get("inspectScore")))
    print("  否决：%s" % ("、".join(m.get("veto", [])) or "无"))
    print("  照片 %d 张" % len(queue))
    print("  ① wps_upload_queue.json    上传队列（含 attachmentId 待回填）")
    print("  ② kdocs_upload_payload.json  可直接上传的 base64 清单")
    print("  ③ 检查明细_导入行.tsv      可粘贴进金山「检查明细」")
    print("  目标表：%s" % (kd.get("link_url") or kd.get("file_id") or "（未配置 tools/config.json）"))
    print("  下一步：TSV 粘进在线表 → 上传照片拿 attachment_id → 插浮动图片 → 回填队列。")


if __name__ == "__main__":
    main()
