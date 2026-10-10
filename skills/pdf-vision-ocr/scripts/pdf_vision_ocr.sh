#!/bin/bash
# pdf_vision_ocr.sh — 入口脚本，调用并行 Python 版
# 用法: bash pdf_vision_ocr.sh "文件.pdf" [--pages 1-10] [--text-only] [--dpi 300] [--workers 5]
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$SCRIPT_DIR/pdf_vision_ocr.py" "$@"
