# Kdenlive 专业剪辑配方（cli-anything-kdenlive）

适用于**多轨编辑、转场、关键帧、精细时间轴**等需要专业剪辑结构的任务。

## 环境事实

| 组件 | 路径 |
|---|---|
| Kdenlive 应用 | `/Applications/kdenlive.app/` |
| kdenlive 自带 CLI | `/Applications/kdenlive.app/Contents/MacOS/kdenlive`（仅打开/导入/渲染） |
| cli-anything-kdenlive | `/Users/mac/.local/bin/cli-anything-kdenlive`（有状态编辑） |

两套 CLI 关系：**cli-anything-kdenlive 是上层封装**（JSON 项目 → MLT XML），**自带 CLI 是底层渲染**。不冲突，互补使用。

## 快速开始

```bash
# 创建项目
cli-anything-kdenlive project new -o myproject.json

# 查看项目信息
cli-anything-kdenlive --json project info -p myproject.json

# 交互 REPL（有撤销/重做）
cli-anything-kdenlive

# 全部命令加 --json 给 agent 解析
```

## 命令速查（9 个组）

### Project（项目）
```bash
cli-anything-kdenlive project new -o project.json      # 新建
cli-anything-kdenlive project open -p project.json     # 打开
cli-anything-kdenlive project save -p project.json     # 保存
cli-anything-kdenlive project info -p project.json     # 信息
cli-anything-kdenlive project profiles                 # 视频配置列表
```

### Bin（素材箱）
```bash
cli-anything-kdenlive --project project.json bin import /path/to/video.mp4   # 导入
cli-anything-kdenlive --project project.json bin list                        # 列素材
cli-anything-kdenlive --project project.json bin get <clip-id>               # 详情
cli-anything-kdenlive --project project.json bin remove <clip-id>            # 移除
```

### Timeline（时间轴）
```bash
cli-anything-kdenlive --project project.json timeline add-track              # 加轨道
cli-anything-kdenlive --project project.json timeline remove-track <id>      # 删轨道
cli-anything-kdenlive --project project.json timeline add-clip <track> <clip-id> <start>  # 放片段
cli-anything-kdenlive --project project.json timeline trim <clip-ref> --in <t> --out <t>   # 裁剪
cli-anything-kdenlive --project project.json timeline split <clip-ref> <offset>            # 分割
cli-anything-kdenlive --project project.json timeline move <clip-ref> <new-pos>            # 移动
cli-anything-kdenlive --project project.json timeline list                   # 列表
```

### Filter（滤镜/特效）
```bash
cli-anything-kdenlive --project project.json filter available                # 可用滤镜
cli-anything-kdenlive --project project.json filter add <clip-ref> <filter>  # 加滤镜
cli-anything-kdenlive --project project.json filter set <clip-ref> <filter> <param>=<value>  # 设参
cli-anything-kdenlive --project project.json filter list <clip-ref>          # 已用滤镜
cli-anything-kdenlive --project project.json filter remove <clip-ref> <filter>  # 移除
```

### Transition（转场）
```bash
cli-anything-kdenlive --project project.json transition add <from-clip> <to-clip> <type>  # 加转场
cli-anything-kdenlive --project project.json transition list                 # 列表
cli-anything-kdenlive --project project.json transition set <id> <param>=<value>
```

### Guide（引导线/标记）
```bash
cli-anything-kdenlive --project project.json guide add <seconds>             # 加标记
cli-anything-kdenlive --project project.json guide list
```

### Export（导出/渲染）
```bash
cli-anything-kdenlive --project project.json export xml -o project.kdenlive  # 生成 MLT XML
cli-anything-kdenlive --project project.json export presets                  # 预设列表

# 用 kdenlive 自带 CLI 渲染（或 export render）
/Applications/kdenlive.app/Contents/MacOS/kdenlive --render --render-preset "MP4-H264/AAC" project.kdenlive output/final_v1.mp4
```

### Session（会话）
```bash
cli-anything-kdenlive --project project.json session status                  # 状态
cli-anything-kdenlive --project project.json session undo                    # 撤销
cli-anything-kdenlive --project project.json session redo                    # 重做
cli-anything-kdenlive --project project.json session history                 # 历史
```

## 典型工作流

```bash
# 1. 创建项目
cli-anything-kdenlive project new -o build/edit/project.json

# 2. 导入素材
cli-anything-kdenlive --project build/edit/project.json bin import raw/clip1.mp4
cli-anything-kdenlive --project build/edit/project.json bin import raw/clip2.mp4

# 3. 加两轨（视频轨 + 字幕轨）
cli-anything-kdenlive --project build/edit/project.json timeline add-track

# 4. 放片段
cli-anything-kdenlive --project build/edit/project.json timeline add-clip track1 clip1 0
cli-anything-kdenlive --project build/edit/project.json timeline add-clip track1 clip2 10

# 5. 转场
cli-anything-kdenlive --project build/edit/project.json transition add clip1 clip2 dissolve

# 6. 滤镜
cli-anything-kdenlive --project build/edit/project.json filter add clip1 "colorbalance"

# 7. 导出 XML → kdenlive 渲染
cli-anything-kdenlive --project build/edit/project.json export xml -o build/edit/project.kdenlive
/Applications/kdenlive.app/Contents/MacOS/kdenlive --render --render-preset "MP4-H264/AAC" build/edit/project.kdenlive output/final_v1.mp4
```

## 何时用 Kdenlive 而不是 FFmpeg

| 场景 | 选 |
|---|---|
| 裁剪/拼接/转码/滤镜单命令 | FFmpeg |
| 多轨、转场、精细时间轴、关键帧动画 | Kdenlive |
| 需要可继续编辑的工程文件 | Kdenlive（.kdenlive）|
| 批量简单处理 | FFmpeg |