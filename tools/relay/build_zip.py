# -*- coding: utf-8 -*-
"""把 tools/relay/scf.js 打包成可直接上传到腾讯云函数的 zip

用法：
    python tools/relay/build_zip.py

产物：
    dist/kaohe-relay.zip   ← 上传用
    dist/index.js          ← 同一份代码的裸文件，在线编辑时手动贴用

为什么要有这个脚本（不要手动压缩）：
  ① 上传包的「入口文件必须在解压后的根目录」，多套一层 index.js/ 目录就会
     报 HandlerNotFound。这里用 arcname="index.js" 保证在根。
  ② 腾讯云在线编辑器里的模板给的是 index.mjs（ES 模块），一旦粘贴失败或
     格式串味，运行时就报 443 UserCodeError，而且错误信息只有
     "0 code exit unexpected"，看不出原因。上传 zip 会把整份代码包换掉，
     连 index.mjs 一起清掉，只留一个 CJS 的 index.js，最省心。
  ③ zip 内时间戳固定，同样的源码每次打出来的包字节一致，便于比对。
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "tools", "relay", "scf.js")
OUT_DIR = os.path.join(ROOT, "dist")
OUT = os.path.join(OUT_DIR, "kaohe-relay.zip")


def main():
    with open(SRC, "rb") as f:
        code = f.read()

    os.makedirs(OUT_DIR, exist_ok=True)

    # 裸文件：万一「本地上传zip包」用不了，可以打开它全选复制去在线编辑
    bare = os.path.join(OUT_DIR, "index.js")
    with open(bare, "wb") as f:
        f.write(code)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        info = zipfile.ZipInfo("index.js", date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, code)

    print("已生成:", OUT)
    print("包内文件:", zipfile.ZipFile(OUT).namelist())
    print("大小:", os.path.getsize(OUT), "bytes")
    print("裸文件:", bare)


if __name__ == "__main__":
    main()
