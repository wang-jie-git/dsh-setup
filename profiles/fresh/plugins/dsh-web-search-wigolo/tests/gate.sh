#!/bin/sh
# dsh-web-search-wigolo 提交门禁（moat v1.7.20 JS preflight 增强版）
# 手动: sh tests/gate.sh | 提交自动钩子 | 跳过: git commit --no-verify
set -u
FAIL=0
echo ""
echo "🧪 [gate] dsh-web-search-wigolo 提交门禁"
echo "══════════════════════════════════════"

# 1. 语法检查
echo "── [1/4] 语法检查 (node --check) ──"
for f in src/index.js test/*.mjs; do
  [ -f "$f" ] || continue
  if ! node --check "$f" 2>/tmp/gate-wigolo-err; then
    echo "❌ 语法错误: $f"; cat /tmp/gate-wigolo-err; FAIL=1
  fi
done
[ "$FAIL" = "0" ] && echo "   ✅ 语法检查通过"
echo ""

# 2. 测试套件（RED/GREEN 契约快照）
echo "── [2/4] 测试套件 (node --test adapters) ──"
TEST_OUTPUT=$(node --test test/adapters.test.mjs 2>&1 || true)
if echo "$TEST_OUTPUT" | grep -qE "ℹ fail [1-9]"; then
  echo "❌ 测试失败:"; echo "$TEST_OUTPUT" | grep -E "✖|fail" | head -20; FAIL=1
else
  echo "   ✅ 测试通过"
fi
echo ""

# 3. 导出契约冒烟
echo "── [3/4] 导出冒烟 ──"
if node --input-type=module -e "
import('./src/index.js').then((m) => {
  console.log('   ✅ 模块加载 OK, 导出:', Object.keys(m).slice(0,8).join(', ') || '(default)')
}).catch((e) => { console.error('❌', e.message); process.exit(1) })
" 2>/tmp/gate-wigolo-smoke; then
  :
else
  echo "❌ 冒烟失败:"; cat /tmp/gate-wigolo-smoke; FAIL=1
fi
echo ""

# 4. moat（v1.7.20 支持 JS preflight）
echo "── [4/4] moat check + preflight ──"
MOAT_OUT=$(timeout 60 moat check 2>&1 || true)
if echo "$MOAT_OUT" | grep -qE "失败: [1-9]|FAILED"; then
  echo "❌ moat check 失败:"; echo "$MOAT_OUT" | tail -15; FAIL=1
else
  echo "   ✅ moat check 通过"
fi
PREFLIGHT_OUT=$(timeout 60 moat preflight --files src/index.js --project . 2>&1 || true)
if echo "$PREFLIGHT_OUT" | grep -qE "CRITICAL: [1-9]|HIGH: [1-9]"; then
  echo "❌ preflight 发现高危变更:"; echo "$PREFLIGHT_OUT" | grep -B1 -A3 "CRITICAL\|HIGH" | head -20; FAIL=1
else
  echo "   ✅ moat preflight 通过（$(echo "$PREFLIGHT_OUT" | grep -oE '发现 [0-9]+ 个函数' | head -1 || echo '无高危')）"
fi
echo ""

echo "══════════════════════════════════════"
[ "$FAIL" = "0" ] && { echo "✅ [gate] 全部通过"; exit 0; } || { echo "❌ [gate] 存在失败项"; exit 1; }