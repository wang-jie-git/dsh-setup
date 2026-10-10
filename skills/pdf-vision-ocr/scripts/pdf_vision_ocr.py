#!/usr/bin/env python3
"""
pdf_vision_ocr.py — PDF→图片→AI视觉OCR 并行处理（含色彩分析）

用法:
  python3 pdf_vision_ocr.py "文件.pdf" [--pages 1-10] [--text-only] [--dpi 150] [--workers 5]

性能（186 页实测）:
  串行: ~2.3 小时
  5 并发: ~20 分钟
"""

import sys
import os
import json
import base64
import urllib.request
import argparse
import time
import subprocess
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── AGNES API 配置 ──
API_KEY = os.environ.get("AGNES_API_KEY", "")
API_URL = "https://api.agnes-ai.cn/v1/chat/completions"
MODEL = "agnes-2.5-flash"

# ── Prompt（精简版，减少 token 加速响应）──
FULL_PROMPT = """分析这张图片，输出：

## 文字
原样抄录所有可见文字（标题/正文/标注/表格/水印/页码），保持结构。手写体尽力辨认。

## 色彩
按占比排列：
| 色彩 | Hex | HSL | 占比 | 饱和度 | 传统色名 |
主色调优先。传统色名参考：天青#87CEEB、月白#D6ECF0、茶白#F3F0E3、水绿#7BA7A0、黛青#4A4266、缃黄#E7C677、朱砂#B5443A、墨色#2B2B2B

## 色彩总评
色调(暖/冷/中性) | 饱和度(低/中/高) | 明度(高/中/低) | 搭配特点(一句话)"""

TEXT_ONLY_PROMPT = "原样抄录这张图片中所有可见文字。保持表格结构。只输出文字，不加解释。"


def resize_image(image_path: str, max_dim: int = 1600, quality: int = 85) -> tuple:
    """缩图 + JPEG 压缩，返回 (base64, mime)。超过 max_dim 的图等比缩小。"""
    from PIL import Image
    import io

    img = Image.open(image_path)
    # RGB 化（PNG 可能是 RGBA）
    if img.mode in ("RGBA", "P", "L"):
        img = img.convert("RGB")
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # 等比缩小
    w, h = img.size
    if max(w, h) > max_dim:
        scale = max_dim / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    img_b64 = base64.b64encode(buf.getvalue()).decode()
    return img_b64, "image/jpeg"


def call_vision_api(image_path: str, text_only: bool = False, max_dim: int = 1600) -> tuple:
    """调用 AGNES Vision API，返回 (content, elapsed, tokens)。自动缩图。"""
    img_b64, mime = resize_image(image_path, max_dim=max_dim)

    prompt = TEXT_ONLY_PROMPT if text_only else FULL_PROMPT
    max_tokens = 2048 if text_only else 3072

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}}
        ]}],
        "max_tokens": max_tokens,
        "temperature": 0.3
    }

    req = urllib.request.Request(
        API_URL, data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    )
    proxy_handler = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(proxy_handler)

    start = time.time()
    resp = opener.open(req, timeout=120)
    d = json.loads(resp.read())
    elapsed = time.time() - start
    content = d["choices"][0]["message"]["content"]
    tokens = d.get("usage", {}).get("total_tokens", 0)
    return content, elapsed, tokens


def process_image(args_tuple):
    """线程池 worker：处理单张图片"""
    img_path, label, idx, total, text_only = args_tuple
    try:
        content, elapsed, tokens = call_vision_api(img_path, text_only)
        return idx, label, content, elapsed, tokens, None
    except Exception as e:
        return idx, label, None, time.time(), 0, str(e)


