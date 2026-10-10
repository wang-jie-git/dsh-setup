#!/bin/bash
# dsh-reinstall — 一键回滚到上一个 git commit 并重装
set -e

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

cd "$DSH_HOME"

case "${1:-help}" in
  status)
    echo "📋 当前状态:"
    git log --oneline -5
    echo ""
    git status --short
    ;;

  rollback)
    echo "⏪ 回滚到上一个 commit..."
    git checkout HEAD~1 -- .
    echo "✅ 配置已回滚"
    ;;

  reset)
    echo "🔁 重置到初始基线 (c0f9ce8)..."
    git checkout c0f9ce8 -- .
    echo "✅ 已重置到初始基线"
    ;;

  install)
    echo "📦 重装依赖..."
    cd "$DSH_HOME/profiles/web"
    rm -rf node_modules pnpm-lock.yaml
    pnpm install --config.minimumReleaseAge=0
    echo "✅ 依赖安装完成"
    ;;

  restart)
    echo "🔄 重启 DSH Web..."
    # 停掉当前 DSH
    PID=$(lsof -ti:3080 2>/dev/null || true)
    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null
      sleep 2
    fi
    # 启动新 DSH
    dsh web &
    sleep 4
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/ | grep -q 200; then
      echo "✅ DSH 已启动: http://127.0.0.1:3080"
    else
      echo "⚠️  DSH 启动中，请稍后检查..."
    fi
    ;;

  full)
    # 一键全流程：回滚→重装→重启
    echo "========== dsh 一键重装 =========="
    "$0" rollback
    "$0" install
    "$0" restart
    echo "========== 完成 =========="
    ;;

  clean)
    # 干净重装：重置到初始基线
    echo "========== dsh 干净重装 =========="
    "$0" reset
    "$0" install
    "$0" restart
    echo "========== 完成 =========="
    ;;

  help|*)
    echo "用法: dsh-reinstall <子命令>"
    echo ""
    echo "子命令:"
    echo "  status          查看当前 git 状态和最近提交"
    echo "  rollback        回滚到上一个 commit（撤最后一次变更）"
    echo "  reset           重置到初始基线（出厂设置）"
    echo "  install         重新 pnpm install（清 node_modules）"
    echo "  restart         重启 DSH Web"
    echo "  full            一键 rollback + install + restart"
    echo "  clean           一键 reset + install + restart"
    echo ""
    echo "使用场景:"
    echo "  装插件搞坏了 -> dsh-reinstall full"
    echo "  想恢复出厂  -> dsh-reinstall clean"
    echo "  先看看状态  -> dsh-reinstall status"
    ;;
esac