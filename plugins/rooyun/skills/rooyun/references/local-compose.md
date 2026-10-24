# 本地拼接成片

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：用户要一条完整成片，且你决定用本机 ffmpeg 拼时

## 附：本地拼接成片

平台的成片合成跑在用户浏览器里，**API 拿不到**（见「做不到的」）。但每个镜头的视频
你都能下载，而你的环境里有原生 ffmpeg——自己拼一条成片是可行的，且比浏览器那份
wasm 快得多。下面这套参数与站内合成同口径，照着用产出一致。

**第一步：按镜序取件。** 用 `dj canvas structure` 拿到分镜/视频卡，按**组序 → 组内镜号**
两级升序排列（这正是站内的排序口径），每镜取它下游第一张已生成的视频卡，
再用 `download.mjs --asset <assetId>` 下载。**顺序错了成片就是乱的**，
不要按 `createdAt` 或返回顺序排。

**第二步：逐段统一转码。** 各镜可能来自不同模型，分辨率/帧率/编码不一致时
直接 concat 会花屏或音画不同步。先都转成同一规格：

```sh
# short=720 或 1080；长边按比例缩放并保证偶数像素
ffmpeg -i shot01.mp4 -vf "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'" \
  -r 30 -c:v libx264 -preset ultrafast -crf 23 -c:a aac -ar 44100 -ac 2 norm01.mp4
```

**第三步：拼接（零再编码）。**

```sh
printf "file 'norm01.mp4'\nfile 'norm02.mp4'\n" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy concat.mp4
```

**第四步：按声音模式混音。** 四种模式对应四条命令，别自由发挥——
「仅原声」尤其要注意：**不要走混音**，直接用上一步的产物，这样物理上不可能混进别的音轨。

| 模式 | 做法 |
|---|---|
| 仅视频原声 | `concat.mp4` **即成片**，不要再过一遍 ffmpeg |
| 静音 | `ffmpeg -i concat.mp4 -c:v copy -an out.mp4` |
| 原声 + 配乐 | BGM 循环铺满后与原声 `amix`，见下 |
| 旁白 + 配乐 | 先 `-an` 去掉原声，再把旁白与 BGM `amix` |

```sh
# 原声 + BGM（vol 取 0~1；-t 用成片时长收口，防 BGM 把片子拖长）
ffmpeg -i concat.mp4 -stream_loop -1 -i bgm.mp3 \
  -filter_complex "[1:a]volume=0.35,afade=t=in:st=0:d=1,afade=t=out:st=$((DUR-2)):d=2[b];[0:a][b]amix=inputs=2:duration=longest:normalize=0[mix]" \
  -map 0:v -map "[mix]" -c:v copy -c:a aac -t "$DUR" out.mp4
```

`normalize=0` 不能省：amix 默认会把各路响度按输入数缩小，省了会让原声整体变闷。

**字幕**：分镜表卡的导出按钮能出 SRT，你也可以按各镜时长自己累加时间轴生成。
外挂 `-c:s mov_text` 或烧录 `-vf subtitles=` 都行，**默认不要烧录**——
烧进画面就去不掉了，用户想要无字幕版就得整条重拼。

**交付前自己看一眼**：总时长是否等于各镜之和（差很多说明某镜没拼进去）、
有没有黑帧、声音有没有突然消失。这些用 `ffprobe -v error -show_entries format=duration`
核对比肉眼快。
