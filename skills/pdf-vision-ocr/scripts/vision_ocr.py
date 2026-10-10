#!/usr/bin/env python3
"""
vision_ocr.py — 对单张图片调用 AGNES Vision API 进行 OCR + 色彩分析

用法:
  python3 vision_ocr.py <image_path> [--text-only] [--json]

输出:
  - 默认: markdown 格式的识别结果
  - --json: JSON 格式
"""

import sys
import os
import json
import base64
import urllib.request
import argparse
import time

# AGNES API 配置（与 free-vision.json 一致）
API_KEY = os.environ.get("AGNES_API_KEY", "")
API_URL = "https://api.agnes-ai.cn/v1/chat/completions"
MODEL = "agnes-2.5-flash"

# 色彩分析 prompt（OCR + 色彩属性）
FULL_PROMPT = """请对这张图片进行全面分析，输出以下内容：

## 文字 OCR
原样抄录图片中所有可见文字（包括标题、正文、标注、水印、页码等）。
如有表格，保持表格结构。如有手写文字，尽力辨认。

## 色彩分析
识别图片中的主要色彩，按占比从高到低排列：

| 序号 | 色彩描述 | Hex 值 | HSL (H/S/L) | 占比 | 饱和度 | 传统色名 |
|------|---------|--------|-------------|------|--------|---------|
| 1 | (主色调描述) | #XXXXXX | H:XX° S:XX% L:XX% | XX% | 低/中/高 | (如适用) |

传统色名映射参考：
- 天青 #87CEEB 系、月白 #D6ECF0 系、茶白 #F3F0E3 系、水绿 #7BA7A0 系
- 黛青 #4A4266 系、缃黄 #E7C677 系、朱砂 #B5443A 系、墨色 #2B2B2B 系

## 色彩总评
- 整体色调：（暖/冷/中性）
- 饱和度水平：（低饱和/中等/高饱和）
- 明度范围：（高/中/低）
- 色彩搭配特点：（如：对比强烈/和谐统一/渐变过渡等）
"""

# 仅文字 OCR prompt
TEXT_ONLY_PROMPT = """请原样抄录这张图片中的所有可见文字。
包括：标题、正文、标注、表格内容、水印、页码、注释等。
如有表格，保持原始结构。如有手写文字，尽力辨认。
不要添加额外解释，只输出识别到的文字内容。"""


def call_vision_api(image_path: str, text_only: bool = False) -> dict:
    """调用 AGNES Vision API 识别图片"""
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    # 检测 MIME 类型
    ext = os.path.splitext(image_path)[1].lower()
    mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
    mime = mime_map.get(ext, "image/png")

    prompt = TEXT_ONLY_PROMPT if text_only else FULL_PROMPT

    payload = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}}
            ]
        }],
        "max_tokens": 4096,
        "temperature": 0.3  # 低温度保证 OCR 准确性
    }

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        }
    )

    # 绕过系统代理（AGNES 国内端直连）
    proxy_handler = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(proxy_handler)

    resp = opener.open(req, timeout=120)
    return json.loads(resp.read())


def main():
    parser = argparse.ArgumentParser(description="AI Vision OCR for single image")
    parser.add_argument("image_path", help="图片路径")
    parser.add_argument("--text-only", action="store_true", help="仅 OCR 文字，跳过色彩分析")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()

    if not os.path.exists(args.image_path):
        print(f"Error: file not found: {args.image_path}", file=sys.stderr)
        sys.exit(1)

    start = time.time()
    try:
        result = call_vision_api(args.image_path, args.text_only)
        elapsed = time.time() - start
        content = result["choices"][0]["message"]["content"]
        usage = result.get("usage", {})

        if args.json:
            output = {
                "image": args.image_path,
                "content": content,
                "tokens": usage,
                "elapsed_seconds": round(elapsed, 1)
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))
        else:
            print(f"--- 识别结果: {os.path.basename(args.image_path)} ---")
            print(f"耗时: {elapsed:.1f}s | Tokens: {usage.get('total_tokens', '?')}")
            print()
            print(content)
    except Exception as e:
        elapsed = time.time() - start
        print(f"Error after {elapsed:.1f}s: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
