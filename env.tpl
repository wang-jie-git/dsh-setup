# =============================================================
# dsh 环境变量模板（复制为 ~/.dsh/.env 后填写真实值）
# 注意：真实 key 不入 git 仓库；本文件只保存变量名模板
# =============================================================

# LLM 提供商（dsh web profile 模型选择器使用）
AGNES_API_KEY=
SHANGTANG_API_KEY=
ZHIPUAI_API_KEY=
XIAOMI_API_KEY=

# 嵌入模型（AI-memory MCP --embedder api 模式）
JINA_API_KEY=

# NocoBase MCP 鉴权 token（服装 AI 商品属性智能体）
NOCOBASE_MCP_TOKEN=

# dsh-timeline 扩展（Cutia server 必填）
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
FREESOUND_CLIENT_ID=

# 本机可执行文件路径（install.sh 用于替换 cordis.patch.yml 的 Mac 路径）
# AI_MEMORY_DIR=/path/to/AI-memory
# AI_MEMORY_DATA_DIR=/path/to/.local/share/ai-memory
# OBSIDIAN_VAULT=/path/to/ObsidianVault
# NEXUS_BROWSER_DIR=/path/to/nexus-browser
# DSH_MEDIA_MCP_DIR=/path/to/dsh-media-mcp
# NPM_GLOBAL_BIN=/path/to/npm-global/bin
