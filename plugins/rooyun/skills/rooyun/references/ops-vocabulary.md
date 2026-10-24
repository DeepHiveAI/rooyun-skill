# ops 词表速查

> RooYun Skill 参考文档（从 SKILL.md 拆出）· 主文件：[SKILL.md](../SKILL.md)
> **何时读**：要写任何画布改动批次时；查 updateCard 能改哪些字段时

## ops 词表速查（13 个，每个一个最小可用例子）

`POST /api/v1/canvases/{canvasId}/ops`，请求体：

```json
{ "ops": [ /* 1–50 个 op，整批原子：任何一个不过，整批都不落盘 */ ] }
```

**默认不要给 `ifVersion`。** 不给，服务端在版本被推进时会自动「重读 → 重放」（最多 3 轮），
用户正开着画布编辑也照样写得进去；给了就关掉这层保护，一撞就 409 `version_mismatch`。
ops 是增量操作，重放到最新文档不会覆盖别人的改动——这正是它可以安全重放的原因。

只有一种情况该给：这批操作的正确性依赖于你**刚读到的那个状态**，且该前提不在服务端校验
范围内（服务端已兜住的不算，例如 `attachAsset` 目标卡非空会直接报 `card_not_empty`）。
这种「读—判断—写」事务宁可失败也不能重放，才用 `ifVersion`，取上一次响应的 `data.version`
（**别硬编码**——每批 +1，起点未必是 1，老画布可能已经几十版了）。

所有 `create*` 的落点可省略（服务端找空位），要指定就给 `params.position = {"x":0,"y":0}`。

```jsonc
// 1. createCard —— 通用卡（kind: text/image/video/audio/scene）
{ "op": "createCard", "params": { "kind": "text", "title": "场次说明", "content": "第一场：重逢" } }
//    kind:"video" 在**画布已有设定板**时会照常落卡、但结果带一条 noop 提示改用
//    createStoryboard kind:"video"（createCard 建的视频卡不连任何参考）。不拦截：
//    数字人口播、上传素材落卡是合法用法；落分镜视频卡则一律走 createStoryboard。

// 2. createCharacterBoard —— 角色设定板（自动成为 anchor，分镜会连过来）
{ "op": "createCharacterBoard", "params": { "name": "林小满", "description": "25 岁女主，短发，米色风衣" } }

// 3. createSceneSet —— 场景卡
{ "op": "createSceneSet", "params": { "name": "老城区天台", "description": "黄昏，晾衣绳，远处高架桥" } }

// 4. createPropBoard —— 道具板
{ "op": "createPropBoard", "params": { "name": "旧铜钥匙", "description": "布满绿锈的黄铜钥匙", "material": "黄铜", "era": "1990s" } }

// 5. createStoryboard —— 分镜（一个 shot 落一张卡，返回 N 个 nodeId；缺省落图卡）
{ "op": "createStoryboard", "params": { "shots": [{ "title": "镜1 推门", "prompt": "林小满推开天台铁门，逆光", "cast": ["林小满"] }] } }
//    kind:"video" 落分镜视频卡（站内「提取分镜」同款；分镜视频卡只能这样建，见纪律 10）：
{ "op": "createStoryboard", "params": { "kind": "video", "sceneName": "老城区天台", "layout": "grouped",
    "shots": [{ "title": "镜01-02", "prompt": "<segments[].videoPrompt>", "durationSec": 7, "audio": true, "cast": ["林小满"], "props": [] }] } }
//    带上 scriptNodeId（剧本文本卡 id）与段的 shotNoStart/shotCount，卡上才有站内同款 shotOf 与组名：
{ "op": "createStoryboard", "params": { "kind": "video", "scriptNodeId": "n_剧本卡id", "sceneName": "老城区天台", "layout": "grouped",
    "shots": [{ "title": "镜01-02", "prompt": "<segments[].videoPrompt>", "durationSec": 7, "audio": true, "cast": ["林小满"], "props": [], "shotNoStart": 1, "shotCount": 2 }] } }
//    ⚠️ 落整份分镜别自己拼这个批次：用 `dj storyboard-fall <canvasId> -f <storyboard响应.json> --script <剧本卡id>`
//    （按场次切批、空场景名兜底、超 30 段自动拆批，全在命令里）。等价的手写 jq 附在下面，
//    只在你的宿主拿不到 dj.mjs 时才用它——jq 写错的表现是静默断链（卡都在、就是没参考）：
//      printf '%s' "$SB" | jq -c --arg script "$SCRIPT_NODE" '.data.scenes[] | select(.segments | length > 0)
//        | {ops: [{op: "createStoryboard", params: {
//            kind: "video", layout: "grouped", scriptNodeId: $script,
//            sceneName: (if .name == "" then "未命名场景" else .name end),
//            shots: [.segments[] | {title, prompt: .videoPrompt, durationSec, audio, cast, props,
//                                   shotNoStart, shotCount: (.shotNoEnd - .shotNoStart + 1)}]}}]}' \
//      | while IFS= read -r BATCH; do
//          printf '%s' "$BATCH" | dj ops "$CANVAS" | jq -r '.data.results[0].noop // empty'
//        done

// 6. connectCards —— 连线（已存在会返回 noop，不重复创建）
{ "op": "connectCards", "params": { "sourceId": "n_c3d7d8de-1b77", "targetId": "n_ebeca6e7-bec0" } }

// 7. disconnectCards —— 断线（本就没这条线也返回 noop；可选 sourceHandle 只断该端口）
{ "op": "disconnectCards", "params": { "sourceId": "n_c3d7d8de-1b77", "targetId": "n_ebeca6e7-bec0" } }

// 8. updateCard —— 改卡（可改字段**按卡型**不同，见下面的字段表）
{ "op": "updateCard", "params": { "nodeId": "n_ebeca6e7-bec0", "prompt": "黄昏逆光，米色风衣" } }

// 9. attachAsset —— 把资产库里的产物绑到一张**空卡**上（产物只落资产库没落画布时用它）
{ "op": "attachAsset", "params": { "nodeId": "n_a19cb462-d5cd", "assetId": "3f9a…（64 位 hex）" } }

// 10. adoptVersion —— 同一张卡生成过多次时，换用其中一版（assetId 取自详读的 versions[]）
{ "op": "adoptVersion", "params": { "nodeId": "n_a19cb462-d5cd", "assetId": "7c2b…（64 位 hex）" } }

// 11. moveCard —— 挪动已有卡片（坐标系同读侧：组内卡是相对父的偏移）
{ "op": "moveCard", "params": { "nodeId": "n_a19cb462-d5cd", "position": { "x": 640, "y": -120 } } }

// 12. deleteCard —— 删卡
{ "op": "deleteCard", "params": { "nodeId": "n_a19cb462-d5cd" } }

// 13. autoLayout —— 自动布局（无参数，params 可以整个省掉）
{ "op": "autoLayout" }
```

