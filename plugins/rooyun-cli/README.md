# RooYun CLI（精简版 skill）

[RooYun](https://www.rooyun.com/?utm_source=github&utm_medium=plugin-readme) 的命令行工具箱：文生图、图生图、图生视频、首尾帧、参考图生视频、数字人口播、配音、音乐、音效、视频高清、视频转白模、上传素材、下载产物。提示词原样提交，先做什么、用哪个模型都由你决定。

- 第一次使用时，Agent 会运行 `dj.mjs login` 并打开浏览器，在 RooYun 页面点一次「授权」即可。
- 生成会消耗 RooYun 积分。每次生成前 Agent 会先报价，等你确认后才提交。
- 与 `rooyun` 二选一安装。

技能说明见 [skills/rooyun-cli/SKILL.md](skills/rooyun-cli/SKILL.md)。

## 安装

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun-cli@rooyun
```

Free-form RooYun toolbox for agents: text-to-image, image-to-video, first/last frame, reference video, talking avatar, voice-over, music, sound effects, upscaling and asset download. Your prompts are sent verbatim, and every paid generation is quoted first.

隐私政策：https://www.rooyun.com/privacy · 用户协议：https://www.rooyun.com/terms
