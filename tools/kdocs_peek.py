# -*- coding: utf-8 -*-
"""kdocs_peek —— 读云文档某区域，打印成对齐网格（调试用）

用法：
  python tools/kdocs_peek.py <file_id> <sheetId> <r1> <r2> <c1> <c2> [--json]

行列均为 1-based（跟 Excel 一致），内部转 0-based 传给 kdocs-cli。
"""
import json
import subprocess
import sys


def _cli(args):
    p = subprocess.run(["kdocs-cli"] + args, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", shell=False)
    out = (p.stdout or "") + (p.stderr or "")
    dec = json.JSONDecoder()
    for i, ch in enumerate(out):
        if ch in "{[":
            try:
                obj, _ = dec.raw_decode(out[i:])
                return obj
            except Exception:
                continue
    raise SystemExit("无法解析输出：\n" + out[:2000])


def fetch(file_id, sheet_id, r1, r2, c1, c2):
    cmd = json.dumps({
        "file_id": file_id,
        "worksheet_id": int(sheet_id),
        "range": {"rowFrom": r1 - 1, "rowTo": r2 - 1,
                  "colFrom": c1 - 1, "colTo": c2 - 1},
    }, ensure_ascii=False)
    obj = _cli(["sheet", "get-range-data", cmd])
    cells = (obj.get("data") or {}).get("detail", {}).get("rangeData") or []
    grid = {}
    for c in cells:
        grid[(c.get("originRow", c.get("rowFrom")) + 1,
              c.get("originCol", c.get("colFrom")) + 1)] = c.get("cellText", "")
    return grid


def col_name(i):
    s = ""
    while i > 0:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def main():
    if len(sys.argv) < 7:
        raise SystemExit(__doc__)
    fid, sid = sys.argv[1], sys.argv[2]
    r1, r2, c1, c2 = (int(x) for x in sys.argv[3:7])
    as_json = "--json" in sys.argv
    grid = fetch(fid, sid, r1, r2, c1, c2)
    if as_json:
        print(json.dumps({"%d,%d" % k: v for k, v in grid.items()},
                         ensure_ascii=False, indent=1))
        return
    for r in range(r1, r2 + 1):
        cells = [str(grid.get((r, c), "") or "") for c in range(c1, c2 + 1)]
        if not any(x.strip() for x in cells):
            continue
        print("R%-4d" % r, end=" ")
        for c, t in zip(range(c1, c2 + 1), cells):
            t = t.replace("\n", " / ")
            if len(t) > 28:
                t = t[:27] + "…"
            print("%-30s" % t, end=" ")
        print()


if __name__ == "__main__":
    main()