**分镜表卡已下线**：`createShotTable` / `updateShotRow` / `insertShotRow` /
`deleteShotRow` 这四个 op 不再存在，发过去会被判 400。拆分镜一律用
`createStoryboard`（一镜一张图卡）；某一镜要改就 `updateCard` 改那张卡。

存量画布里已有的分镜表卡**仍然读得到**（`dj.mjs node` 出 `shots[]` 全部行），
可以照着它的内容用 `createStoryboard` 落成分镜图卡，但那张表本身不可再写。

### 参数上下界

> 数字口径：**字符串写的是字符数上限，数组写的是元素个数上限**。超界一律 400 `invalid_request`，
> 不会静默截断。

⚠️ **落卡上限 ≠ 生成上限**：`createStoryboard` 的 `shots[].prompt` 允许 8000 字，
但生成时提示词的硬闸是 **4000 字**——6000 字的分镜卡**落得进去、生成时才被 400 拒**，
而那时你已经把整批卡都建完了。分镜提示词写长了就先拆镜或精简，别等到出片那一步。
（服务端的提示词编译也按 4000 兜底：补段会顶破上限时它整段放弃，不会把你的请求撑爆。）

| op | 参数 |
|---|---|
| `createCard` | **必填** `kind`(text/image/video/audio/scene) + `title` 1–200；`content` ≤200000 · `audioMode`(voice/sfx/music，仅 audio) · `aspectRatio` ≤16 字符（仅 image） · `panorama`（720° 全景，画幅锁 2:1，会让 `aspectRatio` 失效） · `position` |
| `createCharacterBoard` | **必填** `name` 1–80 + `description` 1–4000；`age` ≤40 字符（是字符串，填「25 岁」而不是数字 25） · `identity` ≤120 字符 · `bio` ≤2000 字符 · `expressions` ≤6 项（每项 ≤40 字符） · `props` ≤20 项（每项 ≤120 字符） · `styleKeywords` ≤10 项（每项 ≤40 字符） · `position` |
| `createSceneSet` | **必填** `name` 1–80 + `description` 1–4000；`position` |
| `createPropBoard` | **必填** `name` 1–80 + `description` 1–4000；`material` ≤200 · `era` ≤80 · `wear` ≤200 · `usage` ≤200 · `exploded` · `scaleRef` ≤120 · `position` |
| `createStoryboard` | **必填** `shots` 1–30（每项必填 `title` 1–200 + `prompt` 1–8000；可选 `durationSec`、`audio`（仅 video 落卡）、`cast` ≤12 项、`props` ≤12 项、`shotNoStart` / `shotCount`（正整数，配合 `scriptNodeId` 写 `shotOf`，原样传 `segments[]` 的 `shotNoStart` 与 `shotNoEnd−shotNoStart+1`））；`kind`（`image` 缺省 / `video`）· `scriptNodeId` 1–120（**仅 video**，这批分镜所属的剧本文本卡 id；给了才写站内同款 `shotOf` 溯源锚并用站内格式起组名，不给站内会判「本剧本没拆过分镜」而重复落卡）· `sceneName` 1–80 + `layout`（`flat` 缺省 / `grouped`，需同时给 `sceneName`）· `aspectRatio`（整批统一，**缺省即全站默认 16:9**） |
| `connectCards` | **必填** `sourceId` + `targetId`（1–120 字符） |
| `disconnectCards` | **必填** `sourceId` + `targetId`（1–120 字符）；`sourceHandle` ≤120（只断该端口的边） |
| `updateCard` | **必填** `nodeId` + 至少一个补丁字段，**按卡型放行**，见下表 |
| `attachAsset` | **必填** `nodeId` + `assetId`（1–120 字符）。资产须是**你自己的云端资产**，大类与卡型一一对应（image→image 卡 / video→video 卡 / audio→audio 卡）；目标卡必须是空卡 |
| `moveCard` | **必填** `nodeId` + `position`。坐标系随该卡有没有 `parentId`（顶层=画布绝对坐标，组内=相对编组左上角）。**不改层级**（挪进编组范围不会自动入组）、**不做避让**（允许重叠）。用户锁过位置的卡报 `card_locked`，只能请他自己解锁 |
| `adoptVersion` | **必填** `nodeId` + `assetId`。只能切到**这张卡自己的**版本链里已有的那几版（assetId 取自详读的 `versions[]`）；不在链里报 `version_not_found`，已经是当前产物则返回 `noop` |
| `deleteCard` | **必填** `nodeId` |
| `autoLayout` | 无 |

