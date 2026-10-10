# 交付质检清单（QC Checklist）

出片前逐项检查，任何一项不通过都不要交付。

## 导出前检查（编辑阶段）

- [ ] 镜头表总时长 = 脚本/需求预期时长
- [ ] 素材入点/出点未越界
- [ ] 字幕无错别字、不遮挡平台按钮（底部留 120-180px）
- [ ] 隐私信息已处理（人脸/手机号/二维码/车牌）
- [ ] BGM 和人声不打架（人声最清晰）
- [ ] 封面第一眼能看懂主题

## 导出后技术检查

```bash
# 元数据检查：分辨率、时长、大小、编码、帧率
ffprobe -v error \
  -show_entries format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate \
  -of json output/final_v1.mp4
```

- [ ] 分辨率正确（如 1080×1920 / 1920×1080）
- [ ] 时长合理（无异常截断/拉长）
- [ ] 编码正确（平台要求 H.264 + AAC）
- [ ] 文件大小合理（码率不高不低）

```bash
# 抽帧检查画面（拼图快速看全片）
ffmpeg -y -hide_banner -loglevel error -i output/final_v1.mp4 \
  -vf "select='eq(n,30)+eq(n,900)+eq(n,1800)+eq(n,2700)',scale=270:480,tile=2x2" \
  -frames:v 1 build/edit/qc_frames/contact_sheet.jpg
```

- [ ] 画面无花屏/黑帧/绿帧
- [ ] 音画同步（口型对得上）

## 平台参数速查

| 平台 | 推荐规格 | 备注 |
|---|---|---|
| 抖音/视频号/小红书 | 1080×1920，H.264，30fps | 竖屏 9:16 |
| B 站 | 1920×1080 或更高，H.264，码率 ≤6000k | `ffmpeg_encode` bilibili-1080p 预设 |
| B 站 4K | 4K，码率 ≤20000k | bilibili-4k 预设 |
| 公众号/网页 | 720p 轻量 | web-720p 预设 |

`ffmpeg_encode` 内置预设：`bilibili-1080p` / `bilibili-4k` / `vertical-1080p` / `web-720p`，可覆盖 crf/fps/scale。

## 交付清单

- [ ] 最终成片：`output/final_vX.mp4`
- [ ] 封面：`output/cover.jpg`（需要时）
- [ ] 发布文案：`publish-copy.md`（标题/正文/标签，需要时）
- [ ] 工程文件（需要继续编辑时）：`.json` / `.kdenlive` / 剪映草稿目录
- [ ] 向用户报告：产物路径、参数、质检结果、下一步建议