def progress_bar(done, total, elapsed):
    pct = done / total * 100
    bar_len = 30
    filled = int(bar_len * done / total)
    bar = "█" * filled + "░" * (bar_len - filled)
    eta = (elapsed / done * (total - done)) if done > 0 else 0
    sys.stdout.write(f"\r  [{bar}] {done}/{total} ({pct:.0f}%) {elapsed:.0f}s elapsed, ~{eta:.0f}s ETA")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description="PDF Vision OCR (并行)")
    parser.add_argument("pdf_file", help="PDF 文件路径")
    parser.add_argument("--pages", help="页范围 如 1-10", default=None)
    parser.add_argument("--text-only", action="store_true", help="仅 OCR 文字")
    parser.add_argument("--dpi", type=int, default=150, help="渲染 DPI (默认 150)")
    parser.add_argument("--workers", type=int, default=5, help="并发数 (默认 5)")
    parser.add_argument("--skip-embed", action="store_true", help="跳过内嵌图片提取")
    parser.add_argument("--max-embed", type=int, default=10, help="最多处理内嵌图片数 (默认 10)")
    args = parser.parse_args()

    if not os.path.exists(args.pdf_file):
        print(f"Error: {args.pdf_file} not found"); sys.exit(1)

    pdf_name = os.path.splitext(os.path.basename(args.pdf_file))[0]
    out_dir = f"/tmp/pdf-vision-ocr/{pdf_name}"
    page_dir = f"{out_dir}/pages"
    embed_dir = f"{out_dir}/embedded"
    report_file = f"{out_dir}/report.md"
    os.makedirs(page_dir, exist_ok=True)
    os.makedirs(embed_dir, exist_ok=True)

    print(f"=== PDF Vision OCR (并行 x{args.workers}) ===")
    print(f"文件: {args.pdf_file}")
    print(f"DPI: {args.dpi} | 文字only: {args.text_only} | 并发: {args.workers}")
    print()

    # ── 1. PDF 信息 ──
    info = subprocess.run(["pdfinfo", args.pdf_file], capture_output=True, text=True)
    print("## PDF 信息")
    for line in info.stdout.splitlines():
        if any(k in line for k in ["Pages:", "Page size:", "Title:"]):
            print(f"  {line}")
    print()

    # ── 2. PDF → PNG ──
    print("## PDF → PNG 转换中...", end=" ", flush=True)
    if args.pages:
        p = args.pages.split("-")
        cmd = ["pdftoppm", "-png", "-r", str(args.dpi), "-f", p[0], "-l", p[-1],
               args.pdf_file, f"{page_dir}/page"]
    else:
        cmd = ["pdftoppm", "-png", "-r", str(args.dpi), args.pdf_file, f"{page_dir}/page"]
    subprocess.run(cmd, capture_output=True)
    page_imgs = sorted([f"{page_dir}/{f}" for f in os.listdir(page_dir) if f.endswith(".png")])
    print(f"{len(page_imgs)} 页")

    # ── 3. 内嵌图片 ──
    embed_imgs = []
    if not args.skip_embed:
        print("## 提取内嵌图片...", end=" ", flush=True)
        subprocess.run(["pdfimages", "-png", args.pdf_file, f"{embed_dir}/img"], capture_output=True)
        embed_imgs = sorted([f"{embed_dir}/{f}" for f in os.listdir(embed_dir) if f.endswith(".png")])
        embed_imgs = embed_imgs[:args.max_embed]  # 限制数量
        print(f"{len(embed_imgs)} 张（最多处理 {args.max_embed}）")
    print()

    # ── 4. 并行 AI 识别 ──
    all_results = {}

    # 4a. 页面图片
    print(f"## AI 视觉识别 — {len(page_imgs)} 页")
    tasks = [(page_imgs[i], f"第 {i+1} 页", i, len(page_imgs), args.text_only)
             for i in range(len(page_imgs))]

    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_image, t): t for t in tasks}
        for future in as_completed(futures):
            idx, label, content, elapsed, tokens, error = future.result()
            done += 1
            progress_bar(done, len(page_imgs), time.time() - t0)
            all_results[("page", idx)] = (label, content, elapsed, tokens, error)
    elapsed_wall = time.time() - t0
    print(f"\n  完成: {elapsed_wall:.0f}s, 平均 {elapsed_wall/max(done,1):.1f}s/页")
    print()

    # 4b. 内嵌图片
    if embed_imgs:
        print(f"## AI 视觉识别 — {len(embed_imgs)} 张内嵌图片")
        tasks_e = [(embed_imgs[i], f"内嵌图片 {i+1}", i, len(embed_imgs), args.text_only)
                   for i in range(len(embed_imgs))]
        t0e = time.time()
        done_e = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(process_image, t): t for t in tasks_e}
            for future in as_completed(futures):
                idx, label, content, elapsed, tokens, error = future.result()
                done_e += 1
                progress_bar(done_e, len(embed_imgs), time.time() - t0e)
                all_results[("embed", idx)] = (label, content, elapsed, tokens, error)
        print(f"\n  完成: {time.time()-t0e:.0f}s")
        print()

    # ── 5. 生成报告 ──
    print("## 生成报告...")
    total_time = 0
    with open(report_file, "w") as f:
        f.write(f"# PDF Vision OCR 报告\n\n")
        f.write(f"- **文件**: {args.pdf_file}\n")
        f.write(f"- **页数**: {len(page_imgs)}\n")
        f.write(f"- **内嵌图片**: {len(embed_imgs)}\n")
        f.write(f"- **DPI**: {args.dpi}\n")
        f.write(f"- **模式**: {'仅文字' if args.text_only else '文字+色彩'}\n")
        f.write(f"- **并发**: {args.workers}\n\n")

        for i in range(len(page_imgs)):
            if ("page", i) in all_results:
                label, content, elapsed, tokens, error = all_results[("page", i)]
                total_time += elapsed
                f.write(f"---\n\n## {label}\n\n")
                if error:
                    f.write(f"⚠️ 识别失败: {error}\n\n")
                else:
                    f.write(f"{content}\n\n")

        if embed_imgs:
            f.write("---\n\n## 内嵌图片分析\n\n")
            for i in range(len(embed_imgs)):
                if ("embed", i) in all_results:
                    label, content, elapsed, tokens, error = all_results[("embed", i)]
                    f.write(f"### {label}\n\n")
                    if error:
                        f.write(f"⚠️ 识别失败: {error}\n\n")
                    else:
                        f.write(f"{content}\n\n")

    print(f"报告: {report_file}")
    print(f"总耗时: {total_time:.0f}s (API累计), 墙钟约 {total_time/max(args.workers,1):.0f}s")


if __name__ == "__main__":
    main()