### `updateCard` 可改哪些字段，取决于卡型（最容易踩的一处）

上面例子里的 `prompt` 只对图片卡和视频卡有效。拿它去改文本卡、或给视频卡发
`quality`，都会直接报错——**不适用的字段不会被静默忽略**。

| 卡型 | 可改字段 |
|---|---|
| 任意卡型 | `title` |
| `text` | `content` |
| `scene` | `description` |
| `image` | `prompt` · `aspectRatio` · `resolution`(**1k/2k/4k**) · `quality`(low/standard/high) · `seed` · `seedLocked` · `style`(`{id,name,prompt}`，传 `null` 摘掉) · `camera`(`{body,lens,focalMm,aperture}`，传 `null` 摘掉) |
| `video` | `prompt` · `aspectRatio` · `resolution`(**480p/720p/1080p/2k/4k**) · `durationSec`(0–600] · `audio` · `mode`(i2v/flf2v) · `lastFrameAssetId`(flf2v 尾帧，传空串 `""` 解绑) · `style` · `camera`（同图片卡） |
| `audio` mode=voice | `text` · `voiceId` · `voiceName` · `speed`(0.5–2) · `emotion`(9 档) · `emoVector`(8 个 [0,1]，传 `null` 清掉) · `emoAlpha`(0–1) · `emotionSecondary`(次情绪，同 `emotion` 词表) · `emotionMix`(0–1，次情绪占比)——后四项只在情感向量模型（IndexTTS 2.5）上生效 |
| `audio` mode=sfx | `text` |
| `audio` mode=music | `musicStyle` · `lyrics` · `instrumental` |
| 其余（`audio` clone/dialogue、`script`、`group`、`hub`、`analyze`、`director`） | **仅 `title`** |

`aspectRatio` 两种卡通用：`auto` `1:1` `1:2` `2:1` `9:16` `16:9` `3:4` `4:3` `3:2`
`2:3` `5:4` `4:5` `21:9` `9:21`。

> **不传就是 `16:9`**（全站默认画幅，与画布上手工建卡一致）。竖屏要用户**明确说了**
> 才传 `9:16`——不要因为「短剧」这个词就自作主张改成竖屏。

> ⚠️ **`resolution` 是两套词表**：图片卡认 `1k/2k/4k`，视频卡认 `480p…4k`。
> 给视频卡发 `"1k"` 是 `invalid_field_value`。

**`style` / `camera` 是结构化对象**（不写进可见提示词，生成时隐式组装）：
子字段必须**齐全且非空**，缺一个或给空串都是 `invalid_field_value`；传 `null` 摘掉。
当前值用 `dj.mjs node` 读回来（在 `config` 里，形状可以原样写回去）——
**先读再改**，盲写会把用户挑好的风格冲掉。

**配音卡的情绪两套互斥**：写 `emoVector` 会把 `emotion` 置回「自动」，写 `emotion` 会清掉
`emoVector`；同一补丁同时给 `emotion` 和非空 `emoVector` 是 `invalid_field_value`。
`emotion` 传 null = 置回「自动」；`emoVector` 不能与 `emotionSecondary` / `emotionMix` 同批写（次情绪只配合预设情绪生效）→ `invalid_field_value`。
维度序固定 `[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]`。
读回：`emoAlpha` / `emotionSecondary` / `emotionMix` 在 `dj.mjs node` 的 `params` 里，向量在 `config.emoVector`。

**`lastFrameAssetId`（视频卡 flf2v 尾帧）与 `attachAsset` 共用同一道资产闸**：
assetId 必须属于你这枚令牌的账号、且已在云端，否则 op 级 `asset_not_found`
（不区分「id 错了」「不是你的」「只在某台设备本地」）。尾帧只能引用**图片**资产，
类型不符是 `asset_kind_mismatch`。

两条行为契约（都是刻意的显式失败）：

- 字段**不适用于该卡型**（含补丁为空）→ op 级 `no_applicable_fields`；
- 取值**不在该卡型词表内**或类型不符 → op 级 `invalid_field_value`
  （`aspectRatio` 单独走 `invalid_aspect_ratio`）。

两者的 `message` 都会列出「该卡能改什么 / 该字段合法取值」，照着改即可。
拿不准就先 `dj.mjs node <canvasId> <nodeId> --pretty` 看它的可改参数——
**读回来的字段集就是写得进去的字段集**。

生成任务状态、产物引用与计费字段（`status` / `progress` / `assetId` / `src` /
`taskId` / `costLabel` 等）由服务端独占维护，发过来会被直接剥掉，不会写进卡片。

### 两条必须知道的规矩

1. **要引用刚建的卡，给它起个名字**（`clientRef`）。节点 id 由服务端生成，发请求时你没有它，
   但可以在建卡时写 `"clientRef": "@hero"`，同批**后面**的 op 就用 `@hero` 当 nodeId：

   ```jsonc
   {"ops": [
     {"op":"createCharacterBoard","params":{"name":"林小满","description":"…","clientRef":"@hero"}},
     {"op":"createCard","params":{"kind":"image","title":"海报草图","clientRef":"@poster"}},
     {"op":"connectCards","params":{"sourceId":"@hero","targetId":"@poster"}}
   ]}
   ```

   名字形如 `@name`（@ 后 1–40 位字母/数字/下划线/连字符）；**只能向前引用**；同批不可重名；
   引用不存在的名字直接失败（`client_ref_not_found`，不会当字面 id 去查）。
   `createStoryboard` 不支持（一次落 N 张，指向不明确）——按它返回的 `nodeIds` 下标取。
   真实 nodeId 与 `@ref` 可在同一字段混用；不想用引用时，照旧从响应
   （`results[].nodeIds` / `createdNodeIds`）取真实 id 放到下一批也完全可以。
2. **整批原子**：一个 op 失败，整批回滚、零写入。逐 op 结果在 `meta.results` 里，
   `code` 取值：`target_not_found` / `invalid_aspect_ratio` / `no_applicable_fields` /
   `invalid_field_value` /
   `asset_not_found`（引用的资产不是你的、或没上云） /
   `asset_kind_mismatch`（资产大类与卡型不符） /
   `card_not_empty`（`attachAsset` 的目标卡已有产物/在途任务——新建一张再绑） /
   `card_locked`（`moveCard` 的目标卡被用户锁定了位置；API 解不开这把锁，
   请用户在浏览器里右键「解锁位置」） /
   `version_not_found`（`adoptVersion` 要切的版本不在这张卡上——先详读看 `versions[]`） /
   `invalid_connection` / `empty_value` /
   `client_ref_not_found`（`@ref` 没定义或定义在本 op 之后——检查拼写与顺序） /
   `client_ref_duplicate`（同一个 `@ref` 定义了两次） /
   `not_executed`（前序已失败，本 op 根本没跑）。
3. **`createSceneSet` ≠ `createCard kind:"scene"`**。前者建的是**场景设定板**（带
   `anchor.kind = "scene"`，会被分镜自动连参考边）——搭工程要的是它。后者是通用卡的一种
   卡型，不带身份锚、不参与自动连线。角色同理：角色设定板只能用 `createCharacterBoard`。

---

