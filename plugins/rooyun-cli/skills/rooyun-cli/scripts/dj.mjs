#!/usr/bin/env node
/**
 * dj.mjs · RooYun 开放 API v1 微型客户端
 *
 * 零依赖（只用 Node 内置模块），Node ≥ 18。设计给编程 Agent 用：
 * - 默认输出**服务端原始信封**（`{ok,data,error,meta}`）到 stdout，便于 jq / JSON.parse；
 * - 失败时 stdout 仍是完整信封（拿得到 `error.code` 做分支），stderr 给人读提示，退出码非零；
 * - `--pretty` 切人类可读摘要。
 *
 * 红线：令牌只从两处读——环境变量 `ROOYUN_API_TOKEN`（回退旧名 `DUANJU_API_TOKEN`）优先，
 * 其次是 `dj login` 写下的本机凭据文件 `~/.rooyun/credentials.json`（0600）；**任何路径都不打印令牌**
 * （包括错误提示、调试输出、重定向地址）。凭据文件只由 `dj login` / `dj logout` 读写。
 *
 * 本文件刻意与 download.mjs 各自独立（不共享 lib）：skill 脚本会被复制分发，
 * 单文件可独立运行的价值大于消除那几十行重复。
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir, hostname, platform, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { basename as pathBasename, dirname as pathDirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 常量与退出码
// ---------------------------------------------------------------------------

/** 未显式指定 --base / ROOYUN_API_BASE 时的默认站点 */
const DEFAULT_BASE = "https://www.rooyun.com";

/**
 * 本脚本所属的 skill 版本（由 `pnpm skill:generate` 从 SKILL.md 的 frontmatter 注入，**勿手改**）。
 *
 * 为什么要内嵌一份：Claude Code 用户装的是完整目录，同级有 SKILL.md 可读；
 * 而 Codex 等宿主常常**只拷 `scripts/`** 到项目里（README 就是这么教的），
 * 那种布局下读不到 SKILL.md——没有这份内嵌值，版本自报与更新提醒对他们完全失效，
 * 我们发的新纪律他们永远收不到通知。
 *
 * 它不是第二个真相源：生成脚本从 SKILL.md 派生写入，两处不一致时构建就红。
 */
const EMBEDDED_SKILL_VERSION = "1.44.0";

/**
 * 单次 HTTP 请求的**空闲**超时（毫秒）：两次收到字节之间允许的最大间隔，
 * 每收到一块响应体就重新计时。
 *
 * 2026-08-31 事故：这里原本是「总超时 120s」，而 `analyze/storyboard` 拆一集分镜
 * 实测 2–15 分钟——端点上线以来 2 次调用 2 次被自己掐断（服务端全记 499）。
 * 服务端现在会在等待期周期性吐 JSON 合法的空白字节保活（见 json-heartbeat.ts），
 * 客户端的判据也必须跟着从「一共等了多久」改成「多久没动静」：
 * 卡死的连接照样在 120s 内失败，慢而健康的连接不再被误杀。
 */
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/**
 * 单次 HTTP 请求的总超时（毫秒）：心跳能保活，但不能无限等——
 * 服务端最慢的端点是拆分镜（15 分钟量级），取 15 分钟兜底。
 */
const DEFAULT_TOTAL_TIMEOUT_MS = 900_000;

/** --watch 轮询默认总超时（秒）：视频分钟级，30 分钟兜底 */
const DEFAULT_WATCH_TIMEOUT_S = 1800;

/** 轮询间隔下限（服务端建议 3s，见 API_V1 §5.4） */
const POLL_MIN_MS = 3000;
/** 博主分析的轮询间隔：GPU 队列以分钟计，打得再密也不会更快 */
const ANALYZE_POLL_MS = 15_000;
/** 被限流时的退避上限：比常规间隔更宽，否则「加倍退避」会被立刻钳回原值成为空操作 */
const ANALYZE_POLL_MAX_MS = 60_000;
/** 博主分析的默认等待上限：整条链最坏可达 30-60 分钟 */
const DEFAULT_ANALYZE_TIMEOUT_S = 3600;
/** 轮询间隔上限（长视频任务退避到 15s，避免高频空打） */
const POLL_MAX_MS = 15_000;
/** 每轮退避系数（在服务端建议值之上温和放大） */
const POLL_BACKOFF = 1.25;

/**
 * 退出码（稳定契约，脚本可据此分支）：
 *  0 成功 / 任务终态 succeeded
 *  1 用法或配置错误（缺令牌、参数不合法、命令不存在）
 *  2 API 返回业务错误（4xx/5xx，402/429 另有专码）；
 *    `canvas lint` 另用它表示「体检有 error 级 finding」——两者的处置一致：别往下走
 *    （请求本身成功，报告照常打在 stdout 上）
 *  3 402：余额不足或令牌限额用尽（按 error.code 区分处置）
 *  4 429：触发限流或下载配额
 *  5 网络/传输层失败（连不上、超时、响应不是 JSON）
 *  6 --watch 等待超时（任务仍在跑，不代表失败）
 *  7 任务已终态但不是 succeeded（failed / canceled）
 */
const EXIT = {
  ok: 0,
  usage: 1,
  apiError: 2,
  payment: 3,
  rateLimited: 4,
  network: 5,
  watchTimeout: 6,
  taskNotSucceeded: 7,
};

const CAPABILITIES = [
  "t2i",
  "i2i",
  "i2v",
  "flf2v",
  "ref2v",
  // 数字人口播：只有数字人模型出这个词，且它们不出 i2v/flf2v
  "avatar",
  "t2a",
  "music",
  "sfx",
  "upscale",
  // 视频抽音轨：定嗓样本提取（试镜片 → 人声轨）
  "v2a",
  // 视频转白模：原片 → 深度粘土灰模，产物当 ref2v 的参考视频用（--reference-video）
  "blockout",
];

/** 结构化提取的三种类型（POST /v1/analyze/extract 的 kind） */
const EXTRACT_KINDS = ["characters", "scenes", "props"];

/** 文本加工的四种形态（POST /v1/analyze/rewrite 的 mode） */
const REWRITE_MODES = ["edit", "optimize", "translate", "lyrics"];

/** 反推的两种素材形态（POST /v1/analyze/caption 的 kind） */
const CAPTION_KINDS = ["image", "video"];

/** 一批 createStoryboard 的 shots 上限（与服务端 schema 同口径，超了整批 400） */
const STORYBOARD_MAX_SHOTS = 30;
/** 场景名上限（服务端 sceneName max 80）与空名兜底 */
const SCENE_NAME_MAX = 80;
const FALLBACK_SCENE_NAME = "未命名场景";

/** 资产 id 形态：sha-256 的 64 位小写 hex（服务端同一口径，早拒省一次往返） */
const ASSET_ID_RE = /^[0-9a-f]{64}$/;

/**
 * 多轮会话一轮的素材预算（与服务端 `attachment-plan.ts` 逐字同口径）。
 * 客户端早拒是为了省一次白跑：服务端对超限的一轮是**整轮 400**，不会截断，
 * 而附件通常是几万字的正文，白发一次的代价是等一个来回外加限流预算。
 */
const MAX_TURN_ATTACHMENT_FILES = 3;
const MAX_TURN_ATTACHMENT_CHARS = 32_000;
/** 附件 + `@成果` 引用的**联合**预算（条数 / 总字符） */
const MAX_TURN_MATERIAL_ITEMS = 5;
const MAX_TURN_MATERIAL_CHARS = MAX_TURN_ATTACHMENT_FILES * MAX_TURN_ATTACHMENT_CHARS;

// ---------------------------------------------------------------------------
// 参数解析（极简：--key value / --flag / 位置参数）
// ---------------------------------------------------------------------------

/** 短标志别名（只留一个：读批次文件太高频，写全 --file 太啰嗦） */
const SHORT_FLAGS = { "-f": "file" };

/** 接受 `--key value` / `--flag` / `-f value`；`--` 之后全部当位置参数 */
function parseArgv(argv) {
  const positional = [];
  const flags = Object.create(null);
  let passthrough = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (passthrough) {
      positional.push(token);
      continue;
    }
    if (token === "--") {
      passthrough = true;
      continue;
    }
    if (SHORT_FLAGS[token]) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) fail(`${token} 需要一个值`);
      flags[SHORT_FLAGS[token]] = next;
      i += 1;
      continue;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positional, flags };
}

/** 取整数标志；缺省返回 fallback，非法直接报用法错误 */
function intFlag(flags, name, fallback) {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) fail(`--${name} 需要一个整数，收到：${raw}`);
  return parsed;
}

/** 用法错误统一出口：写 stderr + 退出码 1 */
function fail(message) {
  process.stderr.write(`dj: ${message}\n`);
  process.exit(EXIT.usage);
}

// ---------------------------------------------------------------------------
// 配置：令牌与基址（令牌全程只在内存中，不落任何输出）
// ---------------------------------------------------------------------------

/**
 * 本机凭据目录：三个系统同一相对位置（macOS/Linux `~/.rooyun/`，Windows `C:\\Users\\<你>\\.rooyun\\`）。
 * 文件按站点地址分桶，私有部署与官方站可以并存。
 */
const CREDENTIALS_DIR = pathJoin(homedir(), ".rooyun");
const CREDENTIALS_FILE = pathJoin(CREDENTIALS_DIR, "credentials.json");
/** `dj login` 两步之间的待决状态（device_code 是机密，同样 0600） */
const PENDING_LOGIN_FILE = pathJoin(CREDENTIALS_DIR, "pending-login.json");

/** 读 JSON 文件；不存在或损坏一律当空对象（凭据文件损坏 = 重新 login，不崩） */
function readJsonFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 写 JSON 文件：目录 0700、文件 0600（Windows 上 chmod 是空操作，家目录本身就是私有的） */
function writeJsonFile(file, value) {
  mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    // mode 只在新建时生效：目录/文件早已存在（如权限被人放宽过）也要收回来
    chmodSync(CREDENTIALS_DIR, 0o700);
    chmodSync(file, 0o600);
  } catch {
    // 已按 0700/0600 创建；chmod 失败（如 Windows）不影响正确性
  }
}

/** 凭据文件里当前站点的条目（token 明文只在这里被读出，随即进入内存、不再外泄） */
function credentialFor(base) {
  const all = readJsonFile(CREDENTIALS_FILE);
  const entry = all.tokens?.[base];
  return entry && typeof entry.token === "string" && entry.token.trim() ? entry : null;
}

/** 写入/覆盖当前站点的凭据（不可变：整份重建） */
function saveCredential(base, token, meta) {
  const all = readJsonFile(CREDENTIALS_FILE);
  writeJsonFile(CREDENTIALS_FILE, {
    version: 1,
    tokens: { ...(all.tokens ?? {}), [base]: { token, ...meta } },
  });
}

/** 删除当前站点的凭据；返回是否真删了东西 */
function removeCredential(base) {
  const all = readJsonFile(CREDENTIALS_FILE);
  if (!all.tokens?.[base]) return false;
  const { [base]: _dropped, ...rest } = all.tokens;
  void _dropped;
  writeJsonFile(CREDENTIALS_FILE, { version: 1, tokens: rest });
  return true;
}

/**
 * 取令牌：环境变量优先（CI / 密钥管理器注入的场景），其次本机凭据文件。
 * 返回 `{ token, source }`，source 供 doctor 报告「令牌从哪来」。
 */
function resolveToken(base) {
  const fromEnv = process.env.ROOYUN_API_TOKEN ?? process.env.DUANJU_API_TOKEN;
  if (fromEnv && fromEnv.trim()) return { token: fromEnv.trim(), source: "env" };
  const saved = credentialFor(base);
  if (saved) return { token: saved.token.trim(), source: "credentials" };
  return null;
}

function readToken(base) {
  const resolved = resolveToken(base);
  if (!resolved) {
    process.stderr.write(
      [
        "dj: 尚未登录。运行一次：",
        `    node ${skillScriptPath()} login`,
        "  它会打开浏览器让用户点「授权」，令牌自动保存到本机（~/.rooyun/credentials.json）。",
        "  也可以用环境变量 ROOYUN_API_TOKEN 注入；切勿把令牌写进代码、日志或对话。",
        "",
      ].join("\n"),
    );
    process.exit(EXIT.usage);
  }
  return resolved;
}

function readBase(flags) {
  // 回退旧名：改名前配好 DUANJU_API_BASE 的用户不用改环境变量
  const raw = flags.base || process.env.ROOYUN_API_BASE || process.env.DUANJU_API_BASE || DEFAULT_BASE;
  const base = String(raw).replace(/\/+$/, "");
  try {
    new URL(base);
  } catch {
    fail(`基址不是合法 URL：${base}`);
  }
  return base;
}

// ---------------------------------------------------------------------------
// HTTP：统一信封处理
// ---------------------------------------------------------------------------

/**
 * 逐块读完响应体，每收到一块就回调（用于重置空闲计时）。
 * 无 body 的响应（如 `redirect: manual` 下的 302）回落 `text()`。
 */
async function readBodyWithProgress(response, onProgress) {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onProgress();
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/**
 * 发一次请求，返回 `{ status, headers, envelope }`。
 * 传输层失败（DNS / 超时 / 非 JSON 响应）直接退出码 5——这类问题重试语义与业务错误不同。
 *
 * 超时是**双闸**：空闲闸（两次收到字节之间的间隔）+ 总闸。见 DEFAULT_IDLE_TIMEOUT_MS
 * 上的事故说明——单一总闸会把慢而健康的长任务判死。
 */
async function request(ctx, method, path, body) {
  const url = `${ctx.base}/api/v1${path}`;
  const headers = { authorization: `Bearer ${ctx.token}`, accept: "application/json" };
  // FormData 的 content-type 必须由 fetch 自己带（里面有 multipart 边界串），
  // 手写会让服务端解析不出文件字段；Content-Length 也由它按 Blob 大小自动算出
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";

  const controller = new AbortController();
  let expiry = null;
  let idleTimer;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      expiry = `空闲超过 ${Math.round(ctx.idleTimeoutMs / 1000)}s 无响应`;
      controller.abort();
    }, ctx.idleTimeoutMs);
  };
  const totalTimer = setTimeout(() => {
    expiry = `总耗时超过 ${Math.round(ctx.totalTimeoutMs / 1000)}s`;
    controller.abort();
  }, ctx.totalTimeoutMs);
  armIdle();

  let response;
  let text;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
    // 响应头到达也算「有动静」：接下来是等 body，重新起表
    armIdle();
    text = await readBodyWithProgress(response, armIdle);
  } catch (err) {
    // 注意：只回显 URL 与错误名，绝不回显请求头（内含令牌）
    const reason = expiry
      ? `TimeoutError: ${expiry}`
      : err instanceof Error
        ? `${err.name}: ${err.message}`
        : "unknown";
    process.stderr.write(`dj: 请求失败 ${method} ${url}\n    ${reason}\n`);
    process.exit(EXIT.network);
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }

  let envelope;
  try {
    // 服务端慢响应会在信封前垫 JSON 合法的空白字节保活（见 json-heartbeat.ts），
    // JSON.parse 本就忽略前导空白，这里无需特殊处理
    envelope = text ? JSON.parse(text) : null;
  } catch {
    process.stderr.write(
      `dj: 响应不是 JSON（HTTP ${response.status}）。检查 --base 是否指向 RooYun 站点：${ctx.base}\n`,
    );
    process.exit(EXIT.network);
  }
  // 顺带看一眼服务端带回的最新版本号（每条 v1 响应都带），落后就提醒一次
  noticeSkillUpdate(response.headers.get("x-skill-latest"), ctx.base);
  return { status: response.status, headers: response.headers, envelope };
}

/** 本进程是否已提醒过更新（一次运行只说一次，别把 stderr 刷满） */
let updateNoticed = false;

/**
 * 比对线上版本与本地装的版本，落后就在 stderr 说一句。
 *
 * 为什么由客户端比对：服务端不知道调用方装的是哪一版（裸 skill 目录没有任何
 * 上报机制），而本地版本就在同级的 SKILL.md frontmatter 里——它只需要被读一次。
 *
 * 为什么必须提醒：裸 skill 装完就是一个静态目录，Claude Code 只对 plugin 提供
 * 更新协议，对 skill 没有。不主动说，用户会一直用着旧版——我们新增的字段与
 * 工作流纪律对他全部不生效，而**双方都不会察觉**。
 *
 * 走 stderr 而不是 stdout：stdout 是给 jq / JSON.parse 的机器契约，混进人读文字会毁掉它。
 */
function noticeSkillUpdate(latest, base) {
  if (updateNoticed || !latest) return;
  const local = readLocalSkillMeta();
  if (!local || local.version === latest) return;
  updateNoticed = true;
  process.stderr.write(
    `dj: 本地 skill 是 v${local.version}，线上已是 v${latest}。` +
      `新版可能含新的字段与工作流纪律，旧版不会报错、只是用不到。\n` +
      `    更新：node ${skillScriptPath()} update --base ${base}\n`,
  );
}

/** 本脚本的绝对路径（提示更新命令时给出，用户不必自己找 skill 装在哪） */
function skillScriptPath() {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return "<skill目录>/scripts/dj.mjs";
  }
}

/** 针对特定错误码给出「下一步该做什么」的人读提示（写 stderr，不含令牌） */
function hintFor(status, code, meta) {
  switch (code) {
    case "insufficient_credits":
      // 纪律 12（视频）/ 纪律 14（图片）：别自己换模型或降档盲重试，把两条路摆给用户选
      return (
        `账户余额不足（需 ${meta?.need ?? "?"}，余 ${meta?.balance ?? "?"}）→ 把两条路摆给用户选：` +
        "A. 降规格后重新报价——视频换 MiniMax H3（dj models 里「MiniMax H3 ·」开头的对应能力行，" +
        "更便宜、赠送积分可用）；图片的默认 Qwen-Image-2.1 是按张固定价、降档一分钱也省不下来，" +
        "要降成本只能换模型（把 GPT Image 2.5 摆给用户选，别自己换）；" +
        "B. 去网页端充值。不要自行换模型/降档、不要换 requestId 盲重试。"
      );
    case "token_limit_exceeded":
      return `本令牌消费限额已用尽（限额 ${meta?.limit ?? "?"}，已用 ${meta?.spent ?? "?"}）→ 账户里可能还有钱，请用户去 /profile#api 调额度或换一枚令牌。切勿引导用户充值。`;
    case "rate_limited":
      return (
        "触发限流，退避后重试（提交生成 10/分/令牌、20/分/账号）。" +
        (typeof meta?.retryAfterSeconds === "number"
          ? `本次是下载端点的在途签名授权预算（512 MiB/令牌）被并发拉大件占满：等约 ${meta.retryAfterSeconds} 秒，或把并发下载数降下来。不是配额耗尽，别去换令牌。`
          : "")
      );
    case "download_quota_exceeded":
      return "当日下载字节配额耗尽（UTC 00:00 重置），换令牌或明日再试。";
    case "insufficient_scope":
      return "令牌缺少该端点要求的 scope，请用户新建一枚勾上对应权限的令牌。";
    case "token_revoked":
    case "token_expired":
    case "token_invalid":
      return "令牌不可用：运行 dj.mjs login 重新授权（用环境变量注入的则更新 ROOYUN_API_TOKEN）。";
    case "version_mismatch":
      return "ifVersion 与云端不符：多半是不该给它——去掉 --if-version 让服务端自动重读重放；确需条件写才重读 structure 拿新 version（别盲目重试）。";
    case "version_conflict":
      return "CAS 重试仍冲突（多半是用户正在浏览器里编辑）：重读 structure 后重试。";
    case "ops_failed":
      return (
        "整批已回滚、未做任何写入；看 meta.results 逐条定位。" +
        "若逐条码是 no_applicable_fields / invalid_field_value，说明字段或取值与该卡型不匹配" +
        "（updateCard 按卡型放行，图片卡与视频卡的 resolution 更是两套词表）：" +
        "用 `dj.mjs node <canvasId> <nodeId>` 看这张卡实际能改哪些参数，message 里也列了合法取值。" +
        "若逐条码是 asset_not_found，说明那个 assetId 不属于本令牌的账号、或从没上过云；" +
        "asset_kind_mismatch 是资产大类与卡型不符（image→image 卡）；" +
        "card_not_empty 是 attachAsset 的目标卡已有产物/版本链/在途任务——" +
        "覆盖会让原产物被资产回收误删，所以先 createCard 建一张空卡，下一批再绑；" +
        "version_not_found 是 adoptVersion 要切的那一版不在这张卡上——" +
        "先 `dj.mjs node <canvasId> <nodeId>` 看 versions[].assetId 到底有哪几个。"
      );
    case "length_required":
      return "上传必须带 Content-Length。用 dj.mjs upload 或标准 HTTP 客户端的文件上传，别用 chunked 传输。";
    case "payload_too_large":
      return "文件超过 50MB 上限，服务端不会截断受理半个文件——请压缩或分段后重传。";
    case "unsupported_media_type":
      return "不是 multipart，或文件类型不在白名单，或声明类型与文件内容不符（按魔数判定）。换一个受支持的文件重传（SVG 一律不受理）。";
    case "upload_quota_exceeded":
      return "当日上传字节配额（1 GiB/令牌）耗尽（UTC 00:00 重置），换令牌或明日再试。";
    case "node_not_found":
    case "canvas_busy":
      return "未提交任何任务，重试是安全的。";
    case "asset_not_in_cloud":
      return "资产没同步到云端（不是 id 错了）：请用户在原设备打开画布让它上传，或直接导出。";
    case "model_unsupported":
      return "模型不存在/不支持该能力：用 `dj.mjs models --capability <cap>` 重新选。带 params.mask 时还要求该模型支持局部重绘（吃参考图），不行就换一个图片模型；capability=avatar 只有数字人模型能干（它们也不出 i2v/flf2v）。";
    case "mask_unsupported":
      return "该模型所在渠道承载不了局部重绘蒙版（只有 OpenAI 兼容渠道有蒙版字段，其余图片渠道都没有）。换一个图片模型重试即可——素材本身没问题，别去查蒙版。";
    case "asset_unresolved":
      return "素材引用解析失败（不属于你 / 没上云 / 签名失败）：重试和换模型都没用，先确认这些 assetId 是本令牌账号下、且已同步到云端的资产。";
    case "creator_upstream_failed":
      return "抖音那边没取到。message 说「已封禁主页作品列表接口」时**重试无用**，改为点名 videoIds（纪律 15）；其余情形多是地址过期或临时频控，退避 1-2 分钟重试；连续失败就别再密集打了——那是全站共享的出口，打狠了大家一起被限。";
    case "archive_limit_reached":
      return "未过期的转存原片满了。**没有参数可改、重试也没用**——等最早的一份过了保留期名额自动回收，或先用已经转好的那些。";
    case "session_consumed":
      return "编辑会话已被用掉（用户已经提交过），撤销不了——改用 `dj.mjs edit-session status <sessionId>` 取回 result 里的蒙版继续流程。";
    case "reference_job_active":
      // 每账号 1 跑 + N 排队：队列满不是参数错误，等在跑的那条到终态再发
      return `拆解队列已满（在跑 1 条 + 排队 ${meta?.queued ?? "?"}/${meta?.maxQueued ?? "?"}）→ 用 \`dj.mjs reference-analysis ${meta?.activeJobId ?? "<jobId>"}\` 等在跑的那条到终态（5–15 分钟）再发；别换令牌绕、别当参数错误放弃`;
    case "conversation_busy":
      // 纪律 13：撞锁是「这个会话正忙」，不是「这轮失败了」——重发的是同一轮
      return (
        `会话被${meta?.lockedBy === "api" ? "另一次 API 调用" : "网页端（用户正开着同一段会话）"}` +
        `占用（lockedBy=${meta?.lockedBy ?? "?"}），等约 ${meta?.retryAfterSeconds ?? 15} 秒后` +
        "**用同一个 conversationId + 同一个 requestId 原样重发**。" +
        "别换会话重发、别新建会话、别并发再打一轮——这一轮还没扣钱，重发不会重复扣费。" +
        "（打的是 `chat delete` 的话：等这一轮跑完再删，重发一次删除即可。）"
      );
    case "agent_not_conversational":
      return "该 Agent 不支持多轮会话（编排型 Agent 要在画布里跑）。用 `dj.mjs agents` 挑 conversational=true 的那些，别换个 id 盲试。";
    case "agent_unknown":
      return "agentId 不在目录里、已下线，或这段会话没绑定 Agent。先 `dj.mjs agents` 抄准 id——会话建好后 Agent **不可改**，换 Agent = 新建一段会话。";
    case "turn_incomplete":
      return "这一轮跑完了却没能落库成消息（服务端两次落库都失败）。用**同一个 requestId** 重发一次即可（幂等，不会重复扣费）；仍失败就 `dj.mjs chat history <conversationId>` 看这段会话停在哪一 seq，再决定要不要重跑。";
    default:
      return status >= 500 ? "服务端错误，可退避后重试。" : "";
  }
}

/** 依据状态码与错误码定退出码 */
function exitCodeFor(status, code) {
  if (status === 402) return EXIT.payment;
  if (status === 429) return EXIT.rateLimited;
  if (code === "download_quota_exceeded") return EXIT.rateLimited;
  return EXIT.apiError;
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function emit(ctx, envelope, prettyRenderer) {
  if (ctx.pretty && prettyRenderer && envelope?.ok) {
    try {
      process.stdout.write(`${prettyRenderer(envelope.data, envelope.meta)}\n`);
      return;
    } catch {
      // 渲染器与契约不同步时不能吞数据：回落原始 JSON，宁可难看也不丢结果
      process.stderr.write("dj: --pretty 渲染失败（契约可能已变），回落原始 JSON\n");
    }
  }
  process.stdout.write(`${JSON.stringify(envelope, null, ctx.pretty ? 2 : 0)}\n`);
}

/**
 * 成功即输出并返回 data；失败则输出信封 + stderr 提示 + 退出。
 * 所有子命令都走这里，保证「错误形状恒定」。
 */
function handle(ctx, result, prettyRenderer) {
  const { status, envelope } = result;
  // 慢响应会被服务端降级成「HTTP 200 + 心跳流」，真实状态码落在 meta.httpStatus
  // （见服务端 json-heartbeat.ts）。判成败靠 envelope.ok 本就不受影响，但提示文案与
  // 退出码必须读回真实码，否则 402/429 会被一律报成通用 API 错误。
  const realStatus = Number(envelope?.meta?.httpStatus) || status;
  if (realStatus >= 200 && realStatus < 300 && envelope?.ok) {
    emit(ctx, envelope, prettyRenderer);
    return envelope.data;
  }
  const code = envelope?.error?.code ?? `http_${realStatus}`;
  const message = envelope?.error?.message ?? "（响应无 error 字段）";
  process.stdout.write(`${JSON.stringify(envelope, null, ctx.pretty ? 2 : 0)}\n`);
  const hint = hintFor(realStatus, code, envelope?.meta);
  process.stderr.write(
    `dj: HTTP ${realStatus} ${code} — ${message}${hint ? `\n    → ${hint}` : ""}\n`,
  );
  process.exit(exitCodeFor(realStatus, code));
}

/** 读 `-f/--file` 或 stdin 的 JSON（两者都没有时报用法错误） */
async function readJsonInput(flags, what) {
  const file = flags.file; // `-f` 已在 parseArgv 里归一到 file
  if (typeof file === "string") {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      fail(`读取 ${file} 失败：${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  if (process.stdin.isTTY) {
    fail(`缺少 ${what}：用 --file <path> 或从 stdin 传 JSON`);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) fail(`stdin 为空，期待 ${what} 的 JSON`);
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`stdin 不是合法 JSON：${err instanceof Error ? err.message : "unknown"}`);
  }
}

/**
 * 读**纯文本**素材（剧本 / 圣经 / 待改写的正文）。
 *
 * 与 `readJsonInput` 分开是刻意的：剧本是一大段中文正文，逼调用方先转义成 JSON
 * 字符串纯属自找麻烦（换行、引号、全角标点都要转），而这一步出错的表现是
 * 「JSON 解析失败」，与内容本身毫无关系，最难自查。
 *
 * 取值优先级：`--script <path>`（或指定的 flag）→ stdin。两者都没有即用法错误。
 */
async function readTextInput(flags, flagName, what) {
  const file = flags[flagName];
  if (typeof file === "string") {
    try {
      return readFileSync(file, "utf8");
    } catch (err) {
      fail(`读取 ${file} 失败：${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  if (process.stdin.isTTY) {
    fail(`缺少${what}：用 --${flagName} <path> 或从 stdin 传入正文`);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) fail(`stdin 为空，期待${what}`);
  return text;
}

/** 逗号分隔列表 → 去空白去空项的数组；未提供返回 undefined */
function listFlag(flags, name) {
  const raw = flags[name];
  if (typeof raw !== "string") return undefined;
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** 校验一组 assetId 形态（不合法早拒，省一次白跑的往返） */
function assertAssetIds(ids, what) {
  for (const id of ids) {
    if (!ASSET_ID_RE.test(id)) {
      fail(
        `${what} 不是合法 assetId（应为 64 位小写 hex）：${id}。` +
          "本地文件请先用 `dj.mjs upload <path>` 换成 assetId——素材不收路径也不收 URL。",
      );
    }
  }
  return ids;
}

function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === true) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// pretty 渲染器（只覆盖高频命令，其余回落 JSON）
// ---------------------------------------------------------------------------

/**
 * `meta.resolvedReferences`（服务端按画布边自动填入的参考）渲染成若干行。
 * 没有这个键 = 本次没有自动填入（你自己传了参考，或画布上压根没连），返回空数组。
 */
function renderResolvedReferences(resolved) {
  if (!resolved || !Array.isArray(resolved.references)) return [];
  const lines = [
    `自动解析参考（来源 ${resolved.source}）${resolved.truncated ? "　⚠ 超 9 张已截断" : ""}`,
  ];
  for (const [i, ref] of resolved.references.entries()) {
    const from = ref.sourceNodeId ? `node ${ref.sourceNodeId}` : "资产库成员";
    lines.push(
      `  <Picture ${i + 1}> ${ref.label ?? "(无名)"}　${ref.via}　${from}　${ref.assetId}`,
    );
  }
  if (resolved.firstFrame) {
    lines.push(`  首帧 ${resolved.firstFrame.assetId}`);
  }
  lines.push("  ↑ 逐条核对是不是你预期的设定板；对不上先改边再生成，别把这一单跑完。");
  return lines;
}

/**
 * 一段会话的元信息 → 若干行（`chat new` / `chat show` 共用一份，两处形状不会漂移）。
 * 计费那一行就是**发轮前的报价**：服务端已经把 `stagesPerTurn × 单轮单价` 乘好了
 * （`meta.estimatedTurnCredits`），照着念给用户即可，不必自己算（纪律 13）。
 */
function renderConversationBlock(conversation, meta) {
  return [
    `会话    ${conversation.conversationId}`,
    `Agent   ${conversation.agentId ?? "(未绑定)"}　模型 ${conversation.modelId ?? "(未定)"}`,
    `标题    ${conversation.title}　种类 ${conversation.kind}　来源 ${conversation.createdVia}`,
    `进度    lastSeq ${conversation.lastSeq}　更新于 ${conversation.updatedAt}`,
    renderConversationQuote(meta),
  ].filter(Boolean);
}

/**
 * 一轮的报价行。
 *
 * `estimatedTurnCredits` 为 `null` = **这个模型未配价**，发轮会被服务端 503 拒——
 * 必须明说「提交会被拒」，否则「没有金额」会被读成「这轮免费」，
 * 于是报价被跳过、发轮直接撞墙（纪律 1 没有例外）。
 */
function renderConversationQuote(meta) {
  if (typeof meta?.stagesPerTurn !== "number") return "";
  const stages = `一轮 ${meta.stagesPerTurn} 个计费阶段（unit=${meta.billingUnit ?? "per_round"}）`;
  if (typeof meta.estimatedTurnCredits === "number") {
    const unitPrice =
      typeof meta.perRoundCredits === "number" ? `${meta.perRoundCredits} 积分` : "?";
    return (
      `计费    预计一轮 ${meta.estimatedTurnCredits} 积分` +
      `（${meta.stagesPerTurn} 阶段 × 单价 ${unitPrice}）` +
      "——发轮前把这个数报给用户并等确认（纪律 13）"
    );
  }
  return (
    `计费    ${stages}；**该模型未配价，提交会被拒**` +
    "（这不是免费，也不是余额问题）——换个模型或找管理员补配价格"
  );
}

/** 会话清单里的一行 */
function renderConversationLine(conversation) {
  return (
    `${conversation.conversationId}　${conversation.agentId ?? "(未绑定)"}　` +
    `seq ${conversation.lastSeq}　[${conversation.createdVia}]　${conversation.title}　${conversation.updatedAt}`
  );
}

/**
 * 一轮的产物 → 若干行：**逐稿打全文**。
 * 刻意不截断：稿件正文就是这一轮花钱买到的东西，摘要化等于逼调用方再取一次。
 */
function renderTurnArtifacts(artifacts) {
  const lines = [];
  for (const artifact of artifacts ?? []) {
    lines.push(
      `产物　${artifact.kind}` +
        `${artifact.phase ? `　阶段 ${artifact.phase}` : ""}` +
        `${artifact.roundId ? `　轮 ${artifact.roundId}` : ""}` +
        `${artifact.artifactId ? `　artifactId ${artifact.artifactId}` : ""}`,
    );
    if (artifact.summary) lines.push(`  摘要　${artifact.summary}`);
    if (artifact.error) lines.push(`  ⚠ ${artifact.error}`);
    for (const variant of artifact.variants ?? []) {
      lines.push(`  ── 稿 ${variant.variantId}　artifactId ${variant.artifactId}`);
      lines.push(
        variant.text
          ? variant.text.split("\n").map((line) => `     ${line}`).join("\n")
          : "     （正文暂时读不到：用 `dj.mjs chat history` 重取，别重跑一轮——重跑是再付一次钱）",
      );
    }
  }
  return lines;
}

/**
 * 一轮的计费说明。
 * 产物型 Agent 的 `credits` 恒为 null（服务端多阶段各自扣分，门面拿不到聚合数字），
 * 这时**必须明说**，否则「没有金额」会被读成「这轮免费」。
 */
function renderTurnCredits(data, meta) {
  if (meta?.replayed) {
    return "计费　幂等重放：这就是上一轮的原始结果，本次**未扣费**";
  }
  if (data.credits) {
    return (
      `计费　实扣 ${data.credits.charged} 积分` +
      `${data.credits.refunded ? `（已退 ${data.credits.refunded}）` : ""}`
    );
  }
  return (
    `计费　本轮 ${meta?.stagesPerTurn ?? "多"} 个阶段各自扣分，门面拿不到聚合金额——` +
    "精确金额看 `dj.mjs ledger`（**不是免费**）"
  );
}

/**
 * `skippedVideoIds[].reason` → 人话（与服务端 describeRejections 同款）。
 * pretty 模式是给人读的，只打机器码等于让人再去翻一次文档。
 */
const SKIP_REASON_LABEL = {
  unresolvable: "解析失败，已删除/私密或被风控",
  not_analyzable: "时长不在 0–600 秒",
  note: "图文笔记，无播放轨",
  timeout: "本次没解析完，稍后重新点名即可",
  throttled: "解析通道限流未放行，稍后重新点名即可",
  foreign_creator: "作者不是这个博主，已排除",
};

const pretty = {
  me: (d) =>
    [
      `用户    ${d.userId}`,
      `令牌名  ${d.name}`,
      `权限    ${d.scopes.join(", ")}`,
      `有效期  ${d.expiresAt ?? "长期有效"}`,
      `限额    ${d.spendLimitCredits ?? "未设限"}（已用 ${d.spentCredits}）`,
    ].join("\n"),
  creatorResolve: (d) =>
    d.kind === "creator"
      ? [
          `博主  ${d.creator.nickname || "（无名）"}`,
          `sec_uid  ${d.creator.secUid}`,
          `粉丝 ${d.creator.followerCount}　作品 ${d.creator.videoCount}`,
          "",
          // 列表拉不到时**不要只打一串空**：这不是「这个博主没作品」，
          // 而是上游封锁。把下一步动作直接写出来（纪律 15）
          ...(d.videoListUnavailable
            ? [
                `⚠️ 拿不到作品列表：${d.videoListUnavailable.message}`,
                "",
                "下一步：向用户要 ≥2 条单条视频链接，逐条 `dj.mjs creator-resolve <链接>` 取 videoId，",
                `再 \`dj.mjs creator-analyze ${d.creator.secUid} <videoId> <videoId> …\``,
              ]
            : [
                ...d.videos
                  .slice(0, 20)
                  .map(
                    (v) =>
                      `${v.videoId}  ${v.durationSec}s  赞${v.statistics?.diggCount ?? 0}  ${v.title}`,
                  ),
                d.videos.length > 20 ? `…共 ${d.videos.length} 条` : "",
              ]),
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `视频  ${d.video.title}`,
          `videoId  ${d.video.videoId}`,
          `作者 ${d.video.authorName}　时长 ${d.video.durationSec}s`,
        ].join("\n"),
  creatorProfile: (d) =>
    [
      `博主  ${d.nickname}（${d.secUid}）`,
      `新鲜度  ${d.freshness === "fresh" ? "新鲜" : "已过保鲜期（数据仍可用，可考虑重新分析）"}`,
      `归纳于  ${d.analyzedAt}　样本 ${d.sampleVideoIds.length} 条`,
      "",
      `赛道    ${d.report.track}`,
      `受众    ${d.report.targetAudience}`,
      `一句话  ${d.report.summary}`,
      "",
      `【仿写提示词】\n${d.report.stylePrompt}`,
      "",
      `【复现指南】\n${d.report.replicationGuide}`,
      d.report.titleFormula ? `\n【标题公式】\n${d.report.titleFormula}` : "",
      "",
      `样本 videoId：${d.sampleVideoIds.join(" ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  creatorReport: (d) =>
    [
      `videoId  ${d.videoId}`,
      `一句话   ${d.report.summary}`,
      `钩子     ${d.report.hookText}`,
      `叙事     ${d.report.narrativeStructure}`,
      "",
      `【转写全文】\n${d.transcript || "（无口播）"}`,
    ].join("\n"),
  creatorAnalysisSubmitted: (d) =>
    [
      `任务  ${d.jobId}`,
      `状态  ${d.status}${d.deduplicated ? "（命中幂等，复用既有任务）" : ""}`,
      d.sampleVideoIds?.length ? `样本  ${d.sampleVideoIds.length} 条` : "",
      // 点名了却没进样本的必须显式打出来：不说 = 用户以为这几条也分析了
      d.skippedVideoIds?.length
        ? `跳过  ${d.skippedVideoIds.map((s) => `${s.videoId}（${SKIP_REASON_LABEL[s.reason] ?? s.reason}）`).join("、")}`
        : "",
      d.statusUrl ? `轮询  ${d.statusUrl}` : "",
      "",
      `查进度：dj.mjs creator-analysis ${d.jobId}`,
    ]
      .filter(Boolean)
      .join("\n"),
  creatorAnalysis: (d, meta) =>
    [
      `任务  ${d.jobId}`,
      `状态  ${d.status}${d.status === "partial" ? "（逐条报告已可读，只是没出账号画像——不是失败）" : ""}`,
      d.error ? `说明  ${d.error}` : "",
      "",
      ...(d.videos ?? []).map((v) => {
        const stage = v.gpuStage ?? v.failedStage;
        // failedCode 与阶段并列显示：同一个 analysis 阶段下「上游 5xx / key 失效 /
        // 被限流」是三种不同处置，只印阶段等于让人再去翻文档
        const code = v.failedCode ? `/${v.failedCode}` : "";
        return `${v.videoId}  ${v.phase}${stage ? `(${stage}${code})` : ""}${v.error ? `  ${v.error}` : ""}`;
      }),
      "",
      `已出报告 ${d.succeededVideoIds?.length ?? 0}/${meta?.total ?? d.videos?.length ?? 0} 条`,
      d.succeededVideoIds?.length
        ? `→ 逐条读：dj.mjs creator-report ${d.secUid} <videoId>`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  referenceSubmitted: (d) =>
    [
      `任务  ${d.jobId}`,
      `状态  ${d.status}${d.deduplicated ? "（命中幂等，复用既有任务）" : ""}`,
      d.videoId ? `视频  ${d.videoId}` : "",
      d.statusUrl ? `轮询  ${d.statusUrl}` : "",
      "",
      `查进度：dj.mjs reference-analysis ${d.jobId}`,
    ]
      .filter(Boolean)
      .join("\n"),
  referenceCompare: (d) => {
    const c = d.comparison ?? {};
    const fs = c.functionSequence ?? {};
    const dropped = (c.preserveKept ?? []).filter((p) => p.status === "dropped").map((p) => p.dimension);
    return [
      `判定  ${c.verdict === "structure-kept" ? "结构保住了" : "⚠️ 结构跑偏"}（一致率 ${Math.round((fs.agreement ?? 0) * 100)}%，阈值 ${Math.round((c.agreementThreshold ?? 0) * 100)}%）`,
      `参考  ${(fs.reference ?? []).join(" ")}`,
      `成片  ${(fs.candidate ?? []).join(" ")}`,
      `对齐  ${(fs.aligned ?? []).join(" ")}`,
      fs.missing?.length ? `⚠️ 丢了  ${fs.missing.join("、")}（参考片有、成片一次都没出现）` : "",
      fs.extra?.length ? `多出  ${fs.extra.join("、")}` : "",
      dropped.length ? `⚠️ 必保维度没当回事  ${dropped.join("、")}` : "",
      `时长  ${c.durationSec?.reference}s → ${c.durationSec?.candidate}s · 段数 ${c.segmentCount?.reference} → ${c.segmentCount?.candidate}`,
      "",
      "> 它只比叙事结构，不比观感/画质。判定是提示不是门禁——成片仍要你亲自看完。",
    ]
      .filter(Boolean)
      .join("\n");
  },
  referenceTemplate: (d) => {
    const t = d.template ?? {};
    const pct = (x) => `${Math.round(x * 100)}%`;
    return [
      `样本  ${t.sampleCount} 条 · 平均 ${t.avgSegmentCount} 段 / ${t.avgDurationSec}s`,
      `骨架  ${(t.pattern ?? []).join(" → ")}`,
      `出现率  ${(t.steps ?? []).map((s) => `${s.function} ${pct(s.support)}`).join(" · ")}`,
      `组成  ${(t.functionMix ?? []).map((m) => `${m.function} ${pct(m.share)}`).join(" · ")}`,
      `必保共识  ${(t.preserveConsensus ?? []).map((p) => `${p.dimension} ${pct(p.rate)}`).join(" · ") || "（无）"}`,
      ...(d.skipped?.length ? ["", `⚠️ 跳过 ${d.skipped.length} 条：${d.skipped.map((s) => `${s.jobId}(${s.reason})`).join("、")}`] : []),
      "",
      "> 出现率 < 100% 的环节说明不是每条都有——那正是「这个赛道要不要硬带它」的依据。",
    ].join("\n");
  },
  referenceAdaptation: (d) => {
    const a = d.adaptation ?? {};
    const changed = Object.entries(a.changes ?? {})
      .filter(([, v]) => typeof v === "string" && v)
      .map(([k, v]) => `${k}→${v}`);
    const diag = d.diagnostics ?? {};
    const head = [
      `改编  ${a.adaptationId}${d.deduplicated ? "（命中幂等，未重复调用上游）" : ""}`,
      `变更  ${changed.join(" ｜ ") || "（无）"}`,
      `骨架  ${a.spine ?? ""}`,
      `段数  ${(a.segments ?? []).length}${a.conflictCount ? ` · ⚠️ ${a.conflictCount} 段命中「必保」未改` : ""}${
        diag.fallbackIndices?.length ? ` · ${diag.fallbackIndices.length} 段模型漏写已按原片兜底` : ""
      }`,
      // verdict=strained 是「别用这份产物」的信号，必须顶在最前面而不是埋进逐段标注
      ...(a.verdict === "strained"
        ? [
            "",
            "🛑 这条参考片撑不起本次诉求（verdict=strained）——产物会是自相矛盾的混合稿，别直接用：",
            ...(a.warnings ?? []).map((w) => `   ${w}`),
          ]
        : []),
      ...((a.dimensionOutcomes ?? []).length
        ? [
            "",
            "逐维度落点：" +
              (a.dimensionOutcomes ?? [])
                .map((o) => `${o.dimension} 换${o.appliedSegments}/拒${o.conflictSegments}（${Math.round(o.conflictRate * 100)}%）`)
                .join("  ｜  "),
          ]
        : []),
      "",
    ];
    const body = (a.segments ?? []).map((s) => {
      const conflict = s.conflicts?.length ? `  ⚠️未改[${s.conflicts.join(",")}]` : "";
      return `#${String(s.index).padStart(2)} ${String(s.function).padEnd(8)}${conflict}\n    台词  ${s.dialogue || "（无）"}\n    画面  ${s.visualBrief || "（待定）"}`;
    });
    return [...head, ...body].join("\n");
  },
  referenceAnalysis: (d) => {
    const head = [
      `任务  ${d.jobId}`,
      `视频  ${d.videoId}${d.title ? `  ${d.title}` : ""}`,
      `状态  ${d.status}  阶段 ${d.phase}${d.gpuStage ? `(${d.gpuStage})` : ""}${
        d.visualProgress ? `  画面层已完成 ${d.visualProgress.done} 镜` : ""
      }${d.structureAttempts ? `  结构层第 ${d.structureAttempts} 次` : ""}`,
      d.transcriptSource
        ? `转写  ${d.transcriptSource}${
            d.transcriptSource === "whisper" ? "（无时间戳：各镜 dialogue 为空，结构层看过全文）" : d.transcriptSource === "none" ? "（无人声）" : ""
          }`
        : "",
      d.failedStage ? `失败  ${d.failedStage}${d.failedCode ? `/${d.failedCode}` : ""}` : "",
      d.error ? `说明  ${d.error}` : "",
    ];
    const r = d.result;
    if (!r) return head.filter(Boolean).join("\n");
    const a = r.account;
    const diag = r.diagnostics ?? {};
    // 先打可信度与诊断再打内容：visual 空串是「无画面证据」不是缺陷，不先说清读者会当成失败去重跑
    const diagLines = [
      "",
      `骨架  ${a.spine}`,
      `镜头  ${a.segments.length} 镜${diag.rawShotCount && diag.rawShotCount !== a.segments.length ? `（合并前 ${diag.rawShotCount}）` : ""} · 无帧 ${diag.shotsWithoutFrames?.length ?? 0} · 画面层失败 ${diag.visualFailures?.length ?? 0} · 结构层漏段 ${diag.missingStructureIndices?.length ?? 0}${
        diag.structure?.degeneration?.flagged ? " · ⚠️ 后半段疑似敷衍" : ""
      }`,
      renderReliabilityLine(r.reliability),
      `功能序列  ${a.segments.map((s) => s.function).join(" ")}`,
      "",
    ];
    const segLines = a.segments.map((s) => {
      const t = `${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s`;
      const vis = s.visual ? s.visual : "（无画面证据）";
      return `#${String(s.index).padStart(2)} ${t.padEnd(12)} ${s.function.padEnd(8)} c=${s.confidence.toFixed(2)}\n    意图  ${s.intent}\n    画面  ${vis}${
        s.dialogue ? `\n    台词  ${s.dialogue}` : ""
      }${s.adaptable?.length || s.preserve?.length ? `\n    可换 [${(s.adaptable ?? []).join(",")}]  必保 [${(s.preserve ?? []).join(",")}]` : ""}`;
    });
    return [...head.filter(Boolean), ...diagLines, ...segLines].join("\n");
  },
  videoUrl: (d) => {
    const line = (v) =>
      `${v.videoId}  ${v.durationSec}s  赞${v.statistics?.diggCount ?? 0}  ${v.title}\n    ${v.playUrl ?? "（无直链）"}`;
    if (d.kind === "video") {
      return [
        line(d.video),
        "",
        `下载：curl -L --retry 3 -o ${d.video.videoId}.mp4 "<上面的直链>"`,
        "直链数周内失效，拿到就下；勿持久化、勿当长期地址分发。",
      ].join("\n");
    }
    if (d.videoListUnavailable) {
      return [
        `博主  ${d.creator.nickname || "（无名）"}　粉丝 ${d.creator.followerCount}　作品 ${d.creator.videoCount}`,
        `sec_uid  ${d.creator.secUid}`,
        "",
        `⚠️ 拿不到作品列表：${d.videoListUnavailable.message}`,
        "重试没用（上游封锁，不是故障）。请用户逐条「分享→复制链接」，再对每条链接跑一次 `dj.mjs video-url <链接>`。",
      ].join("\n");
    }
    return [
      `博主  ${d.creator.nickname || "（无名）"}　粉丝 ${d.creator.followerCount}　作品 ${d.creator.videoCount}`,
      `sec_uid  ${d.creator.secUid}`,
      `（游客态只开放最近 ${d.videos.length} 条；要更早的作品拿不到）`,
      "",
      ...d.videos.map(line),
      "",
      "挑要看的那几条下载：curl -L --retry 3 -o <videoId>.mp4 \"<直链>\"；连续下载间隔 2 秒，直链数周内失效。",
    ].join("\n");
  },
  creatorArchive: (d) =>
    [
      `videoId   ${d.videoId}`,
      `assetId   ${d.assetId}`,
      `大小      ${(d.sizeBytes / 1024 / 1024).toFixed(1)} MB　${d.mimeType}`,
      d.deduplicated ? "（之前已转存过，本次直接复用）" : "（本次新转存）",
      `保留至    ${d.expiresAt}`,
      "",
      `取文件：download.mjs --asset ${d.assetId} --out ./out`,
    ].join("\n"),
  models: (d) =>
    d.models
      .map(
        (m) =>
          `${m.id}  ${m.name}\n    能力 ${m.capabilities.join("/")}` +
          `　单价 ${m.pricing ? `${m.pricing.creditsPerUnit}/${m.pricing.unit}` : "未配价（提交必被拒）"}` +
          // 视频细粒度能力面：换模型前看这一行，时长/分辨率/参考上限对不上就是 400 或静默夹取
          (m.video
            ? `\n    视频 ${m.video.durationSec.min}-${m.video.durationSec.max}s` +
              `　分辨率 ${m.video.resolutions.length ? m.video.resolutions.join("/") : "未声明"}` +
              `　参考图${m.video.referenceImages} 视频${m.video.referenceVideos} 音频${m.video.referenceAudios}` +
              `　${m.video.audio ? "原生出声" : "无声"}`
            : "") +
          // 配音细粒度能力面：情绪控制各家互不通用，不打出来 Agent 只能按模型名猜
          // （缺席 = 两个都不吃，情绪只能走 emotion / styleText）
          (m.audio
            ? `\n    配音 情感向量 emoVector ${m.audio.emotionVector ? "✓" : "✗"}` +
              `　模型内变速 durationFactor ${m.audio.durationFactor ? "✓" : "✗"}`
            : "") +
          // 档位/取舍说明：同名多档模型（速度档/质量档）唯一的选档依据
          (m.description ? `\n    说明 ${m.description}` : ""),
      )
      .join("\n") || "（空）",
  // 注意：项目列表的数组键是 `projects`（资产是 items、账单是 entries、目录是 models），
  // 各端点键名不统一是既有契约，渲染器按端点各自取键，勿想当然套 items。
  projectList: (d, meta) =>
    `${d.projects
      .map((p) => `${p.id}  ${p.name}\n    canvas ${p.defaultCanvasId}　更新 ${p.updatedAt ?? "-"}`)
      .join("\n")}\n共 ${meta?.total ?? d.projects.length} 个项目`,
  created: (d) => `projectId ${d.projectId}\ncanvasId  ${d.canvasId}\n浏览器    ${d.url}`,
  canvasList: (d) =>
    [
      `项目 ${d.projectId}　共 ${d.canvases.length} 张画布`,
      ...d.canvases.map(
        (c) =>
          `  ${c.canvasId}  ${c.isDefault ? "[首画布]" : "[附加]  "} ${c.name}` +
          `　${c.url}`,
      ),
    ].join("\n"),
  // 体检报告按 severity 分组打印：error 先出且必须一眼看见——它的语义是「别提交生成」
  lint: (d) => {
    const errors = d.findings.filter((f) => f.severity === "error");
    const warnings = d.findings.filter((f) => f.severity === "warn");
    const render = (f) =>
      `  [${f.rule}] ${f.nodeTitle ?? f.nodeId ?? "-"}${f.names?.length ? `（${f.names.join("、")}）` : ""}\n      ${f.message}`;
    // 参考预演：<Picture i> 的编号照抄这里，别按生成回执猜（旧服务端没有这一位，防御式读）
    const previews = Array.isArray(d.references) ? d.references : [];
    const renderPreview = (p) =>
      [
        `  ${p.nodeTitle ?? p.nodeId}${p.truncated ? "　※ 参考超上限被截断" : ""}`,
        ...p.references.map(
          (r) => `      ${r.tag} = ${r.label ?? "（无标题）"}　[${r.via}]`,
        ),
      ].join("\n");
    return [
      `canvas ${d.canvasId}　version ${d.version}`,
      `error ${d.summary.errors}　warn ${d.summary.warnings}`,
      errors.length ? `\n【error｜别提交生成，先修完】\n${errors.map(render).join("\n")}` : "",
      warnings.length ? `\n【warn｜不阻断，但十有八九不是你要的】\n${warnings.map(render).join("\n")}` : "",
      previews.length
        ? `\n【参考预演｜提示词里的 <Picture i> 照抄这里的编号，顺序与提交时逐位一致】\n${previews.map(renderPreview).join("\n")}`
        : "",
      d.findings.length === 0 ? "\n✔ 没有发现结构缺口，可以去报价了。" : "",
      d.summary.errors > 0
        ? "\n※ 退出码 2：修完（补连线 / 补建设定板 / 先把板生成出来）后重跑，errors 归零再 precheck。"
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
  structure: (d) =>
    [
      `version ${d.version}　project ${d.projectId}　canvas ${d.canvasId}`,
      ...d.nodes.map(
        (n) =>
          `  ${n.id}  [${n.kind}] ${n.title}` +
          `${n.anchor ? `　锚点 ${n.anchor.kind}:${n.anchor.name}` : ""}` +
          `${n.hasAsset ? `　产物 ${n.assetIds.join(",")}` : ""}`,
      ),
      ...d.edges.map((e) => `  ${e.source} → ${e.target}`),
      `共 ${d.nodes.length} 卡 / ${d.edges.length} 连线`,
    ].join("\n"),
  ops: (d) =>
    [
      `version → ${d.version}`,
      ...d.results.map(
        (r) =>
          `  [${r.index}] ${r.op} ${r.ok ? "ok" : `失败 ${r.code}`}` +
          `${r.nodeIds?.length ? ` → ${r.nodeIds.join(", ")}` : ""}` +
          `${r.noop ? `（${r.noop}）` : ""}${r.message && !r.ok ? `：${r.message}` : ""}`,
      ),
      `新建 ${d.createdNodeIds.length} 卡，删除 ${d.deletedNodeIds.length} 卡`,
    ].join("\n"),
  precheck: (d) =>
    [
      `计费 ${d.enabled ? "已启用" : "未启用"}`,
      // 报「可用」用 available（含赠送积分能承担的部分），balance 只是充值积分（纪律 1）
      `合计 ${d.total} 积分　可用 ${d.available ?? d.balance} 积分（充值余额 ${d.balance}）　整批可执行 ${d.ok ? "是" : "否"}`,
      ...d.items.map(
        (it, i) => `  [${i}] ${it.priced ? `${it.credits} 积分` : "未配价（提交必被拒）"}`,
      ),
      "※ 这是体验层报价，不是扣费承诺。请把合计报给用户并等确认后再提交。",
      // 纪律 12：各项都配了价却整批跑不动 = 余额不够（常见于只有不覆盖该模型的赠送积分）
      !d.ok && d.items.every((it) => it.priced)
        ? "※ 可用积分不够这一批：别自己换模型/降档——把两条路摆给用户选：A. 降规格重新报价（视频换 MiniMax H3；图片的默认 Qwen-Image-2.1 按张固定价、降档省不下钱，要省只能换 GPT Image 2.5）/ B. 去网页端充值。"
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  submitted: (d, meta) =>
    [
      `taskId ${d.taskId}　status ${d.status}`,
      d.nodeId
        ? `定向落卡 canvas ${d.canvasId} node ${d.nodeId}`
        : "未定向：产物只进资产库",
      // 服务端按画布边自动填入的参考：**逐条核对**是不是你预期的那几块设定板，
      // 对不上说明画布连线不是你以为的样子（先改边，别把这一单跑完）
      ...renderResolvedReferences(meta?.resolvedReferences),
      // 平台补了哪几段提示词（没有这一位 = 一个字都没动）。不打出来的话，用 --pretty
      // 的调用方根本不知道下发上游的提示词已经不是自己写的那一串
      meta?.promptCompile?.applied?.length
        ? `提示词编译　平台补了：${meta.promptCompile.applied.join(" / ")}` +
          `（要逐字可控就传 params.promptCompile="off"）`
        : "",
      // 引用漏连告警：提交照常成立，但「提示词点了名却没连参考」必须让人看见——
      // 埋在原始 JSON 的 meta.warnings 里等于没报（没人会想到去 jq 它）
      meta?.warnings?.length
        ? `⚠ 告警（不阻断，但极可能不是你要的结果）\n  ${meta.warnings.join("\n  ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  // 列表只给库里的快照：一行一条，把「拿它和自己的记录对上号」需要的三个锚点
  // （requestId / 落卡目标 / 产物）摆在同一行
  tasks: (d, meta) =>
    [
      `共 ${meta?.total ?? d.tasks.length} 条（本页 ${d.tasks.length}）`,
      ...d.tasks.map((t) => {
        const where = t.canvasId ? `${t.canvasId}/${t.nodeId}` : "未定向";
        const extra = [
          t.requestId ? `req ${t.requestId}` : "",
          t.assetId ? `产物 ${t.assetId.slice(0, 12)}…` : "",
        ]
          .filter(Boolean)
          .join("　");
        return `  ${t.status.padEnd(9)} ${t.capability ?? "-"}　${t.taskId}\n      ${where}　${t.createdAt}${extra ? `\n      ${extra}` : ""}`;
      }),
      d.tasks.length === 0
        ? "\n（没有在途任务。要看历史加 --status all）"
        : "\n※ status 是库里的快照，不是刚查的上游状态——要准确状态跑 dj task <taskId>",
    ]
      .filter(Boolean)
      .join("\n"),
  task: (d, meta) =>
    [
      `taskId ${d.taskId}　status ${d.status}` +
        `${typeof d.progress === "number" ? `　进度 ${d.progress}%` : ""}`,
      `能力 ${d.capability ?? "-"}　落卡 ${d.landedTo ?? "-"}`,
      d.assetId ? `产物 ${d.assetId}` : "",
      d.error ? `失败原因 ${d.error}` : "",
      // 纪律 12：终态失败已退款，但下一步不能是静默换模型或换 requestId 盲重试
      d.status === "failed"
        ? "※ 这一笔没扣钱。把两条路摆给用户选：A. 降规格重新报价再提交（视频换 MiniMax H3；图片换 GPT Image 2.5——默认的 Qwen-Image-2.1 按张固定价，降档省不下钱）/ B. 充值后继续用当前模型重试（新 requestId、重新报价）。别自行换模型/降档。"
        : "",
      typeof meta?.pollAfterMs === "number" ? `建议下次轮询间隔 ${meta.pollAfterMs}ms` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  cancel: (d) =>
    `taskId ${d.taskId}　status ${d.status}\n` +
    `真停住 ${d.stopped ? "是（冻结积分已全额退回）" : "否"}　已记录取消意向 ${d.cancelRequested ? "是" : "否"}`,
  // 明文令牌就在 url 里：原样打出来是为了让你转述给用户，**转述完就别再复述**
  editSessionCreated: (d) =>
    [
      `sessionId ${d.sessionId}　status ${d.status}`,
      `链接（等同凭据，只发给用户本人）  ${d.url}`,
      `有效期至  ${d.expiresAt}　← **必须和链接一起告诉用户**`,
      `源图      ${d.sourceAssetId}（服务端从卡上读的当前产物，对不上说明 nodeId 给错了）`,
      `目标      canvas ${d.canvasId} node ${d.nodeId}　能力 ${d.capability}`,
      "※ 现在去做别的事，下一轮再 `edit-session status` 查——别阻塞死等（纪律 9）。",
    ].join("\n"),
  editSession: (d) =>
    [
      `sessionId ${d.sessionId}　status ${d.status}`,
      `目标 canvas ${d.canvasId} node ${d.nodeId}　源图 ${d.sourceAssetId}`,
      `签发 ${d.createdAt}　过期 ${d.expiresAt}`,
      d.result
        ? `蒙版 ${d.result.maskAssetId ?? "-"}\n要求 ${d.result.instruction}\n提交于 ${d.result.submittedAt ?? "-"}\n※ 拿蒙版发起局部重绘：t2i + --reference <源图> + params.mask <蒙版>（先报价）`
        : d.status === "pending"
          ? "※ 用户还没提交：去做别的事，下一轮再查。"
          : "※ 这条链接已废，重签一条并告诉用户上一条已失效。",
    ].join("\n"),
  assets: (d, meta) =>
    [
      ...d.items.map(
        (a) =>
          `${a.assetId}  ${a.mime}  ${(a.sizeBytes / 1024 / 1024).toFixed(2)}MB` +
          `${a.durationS ? `  ${a.durationS}s` : ""}  ${a.createdAt}`,
      ),
      d.integrity
        ? `完整性：引用 ${d.integrity.referenced_total} / 云端可取 ${d.integrity.cloud_available}` +
          `　缺失 ${d.integrity.missing.length}` +
          (d.integrity.unreadable_canvases.length
            ? `　读不出的画布 ${d.integrity.unreadable_canvases.length}`
            : "")
        : "",
      `共 ${meta?.total ?? d.items.length} 条（limit ${meta?.limit} offset ${meta?.offset}）`,
    ]
      .filter(Boolean)
      .join("\n"),
  voices: (d, meta) =>
    [
      ...d.voices.map(
        (v) =>
          `${v.voiceId}\n    ${v.name}　[${v.kind}]` +
          `${v.language ? `　${v.language}` : ""}` +
          `${v.tags?.length ? `　${v.tags.join("/")}` : ""}` +
          // kind 决定填哪个字段，是最容易搞混的一处，逐条直接写出来
          `　→ 填 params.${v.kind === "user" ? "voiceName" : "voiceId"}`,
      ),
      `共 ${meta?.total ?? d.voices.length} 条（limit ${meta?.limit} offset ${meta?.offset}）`,
    ].join("\n"),
  digitalHumans: (d) =>
    d.digitalHumans.length
      ? [
          ...d.digitalHumans.map(
            (h) =>
              `${h.id}\n    ${h.name}　[${h.status}]` +
              `${h.triggerWord ? `　触发词 ${h.triggerWord}` : ""}` +
              // 用法最容易写错的一处，逐条直接写出来：只填 id，形象图不用传
              "　→ 填 params.digitalHumanId（avatar 口播，不再传 firstFrame / motionVideo）",
          ),
          `共 ${d.digitalHumans.length} 个`,
        ].join("\n")
      : "没有可用的专属数字人（仅管理员可见；非管理员恒为空）",
  characterVoices: (d, meta) => {
    const bound = Object.keys(d.bindings ?? {});
    const pending = (d.knownCharacters ?? []).filter((n) => !bound.includes(n));
    return [
      ...Object.entries(d.bindings ?? {}).map(([name, b]) => {
        const fields = [
          b.sampleAssetId ? `样本 ${b.sampleAssetId.slice(0, 12)}…` : "",
          b.voiceName ? `voiceName ${b.voiceName}` : "",
          b.voiceId ? `voiceId ${b.voiceId}` : "",
          b.voiceDescription ? `声线 ${b.voiceDescription.slice(0, 24)}` : "",
          b.label ? `[${b.label}]` : "",
        ].filter(Boolean);
        return `✓ ${name}　${fields.join("　")}`;
      }),
      // 待办清单是 GET 存在的主要理由，直接算好给出，不让调用方自己做集合差
      pending.length ? `待定嗓：${pending.join("、")}` : "全部角色已定嗓",
      `version ${d.version}${meta?.noop ? "（noop：内容与云端一致，未推进版本）" : ""}`,
    ].join("\n");
  },
  node: (d) =>
    [
      `${d.id}  [${d.kind}] ${d.title}　version ${d.version}`,
      d.anchor ? `锚点 ${d.anchor.kind}:${d.anchor.name}` : "",
      d.body ? `正文\n${d.body}` : "",
      Object.keys(d.params ?? {}).length
        ? `可改参数（updateCard 就改这些）\n${Object.entries(d.params)
            .map(([k, v]) => `  ${k} = ${v}`)
            .join("\n")}`
        : "可改参数：无（该卡型只能改 title）",
      // 结构化可写字段（style / camera）：取值不是标量，落不进上面的 params 表。
      // 不单独打出来就会变成「写得进去却看不见」——正是要避免的读写不对称。
      Object.keys(d.config ?? {}).length
        ? `结构化配置（形状可原样写回 updateCard，传 null 摘掉）\n${Object.entries(
            d.config,
          )
            .map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`)
            .join("\n")}`
        : "",
      d.shots?.length
        ? `分镜表 ${d.shots.length} 行\n${d.shots
            .map(
              (s) =>
                `  [${s.index}] ${s.picture}｜${s.shotSize}｜${s.camera}` +
                `${s.durationSec ? `｜${s.durationSec}s` : ""}` +
                `${s.dialogue ? `｜「${s.dialogue}」` : ""}` +
                `${s.linkedNodeId ? `　已出图 ${s.linkedNodeId}` : ""}` +
                `${s.voiceNodeId ? `　已配音 ${s.voiceNodeId}` : ""}`,
            )
            .join("\n")}`
        : "",
      d.hasAsset ? `产物 ${d.assetIds.join(",")}` : "",
      `上游 ${d.upstreamIds.join(",") || "-"}　下游 ${d.downstreamIds.join(",") || "-"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  uploaded: (d, meta) =>
    [
      `assetId ${d.assetId}`,
      `类型 ${d.mime}　大小 ${(d.sizeBytes / 1024 / 1024).toFixed(2)}MB` +
        `${d.width && d.height ? `　${d.width}×${d.height}` : ""}` +
        `${d.durationS ? `　${d.durationS}s` : ""}`,
      d.deduplicated
        ? "这份内容以前就传过，未新建对象（上传是幂等的，assetId = 内容 sha256）"
        : "已入库",
      typeof meta?.uploadQuotaRemainingBytes === "number"
        ? `当日剩余上传额度 ${(meta.uploadQuotaRemainingBytes / 1024 / 1024).toFixed(1)}MB`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  // ── LLM 分析域 ─────────────────────────────────────────────────────────
  // 渲染器一律**只做摘要**：结构化产物的正确用法是 jq 取字段再回写画布，
  // 摘要是给人看「拆出来多少、像不像话」的，别照着摘要手抄内容。
  extract: (d, meta) =>
    [
      d.kind === "characters"
        ? d.characters
            .map(
              (c) =>
                `${c.name}${c.age ? `（${c.age}）` : ""}${c.identity ? `　${c.identity}` : ""}` +
                `${c.look ? `\n    ${c.look}` : ""}`,
            )
            .join("\n")
        : d.kind === "scenes"
          ? d.scenes
              .map(
                (s) =>
                  `${s.name}${s.time ? `　${s.time}` : ""}${s.inOut ? `　${s.inOut}` : ""}` +
                  `${s.description ? `\n    ${s.description}` : ""}`,
              )
              .join("\n")
          : d.props
              .map(
                (p) =>
                  `${p.name}${p.material ? `　${p.material}` : ""}${p.era ? `　${p.era}` : ""}` +
                  `${p.description ? `\n    ${p.description}` : ""}`,
              )
              .join("\n"),
      `共 ${(d.characters ?? d.scenes ?? d.props).length} 项（${d.kind}）` +
        `${meta ? `　实耗 ${meta.credits} 积分` : ""}`,
      "※ 未落卡。改完用 `dj.mjs ops` 的 createCharacterBoard / createSceneSet / createPropBoard 写进画布。",
    ].join("\n"),
  storyboard: (d, meta) =>
    [
      d.visualTone ? `全片基调　${d.visualTone}` : "",
      d.newCast?.length
        ? `⚠ 名单外新增角色：${d.newCast.join("、")}（他们没有设定板，相关镜头连不上参考图）`
        : "",
      ...d.scenes.map(
        (s) =>
          `【${s.name}】${s.time ? ` ${s.time}` : ""}${s.inOut ? ` ${s.inOut}` : ""}` +
          `${s.emotionArc ? `　情绪 ${s.emotionArc}` : ""}\n` +
          s.shots
            .map(
              (sh, i) =>
                `  ${i + 1}. ${sh.shotSize}｜${sh.camera}｜${sh.durationSec}s` +
                `${sh.cast?.length ? `｜${sh.cast.join("、")}` : ""}` +
                `${sh.picture ? `\n     ${sh.picture}` : ""}`,
            )
            .join("\n"),
      ),
      `共 ${d.scenes.length} 场 / ${d.scenes.reduce((n, s) => n + s.shots.length, 0)} 镜` +
        `${meta ? `　实耗 ${meta.credits} 积分` : ""}`,
      "※ 未落卡。回写用 createStoryboard 一镜落一张图卡；某一镜要改用 updateCard 改那张卡。",
    ]
      .filter(Boolean)
      .join("\n"),
  storyboardFall: (d) =>
    [
      ...d.batches.map(
        (b) =>
          `${b.sceneName}：${b.shotCount} 段落卡` +
          `${b.noop ? `，未连上：${b.noop}` : ""}`,
      ),
      d.batches.length === 0 ? "（没有一场带 segments，什么都没落）" : "",
      `共 ${d.batches.length} 批　新建 ${d.createdNodeIds.length} 个节点（含引用坞与编组）`,
      d.unmatchedNames.length
        ? `⚠ 这些名字在画布上没有设定板：${d.unmatchedNames.join("、")}` +
          `——先 createCharacterBoard / createSceneSet / createPropBoard 补建并出图，再 connectCards 补边`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  storyboardFallDryRun: (d) =>
    [
      ...d.requests.map(
        (r, i) => `[${i}] ${r.sceneName}　${r.body.ops[0].params.shots.length} 段\n${JSON.stringify(r.body)}`,
      ),
      `共 ${d.requests.length} 批（--dry-run，未发任何请求）`,
    ].join("\n"),
  caption: (d, meta) =>
    [
      d.kind === "image" ? d.text : d.prompt,
      d.scope ? `\n适用范围　${d.scope}` : "",
      d.slots?.length
        ? `素材位\n${d.slots.map((s) => `  ${s.literal} → ${s.purpose}`).join("\n")}`
        : "",
      d.warnings?.length
        ? `⚠ 告警（不阻断，但拿去生成前请复核）\n  ${d.warnings.join("\n  ")}`
        : "",
      // 2.31.0 起反推收费（图片 0.1/次、视频 0.1/秒）：如实报实扣，mock 演示产物不扣
      meta?.mock
        ? "※ 演示产物（平台未接视觉模型），未扣积分、没有信息量。"
        : `※ 本次实扣 ${meta?.credits ?? "?"} 积分（图片 0.1/次、视频 0.1/秒），对账凭据 ${meta?.creditRef ?? "—"}。`,
    ]
      .filter(Boolean)
      .join("\n"),
  inspect: (d, meta) =>
    [
      `结论　${d.verdict}${meta?.mock ? "（⚠ 演示产物：平台未接视觉模型，没有信息量）" : ""}`,
      ...d.checks.map(
        (c) =>
          `  [${c.verdict}] ${c.dimension}${c.basis ? `（基准 ${c.basis}）` : ""}\n      ${c.reason}`,
      ),
      d.advice ? `建议　${d.advice}` : "",
      // 「没判」与「通过」是两回事，这一句是本渲染器最该说的话
      `※ checks 里没有的维度 = 缺基准**没判**，不等于通过。判定方 ${d.judge.modelId}。`,
    ]
      .filter(Boolean)
      .join("\n"),
  rewrite: (d, meta) =>
    `${d.text}\n\n※ mode=${d.mode}${meta ? `　实耗 ${meta.credits} 积分` : ""}`,
  wallet: (d) =>
    `计费 ${d.enabled ? "已启用" : "未启用"}　余额 ${d.balance} 积分　冻结 ${d.held} 积分`,
  ledger: (d, meta) =>
    `${d.entries.length === 0 ? "（无流水）" : d.entries
      .map(
        (e) =>
          `#${e.id} ${e.type} ${e.amount >= 0 ? "+" : ""}${e.amount}　余 ${e.balanceAfter ?? "-"}` +
          `　冻 ${e.heldAfter ?? "-"}　${e.createdAt}${e.taskId ? `　task ${e.taskId}` : ""}`,
      )
      .join("\n")}\n共 ${meta?.total ?? d.entries.length} 条`,
  // ── 多轮 Agent 会话（纪律 13）───────────────────────────────────────────
  agents: (d, meta) =>
    `${(d.agents ?? [])
      .map(
        (a) =>
          `${a.id}　${a.name}` +
          `${a.conversational ? "　[可开会话]" : "　[不可开会话]"}` +
          `　一轮 ${a.billing?.stagesPerTurn ?? "?"} 阶段` +
          `${a.artifactKind ? `　产物型 ${a.artifactKind}` : ""}` +
          `${a.defaultModelId ? `　默认模型 ${a.defaultModelId}` : ""}` +
          `${a.description ? `\n    ${a.description}` : ""}`,
      )
      .join("\n")}\n共 ${meta?.total ?? (d.agents ?? []).length} 个` +
    "\n※ 本目录不含单价：算好的报价在 `chat new` / `chat show` 的" +
    " meta.estimatedTurnCredits（纪律 13）；" +
    "conversational=false 的开不了会话，别拿它去 `chat new`。",
  conversation: (d, meta) => renderConversationBlock(d.conversation, meta).join("\n"),
  chatShow: (d, meta) =>
    [
      ...renderConversationBlock(d.conversation, meta),
      d.lastMessage ? `\n最近一轮　[seq ${d.lastMessage.seq}] ${d.lastMessage.role}` : "",
      d.lastMessage?.text ?? "",
      ...renderTurnArtifacts(d.lastMessage?.artifacts),
    ]
      .filter(Boolean)
      .join("\n"),
  chats: (d, meta) =>
    `${
      (d.conversations ?? []).length === 0
        ? "（没有会话；`dj.mjs chat new --agent <id>` 开一段）"
        : d.conversations.map(renderConversationLine).join("\n")
    }\n共 ${meta?.total ?? (d.conversations ?? []).length} 段（含网页端建的）`,
  chatTurn: (d, meta) =>
    [
      `seq ${d.seq}　状态 ${d.status}　messageId ${d.messageId}　${d.createdAt}`,
      d.text ? `\n${d.text}` : "",
      ...renderTurnArtifacts(d.artifacts),
      d.usage ? `token　入 ${d.usage.inputTokens} / 出 ${d.usage.outputTokens}` : "",
      renderTurnCredits(d, meta),
      Array.isArray(meta?.warnings) && meta.warnings.length > 0
        ? `⚠ ${meta.warnings.join("\n  ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  chatDeleted: (d) =>
    `已删除  ${d.conversationId}\n` +
    "※ 硬删：这段会话与它的全部消息都没了，**不可撤销**（网页端也看不到了）。\n" +
    "※ 账本不受影响、也不退款——删会话省不下钱，只是把上下文丢掉。",
  chatHistory: (d, meta) =>
    [
      ...(d.messages ?? []).map((m) => {
        const flat = String(m.text ?? "").replace(/\s+/g, " ").trim();
        const clipped = flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
        const drafts = (m.artifacts ?? []).reduce(
          (sum, a) => sum + (a.variants?.length ?? (a.artifactId ? 1 : 0)),
          0,
        );
        return (
          `[${m.seq}] ${m.role}　${clipped || "（无正文）"}` +
          `${drafts ? `　[产物 ${drafts} 稿]` : ""}`
        );
      }),
      `共 ${(d.messages ?? []).length} 条　lastSeq ${meta?.lastSeq ?? "?"}` +
        `${typeof meta?.lastSeq === "number" ? `（增量续拉：--after-seq ${meta.lastSeq}）` : ""}` +
        "\n※ 正文按 200 字截断；稿件全文用 `dj.mjs chat show` 或发轮的回执取。",
    ].join("\n"),

  // ---- 选题情报（雷达 / 简报 / 文案库）----

  radarSources: (d) =>
    [
      ...(d.sources ?? []).map((s) => {
        // failStreak 非零要显眼：它意味着这个源的数据正在变陈旧，而列表本身看不出来
        const warn = s.failStreak > 0 ? `　⚠ 连续失败 ${s.failStreak} 次` : "";
        return (
          `${s.nickname || "（无名）"}　${s.platform}　粉丝 ${fmtCount(s.followerCount)}` +
          `${typeof s.followerDelta7d === "number" ? `（7 日 ${signed(s.followerDelta7d)}）` : ""}` +
          `　作品 ${s.itemCount ?? "?"}${warn}\n  id ${s.id}`
        );
      }),
      `共 ${(d.sources ?? []).length} 位。退订：dj.mjs radar unwatch <id>`,
    ].join("\n"),

  radarItems: (d, meta) =>
    [
      ...(d.items ?? []).map((it) => {
        const dm = it.delta?.metrics ?? {};
        // 排的是增量不是绝对值，所以增量必须排在最前面显示
        const deltas = ["likes", "comments", "shares", "favorites"]
          .filter((k) => typeof dm[k] === "number")
          .map((k) => `${METRIC_LABEL[k]}${signed(dm[k])}`)
          .join(" ");
        return (
          `${clip(it.title, 46)}\n` +
          `  ${deltas || "（窗口内无增量）"}　${it.durationSec ?? "?"}s　${it.platform}` +
          `${it.delta?.full === false ? "　※ 窗口未满，增量按实际年龄算" : ""}\n` +
          `  id ${it.id}`
        );
      }),
      `共 ${(d.items ?? []).length} 条${meta?.nextCursor || d.nextCursor ? `　下一页 --cursor ${d.nextCursor ?? meta.nextCursor}` : ""}`,
      "※ 排序是窗口内**增量**，不是绝对值——绝对值排序会让大号永远霸榜。",
    ].join("\n"),

  radarItem: (d, meta) =>
    [
      `标题　${d.title ?? "（无标题）"}`,
      `平台　${d.platform}　时长 ${d.durationSec ?? "?"}s　发布 ${d.publishedAt ?? "?"}`,
      `原链接　${d.url ?? "-"}`,
      `当前　${fmtMetrics(d.current)}`,
      `增量　${fmtMetrics(d.delta?.metrics)}（窗口 ${d.delta?.windowHours ?? "?"}h` +
        `${d.delta?.full === false ? "，未满，数值只是下界" : ""}）`,
      `同号中位比　${d.medianRatio ?? "-"}` +
        // 退化路径要说清是「算不出」而不是「表现平平」，否则会被当成真实的低分
        `${meta?.medianRatioUnavailable ? "（条目已滑出该博主扫描面，算不出，不是 0）" : ""}`,
      `已分析　${d.analysisStatus === "analyzed" ? `是（报告 ${d.analysisReportId}）` : "否"}`,
    ].join("\n"),

  radarMetrics: (d, meta) =>
    [
      ...(d.points ?? []).map((p) => `${p.capturedAt}　${fmtMetrics(p)}`),
      `共 ${meta?.total ?? (d.points ?? []).length} 个采样点。`,
      "※ **原始快照**：不插值、不补零、不平滑，采样间隔也不均匀" +
        "（48h 内每小时 / 14 天内每 6 小时 / 之后每日）。两点之间的空档就是没采到，别当成 0。",
    ].join("\n"),

  radarFollowers: (d, meta) =>
    [
      ...(d.points ?? []).map(
        (p) =>
          `${p.capturedAt}　粉丝 ${fmtCount(p.followerCount)}　作品 ${p.itemCount ?? "-"}`,
      ),
      `共 ${meta?.total ?? (d.points ?? []).length} 个点（日粒度）。`,
      "※ `null` = 那轮没采到，不是掉到 0。",
    ].join("\n"),

  radarHot: (d) =>
    [
      ...(d.entries ?? []).map((e) => {
        // 名次只在热度榜上有意义：时序榜的「第 1」只代表最新，标出来免得被当成最热
        const rank = typeof e.rank === "number" ? `#${e.rank} ` : "";
        return (
          `${rank}${clip(e.title, 44)}　[${e.board}]` +
          `${typeof e.onBoardHours === "number" ? `　在榜 ${e.onBoardHours}h` : ""}`
        );
      }),
      `共 ${(d.entries ?? []).length} 条。`,
    ].join("\n"),

  // 日报自带一份成稿 markdown，直接给它——重新拼一遍只会比服务端拼得差
  radarDaily: (d) =>
    [
      `日期　${d.date}　生成于 ${d.generatedAt}　新增条目 ${d.newItems ?? 0}`,
      "",
      d.markdown || "（这份日报没有 markdown 正文）",
      "",
      `※ 爆款 ${(d.breakouts ?? []).length} 条　涨粉 ${(d.followerMovers?.up ?? []).length} 位　` +
        `掉粉 ${(d.followerMovers?.down ?? []).length} 位　推荐 ${(d.recommendations ?? []).length} 条`,
    ].join("\n"),

  brief: (d) => {
    const topics = d.topics ?? [];
    return [
      `简报　${d.date}　生成于 ${d.generatedAt}`,
      `频道　${d.channel?.name ?? "?"}　垂类 ${d.channel?.vertical ?? "?"}` +
        `${d.channel?.configured === false ? "　⚠ 用的是出厂词表（用户还没配频道）" : ""}`,
      `选题　${topics.length} 条`,
      "",
      ...topics.map((t, i) => {
        const f = t.feasibility ?? {};
        return (
          `${i + 1}. ${clip(t.title, 50)}\n` +
          `   可执行性 ${FEASIBILITY_LABEL[f.materialNeed] ?? f.materialNeed ?? "未判"}` +
          `${f.source === "heuristic" ? "（规则判）" : ""}` +
          `　参考 ${(t.references ?? []).length} 条　新闻 ${(t.news ?? []).length} 条\n` +
          `   id ${t.id}`
        );
      }),
      "",
      "※ 要写稿先看 references[]：那是**别人同题材怎么写的**，比空想开头有效。",
      "※ 全文（含每条参考的结构化拆解）：dj.mjs brief --md",
    ].join("\n");
  },

  briefList: (d) =>
    [
      ...(d.items ?? []).map(
        (b) =>
          `${b.date}　选题 ${b.topicCount}　参考 ${b.referenceCount}　新闻 ${b.newsCount}\n` +
          `  ${clip((b.topTopics ?? []).join(" / "), 60)}\n  id ${b.id}`,
      ),
      `共 ${(d.items ?? []).length} 份${d.nextCursor ? `　下一页 --cursor ${d.nextCursor}` : ""}`,
    ].join("\n"),

  briefRebuild: (d, meta) =>
    [
      `已重建 ${d.date} 的简报　id ${meta?.briefId ?? "?"}`,
      `选题 ${d.topicCount}　参考 ${d.referenceCount}　新闻 ${d.newsCount}`,
      `过闸信号　热榜 ${d.passed?.hotEntries ?? 0}　作品 ${d.passed?.items ?? 0}　新闻 ${d.passed?.news ?? 0}`,
      `规则指纹　${d.ruleVersion}` +
        `${d.channelConfigured === false ? "\n⚠ 用户还没配频道，本次用的是 AI 垂类出厂词表" : ""}`,
      "※ 统计窗口恒为**此刻往前 24 小时**：指定昨天只是把结果落到昨天那一行，不是时光机。",
    ].join("\n"),

  copyEntries: (d, meta) =>
    [
      ...(d.entries ?? []).map((e) => {
        const s = e.structured ?? {};
        return (
          `[${e.tier ?? "-"}] ${clip(e.hookLine, 44)}\n` +
          `   ${e.language}　${e.charCount ?? "?"} 字　钩子 ${s.hook?.type ?? "?"}` +
          `　结构 ${s.topicType ?? "?"}　CTA ${s.cta?.type ?? "无"}\n` +
          `   id ${e.id}`
        );
      }),
      `共 ${(d.entries ?? []).length} 条${d.nextCursor ? `　下一页 --cursor ${d.nextCursor}` : ""}` +
        `${meta?.sort ? `　排序 ${meta.sort}` : ""}`,
      "※ 检索**只匹配钩子行**，正文不参与——能全文搜等于能把正文捞出来。",
    ].join("\n"),

  copyEntry: (d) => {
    const s = d.structured ?? {};
    return [
      `钩子　${d.hookLine ?? "-"}`,
      `语言　${d.language}　字数 ${d.charCount}　分档 ${d.tier ?? "-"}　归属 ${d.scope}`,
      `结构　${s.topicType ?? "?"}　钩子手段 ${s.hook?.type ?? "?"}　CTA ${s.cta?.type ?? "无"}`,
      s.titleFormula ? `标题公式　${s.titleFormula}` : "",
      // structure[] 的每段是 {role, summary, ratio}；ratio 是**时长占比**，
      // 照着仿写时它比 role 本身更有用（知道该在哪一段花多少时间）
      (s.structure ?? []).length
        ? `段落　${s.structure.map((x) => `${x.role}(${Math.round((x.ratio ?? 0) * 100)}%)`).join(" → ")}`
        : "",
      (s.goldenQuotes ?? []).length ? `金句　${s.goldenQuotes.slice(0, 3).join(" / ")}` : "",
      "",
      // body 为 null 只剩一种成因了（别人的私有条目）；说清楚，免得被当成 bug 反复重试
      d.body ??
        "正文：这条是**别人的用户私有条目**，不下发全文（平台语料是给的）。",
    ]
      .filter(Boolean)
      .join("\n");
  },

  copyJobs: (d, meta) =>
    [
      ...(d.jobs ?? []).map(
        (j) =>
          `${j.stage}　${j.attempts}/${j.maxAttempts} 次　${j.language ?? "语言未定"}\n` +
          `  ${j.lastError ? `× ${clip(j.lastError, 50)}` : "无报错"}\n  id ${j.id}`,
      ),
      `共 ${(d.jobs ?? []).length} 条${meta?.total !== undefined ? `（总计 ${meta.total}）` : ""}`,
      // 空列表极易被误判成「队列坏了」，而真实原因通常是这条
      (d.jobs ?? []).length === 0
        ? "※ 这里**只列你自己触发的**任务；平台级自动排队的不出现在这里，空列表不代表没在跑。"
        : "",
      (d.jobs ?? []).some((j) => j.stage === "failed")
        ? "※ failed 是终态、不会自动重试：dj.mjs copy retry <jobId>（只有 failed 能重试，其余阶段返回 409）"
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
};

/** 指标中文名（增量展示用，顺序即重要性） */
const METRIC_LABEL = { likes: "赞", comments: "评", shares: "转", favorites: "藏", views: "播", coins: "币" };

/** 可执行性口径：这条选题「AI 数字人做不做得了」 */
const FEASIBILITY_LABEL = {
  pure_oral: "纯口播可做",
  needs_broll: "需要 B-roll",
  needs_shooting: "需要实拍",
  unknown: "未判定",
};

/** 带符号的增量：0 也要显式写成 +0，免得与「没采到」混淆 */
function signed(n) {
  return typeof n === "number" ? (n >= 0 ? `+${n}` : String(n)) : "?";
}

/** 大数收成万，小数原样——粉丝数读起来要快 */
function fmtCount(n) {
  if (typeof n !== "number") return "?";
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : String(n);
}

/** 一行指标；**null 打成「-」而不是 0**（抖音播放量恒为 null，打 0 就是造假数据） */
function fmtMetrics(m) {
  if (!m || typeof m !== "object") return "-";
  return (
    Object.entries(METRIC_LABEL)
      .filter(([k]) => k in m)
      .map(([k, label]) => `${label}${m[k] === null ? "-" : m[k]}`)
      .join(" ") || "-"
  );
}

/** 截断到 n 个字符，超出补省略号 */
function clip(text, n) {
  const s = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  if (!s) return "（空）";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ---------------------------------------------------------------------------
// 子命令
// ---------------------------------------------------------------------------

async function cmdMe(ctx) {
  handle(ctx, await request(ctx, "GET", "/me"), pretty.me);
}

async function cmdModels(ctx, { flags }) {
  const capability = flags.capability;
  if (typeof capability === "string" && !CAPABILITIES.includes(capability)) {
    fail(`--capability 只能是：${CAPABILITIES.join(" / ")}`);
  }
  handle(ctx, await request(ctx, "GET", `/models${qs({ capability })}`), pretty.models);
}

async function cmdVoices(ctx, { flags }) {
  const query = qs({
    q: typeof flags.q === "string" ? flags.q : undefined,
    limit: intFlag(flags, "limit", undefined),
    offset: intFlag(flags, "offset", undefined),
  });
  handle(ctx, await request(ctx, "GET", `/voices${query}`), pretty.voices);
}

/**
 * `digital-humans`：专属数字人目录（avatar 口播的 params.digitalHumanId 从这里取）。
 * 仅管理员可见——非管理员拿到的恒为空列表（服务端刻意不报 403），不是出错。
 */
async function cmdDigitalHumans(ctx) {
  handle(ctx, await request(ctx, "GET", "/digital-humans"), pretty.digitalHumans);
}

/**
 * `character-voices <canvasId>`：角色定嗓绑定（试镜定嗓流水线第 ③ 步）。
 * 无写入 flag = GET（读绑定表 + knownCharacters，两者相减即「谁还没定嗓」）；
 * --bind/--unbind = PUT 增量写（一次一个角色；批量/带更多字段走 -f body.json）。
 * 键必须与角色卡名字逐字一致——写错不报错、生成时静默不注入，所以先 GET 抄名单。
 */
async function cmdCharacterVoices(ctx, { positional, flags }) {
  const canvasId = positional[0] ?? flags.canvas;
  if (typeof canvasId !== "string") {
    fail("character-voices 需要 canvasId：dj.mjs character-voices <canvasId> [写入选项]");
  }
  const path = `/canvases/${encodeURIComponent(canvasId)}/character-voices`;

  const file = typeof flags.file === "string" ? flags.file : undefined;
  const bind = typeof flags.bind === "string" ? flags.bind : undefined;
  const unbind = typeof flags.unbind === "string" ? flags.unbind : undefined;

  if (!file && !bind && !unbind) {
    handle(ctx, await request(ctx, "GET", path), pretty.characterVoices);
    return;
  }

  let body;
  if (file) {
    body = await readJsonInput(flags, "character-voices 请求体");
  } else if (unbind) {
    body = { bindings: { [unbind]: null } };
  } else {
    const binding = {};
    if (typeof flags.sample === "string") binding.sampleAssetId = flags.sample;
    if (typeof flags["voice-id"] === "string") binding.voiceId = flags["voice-id"];
    if (typeof flags["voice-name"] === "string") binding.voiceName = flags["voice-name"];
    if (typeof flags.desc === "string") binding.voiceDescription = flags.desc;
    if (typeof flags.label === "string") binding.label = flags.label;
    if (Object.keys(binding).length === 0) {
      fail("--bind 至少要配 --sample / --voice-id / --voice-name / --desc 之一（--label 只是展示名）");
    }
    body = { bindings: { [bind]: binding } };
  }
  handle(ctx, await request(ctx, "PUT", path, body), pretty.characterVoices);
}

/** 详读单卡：正文全文 + 可写参数快照 + 直接上下游（存量分镜表卡另出全部行） */
async function cmdNode(ctx, { positional, flags }) {
  const canvasId = positional[0] ?? flags.canvas;
  const nodeId = positional[1] ?? flags.node;
  if (typeof canvasId !== "string") fail("node 需要 canvasId：dj.mjs node <canvasId> <nodeId>");
  if (typeof nodeId !== "string") fail("node 需要 nodeId：dj.mjs node <canvasId> <nodeId>");
  handle(
    ctx,
    await request(
      ctx,
      "GET",
      `/canvases/${encodeURIComponent(canvasId)}/nodes/${encodeURIComponent(nodeId)}`,
    ),
    pretty.node,
  );
}

// ---------------------------------------------------------------------------
// LLM 分析域（剧本 → 结构 / 素材 → 提示词 / 文本加工）
// ---------------------------------------------------------------------------

/**
 * 取模型覆盖（四条分析命令共用）。
 * 省略即由服务端走平台默认链——**别硬编一个 uuid**，后台换模型时会全线失效。
 */
function modelOverride(flags) {
  return typeof flags.model === "string" ? { modelId: flags.model } : {};
}

/** 剧本 → 结构化角色 / 场景 / 道具（只返数据，不落卡） */
async function cmdExtract(ctx, { positional, flags }) {
  let body;
  if (typeof flags.file === "string") {
    body = await readJsonInput(flags, "extract 请求体");
  } else {
    const kind = positional[0] ?? flags.kind;
    if (!EXTRACT_KINDS.includes(kind)) {
      fail(`extract 需要类型：dj.mjs extract <${EXTRACT_KINDS.join("|")}> --script <path>`);
    }
    const content = await readTextInput(flags, "script", "剧本正文");
    const existingNames = listFlag(flags, "existing");
    body = {
      kind,
      content,
      ...(existingNames ? { existingNames } : {}),
      ...modelOverride(flags),
    };
  }
  handle(ctx, await request(ctx, "POST", "/analyze/extract", body), pretty.extract);
}

/** 剧本 → 结构化分镜（只返数据，不落卡） */
async function cmdStoryboard(ctx, { flags }) {
  let body;
  if (typeof flags.file === "string") {
    body = await readJsonInput(flags, "storyboard 请求体");
  } else {
    const content = await readTextInput(flags, "script", "剧本正文");
    const castNames = listFlag(flags, "cast");
    const sceneNames = listFlag(flags, "scenes");
    let bible;
    if (typeof flags.bible === "string") {
      try {
        bible = readFileSync(flags.bible, "utf8");
      } catch (err) {
        fail(`读取 ${flags.bible} 失败：${err instanceof Error ? err.message : "unknown"}`);
      }
    }
    // 跨镜外观锚：extract characters 的 shotInjection 映射成 [{name, anchor}] 存成 JSON 文件传入。
    // 不传则模型每个镜头都在重新想象角色长相（SKILL 纪律 10 第三步）
    let appearanceAnchors;
    if (typeof flags.anchors === "string") {
      let raw;
      try {
        raw = JSON.parse(readFileSync(flags.anchors, "utf8"));
      } catch (err) {
        fail(`读取 --anchors ${flags.anchors} 失败：${err instanceof Error ? err.message : "unknown"}`);
      }
      // 空 anchor（shotInjection 为空串的角色）剔除：服务端 anchor 要求非空，整批 400 不值
      const list = Array.isArray(raw) ? raw : raw?.appearanceAnchors;
      if (!Array.isArray(list)) fail("--anchors 文件须是 [{name, anchor}] 数组（或 {appearanceAnchors:[…]}）");
      appearanceAnchors = list.filter(
        (a) => a && typeof a.name === "string" && typeof a.anchor === "string" && a.anchor.trim(),
      );
    }
    // 建议段打包上限（秒，2-15）：按所选视频模型的单次时长上限对齐；服务端缺省 10（生成甜区）
    const segmentMaxSec =
      typeof flags["segment-max-sec"] === "string"
        ? Number(flags["segment-max-sec"])
        : undefined;
    if (segmentMaxSec !== undefined && !Number.isInteger(segmentMaxSec)) {
      fail("--segment-max-sec 须为整数（秒，2-15）");
    }
    body = {
      content,
      ...(castNames ? { castNames } : {}),
      ...(sceneNames ? { sceneNames } : {}),
      ...(bible ? { bible } : {}),
      ...(appearanceAnchors?.length ? { appearanceAnchors } : {}),
      ...(segmentMaxSec !== undefined ? { segmentMaxSec } : {}),
      ...modelOverride(flags),
    };
  }
  handle(ctx, await request(ctx, "POST", "/analyze/storyboard", body), pretty.storyboard);
}

/**
 * 一场戏的 `segments[]` → 若干批 `createStoryboard kind:"video"` 请求体。
 *
 * 纯函数（不碰网络），三条规矩都在这里，调用方不必再自己写 jq：
 * - 空 `segments` 的场直接跳过（落一个空批只会拿到 400）；
 * - 场景名空串兜底「未命名场景」并截到 80 字（服务端上限），否则整批被拒；
 * - 一场超过 30 段自动拆批——同 `sceneName` 服务端会复用同一引用坞与同一编组
 *   （续批的卡收进既有组并扩框），60 段的场落出来仍是一块。
 */
function buildStoryboardFallBatches(scenes, aspectRatio, scriptNodeId) {
  const batches = [];
  for (const scene of scenes) {
    const segments = Array.isArray(scene?.segments) ? scene.segments : [];
    if (segments.length === 0) continue;
    const rawName = typeof scene?.name === "string" ? scene.name.trim() : "";
    const sceneName = (rawName || FALLBACK_SCENE_NAME).slice(0, SCENE_NAME_MAX);
    for (let at = 0; at < segments.length; at += STORYBOARD_MAX_SHOTS) {
      const slice = segments.slice(at, at + STORYBOARD_MAX_SHOTS);
      batches.push({
        sceneName,
        params: {
          kind: "video",
          layout: "grouped",
          sceneName,
          ...(aspectRatio ? { aspectRatio } : {}),
          // --script：视频卡带站内同款 shotOf 溯源锚与「场景N·视频｜剧本（场景）」组名；
          // 不传站内会判「本剧本没拆过分镜」而在旁边再落一整套重复卡
          ...(scriptNodeId ? { scriptNodeId } : {}),
          // 段的字段原样传回：服务端已把角色/道具并集与音轨标记算好，自拼只会更差
          shots: slice.map((seg) => ({
            title: seg?.title,
            prompt: seg?.videoPrompt,
            ...(seg?.durationSec !== undefined ? { durationSec: seg.durationSec } : {}),
            ...(seg?.audio !== undefined ? { audio: seg.audio } : {}),
            ...(Array.isArray(seg?.cast) ? { cast: seg.cast } : {}),
            ...(Array.isArray(seg?.props) ? { props: seg.props } : {}),
            // 镜号锚只在给了 --script 时随段传回（shotCount = shotNoEnd − shotNoStart + 1）
            ...(scriptNodeId && Number.isInteger(seg?.shotNoStart)
              ? {
                  shotNoStart: seg.shotNoStart,
                  ...(Number.isInteger(seg?.shotNoEnd)
                    ? { shotCount: seg.shotNoEnd - seg.shotNoStart + 1 }
                    : {}),
                }
              : {}),
          })),
        },
      });
    }
  }
  return batches;
}

/**
 * 从 op 结果的 `noop` 文案里抽出「声明了却没有设定板」的名字。
 *
 * 服务端文案格式见 canvas-ops-cards.ts（`…未能连上参考图：甲、乙。先用…`）。
 * 解析失败只是拿不到汇总名单，`noop` 原文照样逐批回显——不会丢信息。
 */
function parseUnmatchedNames(noop) {
  const matched = /未能连上参考图：(.+?)。/.exec(typeof noop === "string" ? noop : "");
  if (!matched) return [];
  return matched[1].split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * `storyboard-fall <canvasId> -f <storyboard响应.json>`：把 `dj storyboard` 的产物
 * 按场次落成分镜视频卡（纪律 10 第 ④ 步的一键版）。
 *
 * 为什么要有它：这一步原本要 Agent 自己写一段 jq（每场一批、空名兜底、30 段上限、
 * 字段改名 videoPrompt→prompt），jq 写错的表现是**静默断链**——卡都建了、看着正常，
 * 只是没连参考图。把规矩沉进命令里，「正确的路」才是最省事的路。
 *
 * 不带 `--if-version`：整批是增量落卡，服务端自动重读重放才是对的（见 ops 词表）。
 */
async function cmdStoryboardFall(ctx, { positional, flags }) {
  const canvasId = positional[0] ?? flags.canvas;
  if (typeof canvasId !== "string") {
    fail("storyboard-fall 需要 canvasId：dj.mjs storyboard-fall <canvasId> -f sb.json");
  }
  const input = await readJsonInput(flags, "storyboard 响应（完整信封或裸 data）");
  // 两种输入都收：`dj storyboard` 的完整信封 / 直接喂 data 对象
  const data = input?.data && Array.isArray(input.data.scenes) ? input.data : input;
  if (!data || !Array.isArray(data.scenes)) {
    fail(
      "输入形状不对：期待 `dj storyboard` 的响应信封 {ok,data:{scenes:[…]}}，或裸的 {scenes:[…]}",
    );
  }
  const aspectRatio = typeof flags.aspect === "string" ? flags.aspect : undefined;
  const scriptNodeId = typeof flags.script === "string" ? flags.script.trim() : undefined;
  if (scriptNodeId !== undefined && !scriptNodeId) fail("--script 需要剧本文本卡的 nodeId");
  const batches = buildStoryboardFallBatches(data.scenes, aspectRatio, scriptNodeId);

  const path = `/canvases/${encodeURIComponent(canvasId)}/ops`;
  if (flags["dry-run"]) {
    emit(
      ctx,
      {
        ok: true,
        data: {
          dryRun: true,
          path,
          requests: batches.map((b) => ({ sceneName: b.sceneName, body: { ops: [{ op: "createStoryboard", params: b.params }] } })),
        },
        error: null,
      },
      pretty.storyboardFallDryRun,
    );
    return;
  }

  const done = [];
  const createdNodeIds = [];
  const unmatchedNames = [];
  for (const batch of batches) {
    const body = { ops: [{ op: "createStoryboard", params: batch.params }] };
    const result = await request(ctx, "POST", path, body);
    const envelope = result.envelope;
    const realStatus = Number(envelope?.meta?.httpStatus) || result.status;
    // 任一批失败立即停止：后面几场再落也只是把一张半成品画布拖得更乱。
    // 原样交给 handle——错误信封、人读提示与退出码全走既有约定
    if (!(realStatus >= 200 && realStatus < 300 && envelope?.ok)) {
      process.stderr.write(
        `dj: storyboard-fall 在第 ${done.length + 1}/${batches.length} 批（${batch.sceneName}）失败，` +
          `前 ${done.length} 批已落盘、不会回滚。修好后从这一场接着落即可。\n`,
      );
      handle(ctx, result); // 内部打印信封并退出
      return;
    }
    const opResult = envelope.data?.results?.[0] ?? {};
    const nodeIds = opResult.nodeIds ?? [];
    createdNodeIds.push(...nodeIds);
    for (const name of parseUnmatchedNames(opResult.noop)) {
      if (!unmatchedNames.includes(name)) unmatchedNames.push(name);
    }
    done.push({
      sceneName: batch.sceneName,
      shotCount: batch.params.shots.length,
      nodeIds,
      ...(opResult.noop ? { noop: opResult.noop } : {}),
    });
  }

  emit(
    ctx,
    {
      ok: true,
      data: { batches: done, createdNodeIds, unmatchedNames },
      error: null,
    },
    pretty.storyboardFall,
  );
}

/**
 * 图片 / 视频反推提示词。
 *
 * 视频这一路要求调用方**自己抽好帧并逐张上传**（服务端不抽帧），
 * 所以入参是一串 assetId 而不是一个视频文件路径——这里早拒形态不对的 id，
 * 免得让人以为「传路径也行」。
 */
async function cmdCaption(ctx, { positional, flags }) {
  let body;
  if (typeof flags.file === "string") {
    body = await readJsonInput(flags, "caption 请求体");
  } else {
    const kind = positional[0] ?? flags.kind;
    if (!CAPTION_KINDS.includes(kind)) {
      fail(`caption 需要形态：dj.mjs caption <${CAPTION_KINDS.join("|")}> …`);
    }
    if (kind === "image") {
      const assetId = positional[1] ?? flags.asset;
      if (typeof assetId !== "string") fail("caption image 需要 assetId：dj.mjs caption image <assetId>");
      assertAssetIds([assetId], "caption image 的素材");
      body = { kind, assetId };
    } else {
      const frames = listFlag(flags, "frames") ?? (positional[1] ? positional.slice(1) : undefined);
      if (!frames?.length) {
        fail("caption video 需要按时序排列的帧：--frames <assetId,assetId,…>（2–8 张，先自己抽帧再 upload）");
      }
      assertAssetIds(frames, "caption video 的帧");
      const durationSec = Number(flags.duration);
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        fail("caption video 需要 --duration <秒>（视频总时长，模型据此分配时间轴）");
      }
      const timeSec = listFlag(flags, "times")?.map(Number);
      if (timeSec?.some((t) => !Number.isFinite(t))) fail("--times 只能是逗号分隔的数字");
      body = {
        kind,
        frameAssetIds: frames,
        durationSec,
        ...(timeSec ? { timeSec } : {}),
        ...(typeof flags.dialogue === "string" ? { dialogue: flags.dialogue } : {}),
      };
    }
  }
  handle(ctx, await request(ctx, "POST", "/analyze/caption", body), pretty.caption);
}

/**
 * 分镜图质检。
 *
 * 快捷式只覆盖「有提示词基准」这一种最常见的用法；要判角色一致性得给分组过的
 * 定妆照（`characterRefs`），那是嵌套结构，用 `-f body.json` 传更清楚——
 * 硬塞进命令行标志只会拼出一个没人记得住的语法。
 */
async function cmdInspect(ctx, { positional, flags }) {
  let body;
  if (typeof flags.file === "string") {
    body = await readJsonInput(flags, "inspect 请求体");
  } else {
    const candidateAssetId = positional[0] ?? flags.asset;
    if (typeof candidateAssetId !== "string") {
      fail("inspect 需要待检图：dj.mjs inspect <assetId> --prompt \"…\"（或 -f body.json）");
    }
    assertAssetIds([candidateAssetId], "inspect 的待检图");
    const prompt = typeof flags.prompt === "string" ? flags.prompt : undefined;
    const sceneAssetId = typeof flags["scene-asset"] === "string" ? flags["scene-asset"] : undefined;
    const sceneName = typeof flags["scene-name"] === "string" ? flags["scene-name"] : undefined;
    if (sceneAssetId) assertAssetIds([sceneAssetId], "inspect 的场景参考图");
    if (sceneAssetId && !sceneName) fail("--scene-asset 必须配 --scene-name（判定按名字分块）");
    body = {
      candidateAssetId,
      context: {
        ...(prompt ? { prompt } : {}),
        ...(sceneAssetId ? { sceneRef: { name: sceneName, assetId: sceneAssetId } } : {}),
      },
      ...(listFlag(flags, "dimensions") ? { dimensions: listFlag(flags, "dimensions") } : {}),
    };
  }
  handle(ctx, await request(ctx, "POST", "/analyze/inspect", body), pretty.inspect);
}

/** 改写 / 优化 / 翻译 / 写词 */
async function cmdRewrite(ctx, { positional, flags }) {
  let body;
  if (typeof flags.file === "string") {
    body = await readJsonInput(flags, "rewrite 请求体");
  } else {
    const mode = positional[0] ?? flags.mode;
    if (!REWRITE_MODES.includes(mode)) {
      fail(`rewrite 需要形态：dj.mjs rewrite <${REWRITE_MODES.join("|")}> …`);
    }
    // 正文优先取 --text（短文案直接写在命令行更顺手），否则读 --script / stdin
    const text =
      typeof flags.text === "string"
        ? flags.text
        : await readTextInput(flags, "script", "待加工正文");
    const instruction = typeof flags.instruction === "string" ? flags.instruction : undefined;
    // 两条服务端会拒的组合在客户端就说清楚，省一次往返也省一次困惑
    if (mode === "edit" && !instruction) {
      fail("rewrite edit 必须给 --instruction（改写要求）；不给的话模型只会原样返回");
    }
    if (mode === "translate" && instruction) {
      fail("rewrite translate 不接受 --instruction（翻译没有「要求」维度）；要定向改写请用 rewrite edit");
    }
    body = {
      mode,
      text,
      ...(instruction ? { instruction } : {}),
      ...modelOverride(flags),
    };
  }
  handle(ctx, await request(ctx, "POST", "/analyze/rewrite", body), pretty.rewrite);
}

/**
 * 上传本地素材换 assetId。
 *
 * 用 undici 的 FormData + Blob：它会算出准确的 Content-Length，
 * 而服务端**要求必带**该头（没有长度声明就只能读完才知道多大，那时内存已经满了）。
 * 手写 multipart 边界串或改用 chunked 传输都会直接吃 411。
 */
async function cmdUpload(ctx, { positional, flags }) {
  const file = positional[0] ?? flags.file;
  if (typeof file !== "string") fail("upload 需要文件路径：dj.mjs upload <path>");

  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    fail(`读取 ${file} 失败：${err instanceof Error ? err.message : "unknown"}`);
  }
  if (bytes.length === 0) fail(`${file} 是空文件，服务端不受理`);

  const form = new FormData();
  // 声明的 type 只用于与服务端嗅探结果对拍；落库 mime 一律以魔数嗅探为准，
  // 所以这里不猜类型（猜错反而会被判成「声明与内容不符」而 415）
  form.append("file", new Blob([bytes]), "upload.bin");
  handle(ctx, await request(ctx, "POST", "/assets", form), pretty.uploaded);
}

async function cmdProjects(ctx, { positional, flags }) {
  const sub = positional[0];
  if (sub === "list" || sub === undefined) {
    const query = qs({ limit: intFlag(flags, "limit", undefined), offset: intFlag(flags, "offset", undefined) });
    handle(ctx, await request(ctx, "GET", `/projects${query}`), pretty.projectList);
    return;
  }
  if (sub === "create") {
    const name = positional[1] ?? flags.name;
    if (typeof name !== "string" || !name.trim()) fail("projects create 需要项目名：dj.mjs projects create <name>");
    handle(ctx, await request(ctx, "POST", "/projects", { name: name.trim() }), pretty.created);
    return;
  }
  fail(`未知子命令 projects ${sub}（可用：list / create）`);
}

async function cmdCanvas(ctx, { positional, flags }) {
  const sub = positional[0];
  if (sub === "create") {
    const projectId = positional[1] ?? flags.project;
    const name = positional[2] ?? flags.name;
    if (typeof projectId !== "string") fail("canvas create 需要 projectId");
    if (typeof name !== "string" || !name.trim()) fail("canvas create 需要画布名");
    handle(
      ctx,
      await request(ctx, "POST", `/projects/${encodeURIComponent(projectId)}/canvases`, {
        name: name.trim(),
      }),
      pretty.created,
    );
    return;
  }
  if (sub === "list") {
    // 接着上次的工作就靠它：附加画布的 canvasId 只在创建那一次返回过，
    // 隔一个会话回来不先列一遍，就只能再建一张新画布
    const projectId = positional[1] ?? flags.project;
    if (typeof projectId !== "string") fail("canvas list 需要 projectId");
    handle(
      ctx,
      await request(ctx, "GET", `/projects/${encodeURIComponent(projectId)}/canvases`),
      pretty.canvasList,
    );
    return;
  }
  if (sub === "structure") {
    const canvasId = positional[1] ?? flags.canvas;
    if (typeof canvasId !== "string") fail("canvas structure 需要 canvasId");
    // --full：每张卡附带全文与全部可写参数（整张画布一次读全，不必逐张 dj node）
    const detail = flags.full ? "full" : undefined;
    handle(
      ctx,
      await request(
        ctx,
        "GET",
        `/canvases/${encodeURIComponent(canvasId)}/structure${qs({ detail })}`,
      ),
      pretty.structure,
    );
    return;
  }
  if (sub === "lint") {
    // 生成前置门禁（纪律 10）：只读、不扣积分，跑多少次都不花钱
    const canvasId = positional[1] ?? flags.canvas;
    if (typeof canvasId !== "string") fail("canvas lint 需要 canvasId");
    const data = handle(
      ctx,
      await request(ctx, "GET", `/canvases/${encodeURIComponent(canvasId)}/lint`),
      pretty.lint,
    );
    // 有 error 级 finding 就退 2（与 API 业务错误同码）：`dj canvas lint "$C" || exit 1`
    // 这一行就能把「没连参考就出片」卡在流水线里。warn 不影响退出码。
    if ((data?.summary?.errors ?? 0) > 0) process.exit(EXIT.apiError);
    return;
  }
  fail(`未知子命令 canvas ${sub}（可用：list / create / structure / lint）`);
}

async function cmdOps(ctx, { positional, flags }) {
  const canvasId = positional[0] ?? flags.canvas;
  if (typeof canvasId !== "string") fail("ops 需要 canvasId：dj.mjs ops <canvasId> -f batch.json");

  const input = await readJsonInput(flags, "ops 批次");
  // 三种输入都收：完整 body / 裸数组 / 单个 op 对象——降低 Agent 拼装成本
  let body;
  if (Array.isArray(input)) body = { ops: input };
  else if (input && typeof input === "object" && Array.isArray(input.ops)) body = { ...input };
  else if (input && typeof input === "object" && typeof input.op === "string") body = { ops: [input] };
  else fail("ops 输入形状不对：期待 {ops:[…]} 或 [ …op… ] 或单个 op 对象");

  const ifVersion = intFlag(flags, "if-version", undefined);
  if (ifVersion !== undefined) body = { ...body, ifVersion };

  handle(
    ctx,
    await request(ctx, "POST", `/canvases/${encodeURIComponent(canvasId)}/ops`, body),
    pretty.ops,
  );
}

/** 从 --params-json 或 --params k=v,k=v 组装 params（数字/布尔自动转型） */
function buildParams(flags) {
  if (typeof flags["params-json"] === "string") {
    try {
      return JSON.parse(flags["params-json"]);
    } catch (err) {
      fail(`--params-json 不是合法 JSON：${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  if (typeof flags.params !== "string") return undefined;
  const out = {};
  for (const pair of flags.params.split(",")) {
    const at = pair.indexOf("=");
    if (at < 0) fail(`--params 每项要写成 key=value，收到：${pair}`);
    const key = pair.slice(0, at).trim();
    const rawUntouched = pair.slice(at + 1);
    // 音色 id 是**精确匹配**的不透明串：个别系统音色带尾随空格，trim 过就不命中；
    // 纯数字的 id 被转型成 number 后类型也对不上。两种清洗都会让服务端报「音色不存在」，
    // 而那个错误看起来像「目录里的 id 失效了」，极易把人诊断偏（服务端是 fail-closed，
    // 不会静默换成默认音色，但会白白烧掉一次调用与限流预算）。
    if (key === "voiceId" || key === "voiceName") {
      out[key] = rawUntouched;
      continue;
    }
    const raw = rawUntouched.trim();
    if (raw === "true" || raw === "false") out[key] = raw === "true";
    else if (raw !== "" && Number.isFinite(Number(raw))) out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

async function cmdPrecheck(ctx, { flags }) {
  let body;
  if (typeof flags.model === "string") {
    // 单项快捷式：dj.mjs precheck --model <id> --capability i2v --params durationSec=5
    if (typeof flags.capability !== "string") fail("precheck 快捷式需要 --capability");
    const params = buildParams(flags);
    body = {
      items: [
        { model: flags.model, capability: flags.capability, ...(params ? { params } : {}) },
      ],
    };
  } else {
    const input = await readJsonInput(flags, "precheck items");
    if (Array.isArray(input)) body = { items: input };
    else if (input && typeof input === "object" && Array.isArray(input.items)) body = input;
    else fail("precheck 输入形状不对：期待 {items:[…]} 或裸数组");
  }
  handle(ctx, await request(ctx, "POST", "/generations/precheck", body), pretty.precheck);
}

async function cmdGenerate(ctx, { flags }) {
  let body;
  if (typeof flags.model === "string") {
    if (typeof flags.capability !== "string") fail("generate 需要 --capability");
    const params = buildParams(flags);
    const references =
      typeof flags.reference === "string"
        ? flags.reference.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    // 参考音频（ref2v 锁音色，试镜定嗓第 ⑤ 步）：顺序即 <Audio j> 编号，最多 3 段
    const referenceAudios =
      typeof flags["reference-audio"] === "string"
        ? flags["reference-audio"].split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    // 参考视频（ref2v 动作/运镜参考，白模换角链路的后半段）：顺序即 <Video k> 编号，最多 3 段
    const referenceVideos =
      typeof flags["reference-video"] === "string"
        ? flags["reference-video"].split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    body = {
      requestId: flags["request-id"],
      model: flags.model,
      capability: flags.capability,
      ...(params ? { params } : {}),
      ...(typeof flags.canvas === "string" ? { canvasId: flags.canvas } : {}),
      ...(typeof flags.node === "string" ? { nodeId: flags.node } : {}),
      ...(references?.length ? { referenceAssetIds: references } : {}),
      ...(referenceAudios?.length ? { referenceAudioAssetIds: referenceAudios } : {}),
      ...(referenceVideos?.length ? { referenceVideoAssetIds: referenceVideos } : {}),
    };
  } else {
    const input = await readJsonInput(flags, "generate 请求体");
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail("generate 输入形状不对：期待一个请求体对象");
    }
    body = { ...input };
    if (typeof flags["request-id"] === "string") body.requestId = flags["request-id"];
  }

  // 幂等键客户端强制：故意不自动生成——重试必须复用同一个键，
  // 由调用方生成并**存下来**才是正确姿势（用 `dj.mjs uuid` 现取一个）。
  if (typeof body.requestId !== "string" || !body.requestId.trim()) {
    fail(
      "generate 缺少 requestId（幂等键）。用 `dj.mjs uuid` 生成一个并存下来，" +
        "失败重试时原样复用同一个键，才不会重复扣费。",
    );
  }
  if (body.requestId !== undefined && !/^[0-9a-fA-F-]{36}$/.test(body.requestId)) {
    fail(`requestId 必须是 36 位 uuid 形态，收到：${body.requestId}`);
  }

  handle(ctx, await request(ctx, "POST", "/generations", body), pretty.submitted);
}

/** 轮询到终态：间隔取 max(服务端建议, 3s)，逐轮温和退避，撞 429 加倍退避 */
async function cmdTask(ctx, { positional, flags }) {
  const taskId = positional[0] ?? flags.task;
  if (typeof taskId !== "string") fail("task 需要 taskId：dj.mjs task <taskId> [--watch]");
  const path = `/generations/${encodeURIComponent(taskId)}`;

  if (!flags.watch) {
    handle(ctx, await request(ctx, "GET", path), pretty.task);
    return;
  }

  const timeoutMs = intFlag(flags, "timeout", DEFAULT_WATCH_TIMEOUT_S) * 1000;
  const deadline = Date.now() + timeoutMs;
  let interval = POLL_MIN_MS;
  let last = null;

  for (;;) {
    const result = await request(ctx, "GET", path);
    if (result.status === 429) {
      // 限流不是失败：退避后继续等（终态才是这条命令的出口）
      interval = Math.min(interval * 2, POLL_MAX_MS);
      if (Date.now() + interval > deadline) break;
      if (ctx.pretty) process.stderr.write(`dj: 被限流，退避 ${interval}ms 后继续轮询\n`);
      await sleep(interval);
      continue;
    }
    if (result.status < 200 || result.status >= 300 || !result.envelope?.ok) {
      handle(ctx, result, pretty.task); // 内部会打印并退出
      return;
    }

    last = result;
    const status = result.envelope.data?.status;
    if (status === "succeeded" || status === "failed" || status === "canceled") {
      emit(ctx, result.envelope, pretty.task);
      process.exit(status === "succeeded" ? EXIT.ok : EXIT.taskNotSucceeded);
    }

    const suggested = Number(result.envelope.meta?.pollAfterMs);
    const base = Number.isFinite(suggested) && suggested > 0 ? suggested : POLL_MIN_MS;
    interval = Math.min(Math.max(base, POLL_MIN_MS, Math.round(interval * POLL_BACKOFF)), POLL_MAX_MS);
    if (ctx.pretty) {
      const progress = typeof result.envelope.data?.progress === "number"
        ? `　进度 ${result.envelope.data.progress}%`
        : "";
      process.stderr.write(`dj: ${status}${progress}，${interval}ms 后再查\n`);
    }
    if (Date.now() + interval > deadline) break;
    await sleep(interval);
  }

  if (last) emit(ctx, last.envelope, pretty.task);
  process.stderr.write(
    `dj: 等待超时（${Math.round(timeoutMs / 1000)}s），任务仍在进行——不是失败，稍后用 \`dj.mjs task ${taskId}\` 再查。\n`,
  );
  process.exit(EXIT.watchTimeout);
}

async function cmdCancel(ctx, { positional, flags }) {
  const taskId = positional[0] ?? flags.task;
  if (typeof taskId !== "string") fail("cancel 需要 taskId");
  handle(
    ctx,
    await request(ctx, "POST", `/generations/${encodeURIComponent(taskId)}/cancel`),
    pretty.cancel,
  );
}

/**
 * 人工介入编辑（纪律 9）：签发免登录编辑链接 / 查状态 / 撤销。
 *
 * ⚠️ `create` 的输出里含**明文令牌**（就在 `url` 里）——它等同凭据。
 * 所以这里与其它命令一样只往 stdout 写一次，不落文件、不写日志；
 * 转述给用户之后就别再复述它。`status` / `revoke` 的响应不含令牌。
 */
async function cmdEditSession(ctx, { positional, flags }) {
  const sub = positional[0];
  if (sub === "create") {
    const canvasId = positional[1] ?? flags.canvas;
    const nodeId = positional[2] ?? flags.node;
    if (typeof canvasId !== "string" || typeof nodeId !== "string") {
      fail("edit-session create 需要 <canvasId> <nodeId>（nodeId 必须是一张已经出过图的图片卡）");
    }
    // 源图**不传**：服务端从那张卡的当前产物读，请求体里根本没有这个字段
    const ttlMinutes = intFlag(flags, "ttl", undefined);
    const body = {
      canvasId,
      nodeId,
      ...(typeof flags.capability === "string" ? { capability: flags.capability } : {}),
      ...(typeof flags.hint === "string" ? { instructionHint: flags.hint } : {}),
      ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
    };
    handle(
      ctx,
      await request(ctx, "POST", "/edit-sessions", body),
      pretty.editSessionCreated,
    );
    return;
  }
  if (sub === "status" || sub === "revoke") {
    const sessionId = positional[1] ?? flags.session;
    if (typeof sessionId !== "string") {
      fail(`edit-session ${sub} 需要 sessionId（create 响应里的 sessionId，不是链接里的令牌）`);
    }
    handle(
      ctx,
      await request(
        ctx,
        sub === "status" ? "GET" : "DELETE",
        `/edit-sessions/${encodeURIComponent(sessionId)}`,
      ),
      pretty.editSession,
    );
    return;
  }
  fail(`未知子命令 edit-session ${sub ?? ""}（可用：create / status / revoke）`);
}

async function cmdAssets(ctx, { positional, flags }) {
  const sub = positional[0] ?? "list";
  if (sub === "list") {
    const query = qs({
      limit: intFlag(flags, "limit", undefined),
      offset: intFlag(flags, "offset", undefined),
      mime: typeof flags.mime === "string" ? flags.mime : undefined,
    });
    const path =
      typeof flags.project === "string"
        ? `/projects/${encodeURIComponent(flags.project)}/assets${query}`
        : `/assets${query}`;
    handle(ctx, await request(ctx, "GET", path), pretty.assets);
    return;
  }
  if (sub === "get") {
    const assetId = positional[1] ?? flags.asset;
    if (typeof assetId !== "string") fail("assets get 需要 assetId");
    handle(ctx, await request(ctx, "GET", `/assets/${encodeURIComponent(assetId)}`));
    return;
  }
  fail(`未知子命令 assets ${sub}（可用：list / get）`);
}

async function cmdWallet(ctx) {
  handle(ctx, await request(ctx, "GET", "/billing/wallet"), pretty.wallet);
}

/**
 * 列生成任务（恢复现场）。
 *
 * 状态丢了就用它：缺省只列在途（排队中 ∪ 生成中），那是「我还有什么没跑完」的直接答案。
 * 注意它**不轮询上游**——status 是库里的快照，要准确状态与终态落卡还得 `dj task <taskId>`。
 */
async function cmdTasks(ctx, { flags }) {
  const query = qs({
    limit: intFlag(flags, "limit", undefined),
    offset: intFlag(flags, "offset", undefined),
    status: typeof flags.status === "string" ? flags.status : undefined,
    canvasId: typeof flags.canvas === "string" ? flags.canvas : undefined,
    requestId: typeof flags.request === "string" ? flags.request : undefined,
  });
  handle(ctx, await request(ctx, "GET", `/generations${query}`), pretty.tasks);
}

async function cmdLedger(ctx, { flags }) {
  const query = qs({
    limit: intFlag(flags, "limit", undefined),
    offset: intFlag(flags, "offset", undefined),
    tokenId: typeof flags["token-id"] === "string" ? flags["token-id"] : undefined,
  });
  handle(ctx, await request(ctx, "GET", `/billing/ledger${query}`), pretty.ledger);
}

// ---------------------------------------------------------------------------
// 多轮 Agent 会话（纪律 13）
// ---------------------------------------------------------------------------

/** Agent 目录（能不能开会话看 conversational；报价看 `chat new` / `chat show` 的 meta） */
async function cmdAgents(ctx) {
  handle(ctx, await request(ctx, "GET", "/agents"), pretty.agents);
}

/**
 * 读本地文件成内联文本附件。
 *
 * 只收**纯文本**：会话域不吃媒体（媒体走生成域的 assetId 管线）。上限与服务端
 * 逐字同口径，客户端早拒——服务端对超限的一轮是整轮 400、不截断。
 */
function readTurnAttachments(flags) {
  const files = listFlag(flags, "attach-file");
  if (!files) return undefined;
  if (files.length > MAX_TURN_ATTACHMENT_FILES) {
    fail(`--attach-file 最多 ${MAX_TURN_ATTACHMENT_FILES} 个文件，收到 ${files.length} 个`);
  }
  const attachments = files.map((path) => {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      fail(`读取附件 ${path} 失败：${err instanceof Error ? err.message : "unknown"}`);
    }
    if (text.length > MAX_TURN_ATTACHMENT_CHARS) {
      fail(
        `附件 ${path} 有 ${text.length} 字，超过单文件上限 ${MAX_TURN_ATTACHMENT_CHARS} 字——` +
          "先自己裁剪或拆成多轮（服务端整轮拒收，不会替你截断）。",
      );
    }
    return { name: pathBasename(path), text };
  });
  return attachments;
}

/** 附件 + 引用的联合预算（条数与总字符，服务端同一口径） */
function assertTurnMaterialBudget(attachments, references) {
  const items = (attachments?.length ?? 0) + (references?.length ?? 0);
  if (items > MAX_TURN_MATERIAL_ITEMS) {
    fail(
      `一轮的附件 + 引用合计最多 ${MAX_TURN_MATERIAL_ITEMS} 条，收到 ${items} 条` +
        "（附件与引用共用同一份预算，别各算各的）。",
    );
  }
  const chars = (attachments ?? []).reduce((sum, item) => sum + item.text.length, 0);
  if (chars > MAX_TURN_MATERIAL_CHARS) {
    fail(
      `附件合计 ${chars} 字，超过一轮素材总预算 ${MAX_TURN_MATERIAL_CHARS} 字；` +
        "引用的成果正文还要占同一份预算，请再裁剪。",
    );
  }
}

/** `chat new`：开一段会话（**不扣钱**，扣钱的是发轮） */
async function chatNew(ctx, flags) {
  const agentId = typeof flags.agent === "string" ? flags.agent : undefined;
  if (!agentId) {
    fail(
      "chat new 需要 --agent <agentId>（先 `dj.mjs agents` 抄准 id）。" +
        "会话建好后 Agent **不可改**，换 Agent = 新建一段会话。",
    );
  }
  const params = buildParams(flags);
  const body = {
    agentId,
    ...(typeof flags.model === "string" ? { modelId: flags.model } : {}),
    ...(typeof flags.title === "string" ? { title: flags.title } : {}),
    ...(params ? { params } : {}),
  };
  handle(ctx, await request(ctx, "POST", "/conversations", body), pretty.conversation);
}

/** `chat send`：发一轮（**每轮都扣钱**，先按目录报价再发——纪律 13） */
async function chatSend(ctx, positional, flags) {
  const conversationId = positional[1] ?? flags.conversation;
  if (typeof conversationId !== "string") {
    fail('chat send 需要 conversationId：dj.mjs chat send <conversationId> --request-id <uuid> "<一句话>"');
  }
  const prompt =
    positional.slice(2).join(" ").trim() ||
    (typeof flags.text === "string" ? flags.text : "");
  const attachments = readTurnAttachments(flags);
  const references = listFlag(flags, "ref")?.map((artifactId) => ({ artifactId }));
  assertTurnMaterialBudget(attachments, references);
  const regenerate = Boolean(flags.regenerate);
  if (!prompt && !regenerate && !attachments && !references) {
    fail(
      "chat send 需要一句话（位置参数或 --text）；只想重出上一轮就加 --regenerate，" +
        "只发素材就带 --attach-file / --ref。",
    );
  }

  // 幂等键客户端强制：与 generate 同则（纪律 4 / 13）。故意不自动生成——
  // 重试必须复用同一个键，由调用方生成并**存下来**才是正确姿势。
  const requestId = flags["request-id"];
  if (typeof requestId !== "string" || !requestId.trim()) {
    fail(
      "chat send 缺少 requestId（幂等键）。用 `dj.mjs uuid` 生成一个并存下来，" +
        "撞 409 或超时重试时原样复用同一个键，才不会重复扣费。",
    );
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(requestId)) {
    fail(`requestId 必须是 36 位 uuid 形态，收到：${requestId}`);
  }

  const params = buildParams(flags);
  const body = {
    requestId,
    prompt,
    ...(attachments ? { attachments } : {}),
    ...(references ? { references } : {}),
    ...(regenerate ? { regenerate: true } : {}),
    ...(typeof flags.model === "string" ? { modelId: flags.model } : {}),
    ...(params ? { params } : {}),
  };
  handle(
    ctx,
    await request(
      ctx,
      "POST",
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      body,
    ),
    pretty.chatTurn,
  );
}

/**
 * 多轮 Agent 会话：`new` / `send` / `history` / `show` / `delete`（纪律 13）。
 *
 * 会话 id 就是这段创作的全部状态——历史、系统提示词、窗口化全在服务端，
 * 每轮只发新的一句话，不要把上一轮的稿子再贴一遍。丢了 id 用 `dj.mjs chats` 捞。
 */
async function cmdChat(ctx, { positional, flags }) {
  const sub = positional[0];
  if (sub === "new") {
    await chatNew(ctx, flags);
    return;
  }
  if (sub === "send") {
    await chatSend(ctx, positional, flags);
    return;
  }
  if (sub === "delete") {
    const conversationId = positional[1] ?? flags.conversation;
    if (typeof conversationId !== "string") {
      fail("chat delete 需要 conversationId：dj.mjs chat delete <conversationId>");
    }
    handle(
      ctx,
      await request(
        ctx,
        "DELETE",
        `/conversations/${encodeURIComponent(conversationId)}`,
      ),
      pretty.chatDeleted,
    );
    return;
  }
  if (sub === "history" || sub === "show") {
    const conversationId = positional[1] ?? flags.conversation;
    if (typeof conversationId !== "string") {
      fail(`chat ${sub} 需要 conversationId（用 dj.mjs chats 把现场捞回来）`);
    }
    const path = `/conversations/${encodeURIComponent(conversationId)}`;
    if (sub === "show") {
      handle(ctx, await request(ctx, "GET", path), pretty.chatShow);
      return;
    }
    const query = qs({
      afterSeq: intFlag(flags, "after-seq", undefined),
      limit: intFlag(flags, "limit", undefined),
    });
    handle(ctx, await request(ctx, "GET", `${path}/messages${query}`), pretty.chatHistory);
    return;
  }
  fail(`未知子命令 chat ${sub ?? ""}（可用：new / send / history / show / delete）`);
}

/**
 * 列会话（**上下文丢了就用它**）。
 * 含网页端建的那些——人机接力是这套东西的第一价值，别以为只能看见自己建的。
 */
async function cmdChats(ctx, { flags }) {
  const query = qs({
    agentId: typeof flags.agent === "string" ? flags.agent : undefined,
    limit: intFlag(flags, "limit", undefined),
    offset: intFlag(flags, "offset", undefined),
  });
  handle(ctx, await request(ctx, "GET", `/conversations${query}`), pretty.chats);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 版本与自检（不碰业务数据，不花钱）
// ---------------------------------------------------------------------------

/**
 * 读本地 skill 的版本元数据：解析同级 `../SKILL.md` 的 frontmatter。
 *
 * 单一真相源：版本号只写在 SKILL.md 里，脚本不内嵌副本——两处手写版本号
 * 必然有一天对不上，而「版本号对不上」这件事本身就是版本机制要防的问题。
 * 读不到（只单独拷了 dj.mjs、或文件被删）返回 null，由调用方如实报告。
 */
function readLocalSkillMeta() {
  try {
    const skillMd = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
    const field = (name) => skillMd.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();
    const version = field("version");
    if (version) {
      return {
        version,
        releasedAt: field("releasedAt") ?? null,
        source: "skill-md",
        variant: skillVariantOf(field("name")),
      };
    }
  } catch {
    // 同级没有 SKILL.md：Codex 等宿主常常只拷 scripts/，落到下面的内嵌兜底
  }
  return { version: EMBEDDED_SKILL_VERSION, releasedAt: null, source: "embedded", variant: "full" };
}

/**
 * 同一份 dj.mjs 随两个分发变体发出：完整版 `rooyun` 与精简版 `rooyun-cli`（CLI 自由模式）。
 * 靠同级 SKILL.md 的 `name` 认出自己属于哪个——更新时要拉**同一个变体**的包，
 * 否则在精简版里跑 update 会凭空装出一份完整版，两个 skill 抢着触发。
 */
const SKILL_NAME_BY_VARIANT = { full: "rooyun", cli: "rooyun-cli" };

function skillVariantOf(name) {
  return name === SKILL_NAME_BY_VARIANT.cli ? "cli" : "full";
}

/** 分发包地址（完整版不带参数，与旧版脚本、旧文档里的地址保持一致） */
function skillBundleUrl(base, variant) {
  return variant === "cli" ? `${base}/api/skill/bundle?variant=cli` : `${base}/api/skill/bundle`;
}

/**
 * 拉线上版本头（`HEAD /api/skill/bundle`，**无需令牌**——分发端点本就公开）。
 * 失败返回 null：自检的任何一项都不该因为网络抖动把整条命令打成失败。
 */
async function fetchRemoteSkillMeta(base, variant = "full") {
  try {
    const response = await fetch(skillBundleUrl(base, variant), { method: "HEAD" });
    const version = response.headers.get("x-skill-version");
    if (!version) return null;
    return {
      version,
      hash: response.headers.get("x-skill-hash"),
      releasedAt: response.headers.get("x-skill-released-at"),
    };
  } catch {
    return null;
  }
}

/**
 * 同名 skill 冲突检测：扫 dj.mjs 所在 skill 目录的兄弟目录，找出同样声明
 * `name: rooyun` 的其它安装。
 *
 * 存在意义：备份副本（`rooyun-backup/`、`rooyun.old/`）里的 SKILL.md 往往
 * **name 字段照抄**，于是同一个技能名有两份定义，触发时用哪份全看运气——
 * 用户会看到「明明更新了却还是旧行为」。这类问题从内部读日志根本查不出来，
 * 只有在用户机器上扫一眼目录才知道。
 *
 * 完整版 `rooyun` 与精简版 `rooyun-cli` 同时安装也算冲突：两者描述都覆盖「用 RooYun 生成…」，
 * 触发哪个全看运气——用户会时而被 15 条纪律管着、时而又不管，比只装任意一个都糟。
 */
function detectSkillConflicts() {
  try {
    const selfDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/+$/, "");
    const parent = pathDirname(selfDir);
    const conflicts = [];
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      if (dir === selfDir) continue;
      let content = "";
      try {
        content = readFileSync(`${dir}/SKILL.md`, "utf8");
      } catch {
        continue;
      }
      const name = content.match(/^name:\s*(rooyun|rooyun-cli)\s*$/m)?.[1];
      if (name) {
        conflicts.push({
          dir,
          name,
          version: content.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? "（无版本号）",
        });
      }
    }
    return conflicts;
  } catch {
    return [];
  }
}

/** 本地版本 vs 线上版本的判定（纯字符串比对，不做 semver 大小比较） */
// ---------------------------------------------------------------------------
// 选题情报：雷达 / 简报 / 文案库
//
// 这三个域是**一条链**：雷达发现谁在涨 → 文案库拆解别人怎么写 → 简报把两者合成
// 每日情报。它们共用同一个「选题雷达」账号权益，被拒时码面都是 `radar_not_enabled`
// ——那不是 scope 不够，重建令牌没有用，要管理员开通（见 references/errors.md）。
//
// 全部**不扣积分**：读的是平台 cron 早就采好的数据。
// ---------------------------------------------------------------------------

/** 逗号分隔的多选参数：原样透传，让服务端校验取值——本地维护一份枚举必然与服务端漂移 */
function csvFlag(flags, name) {
  const raw = flags[name];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/**
 * `radar <子命令>`：对标博主与他们的作品增速。
 *
 * 排序一律是**窗口内增量**而不是绝对值——绝对值排序会让大号永远霸榜，
 * 而雷达要回答的是「谁正在起来」。
 */
async function cmdRadar(ctx, { positional, flags }) {
  const sub = positional[0];

  if (sub === "sources" || sub === undefined) {
    handle(ctx, await request(ctx, "GET", "/radar/sources"), pretty.radarSources);
    return;
  }

  if (sub === "watch") {
    // 收的是**主页链接**，不是 secUid——平台与 id 由服务端从链接解析。
    // 夹着链接的整段分享文本也行（服务端摘第一个 http(s) URL）
    const url = positional.slice(1).join(" ").trim() || (typeof flags.url === "string" ? flags.url : "");
    if (!url) fail("radar watch 需要一个博主主页链接（抖音 /user/…、B 站 space.bilibili.com/…、YouTube /channel/UC…）");
    handle(ctx, await request(ctx, "POST", "/radar/sources", { url }), (d, meta) =>
      [
        `${meta?.idempotent ? "已经订阅过了（幂等，没有重复建）" : "订阅成功"}`,
        `平台 ${d.platform}　id ${d.sourceId}`,
        d.sourceExisted ? "※ 这个源别人已在监控，你只是加了一条自己的订阅。" : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return;
  }

  if (sub === "unwatch") {
    const id = positional[1];
    if (typeof id !== "string") fail("radar unwatch 需要 <sourceId>（来自 dj.mjs radar sources）");
    // 不幂等：重复删返回 404。这是刻意的，避免「删了个不存在的」被当成成功
    handle(ctx, await request(ctx, "DELETE", `/radar/sources/${encodeURIComponent(id)}`), (d) =>
      `已退订 ${d.sourceId}。全局源与历史快照序列都保留，重新订阅能接上。`,
    );
    return;
  }

  if (sub === "followers") {
    const id = positional[1];
    if (typeof id !== "string") fail("radar followers 需要 <sourceId>");
    const query = qs({ from: flags.from, to: flags.to });
    handle(
      ctx,
      await request(ctx, "GET", `/radar/sources/${encodeURIComponent(id)}/followers${query}`),
      pretty.radarFollowers,
    );
    return;
  }

  if (sub === "items") {
    const query = qs({
      sort: flags.sort,
      platform: flags.platform,
      sourceId: flags.source,
      window: flags.window,
      limit: intFlag(flags, "limit", undefined),
      cursor: flags.cursor,
    });
    handle(ctx, await request(ctx, "GET", `/radar/items${query}`), pretty.radarItems);
    return;
  }

  if (sub === "item") {
    const id = positional[1];
    if (typeof id !== "string") fail("radar item 需要 <itemId>（来自 dj.mjs radar items）");
    const query = qs({ window: flags.window });
    handle(
      ctx,
      await request(ctx, "GET", `/radar/items/${encodeURIComponent(id)}${query}`),
      pretty.radarItem,
    );
    return;
  }

  if (sub === "metrics") {
    const id = positional[1];
    if (typeof id !== "string") fail("radar metrics 需要 <itemId>");
    const query = qs({ from: flags.from, to: flags.to });
    handle(
      ctx,
      await request(ctx, "GET", `/radar/items/${encodeURIComponent(id)}/metrics${query}`),
      pretty.radarMetrics,
    );
    return;
  }

  if (sub === "hot") {
    const query = qs({
      boards: csvFlag(flags, "boards"),
      window: flags.window,
      limit: intFlag(flags, "limit", undefined),
    });
    handle(ctx, await request(ctx, "GET", `/radar/hot${query}`), pretty.radarHot);
    return;
  }

  if (sub === "daily") {
    const query = qs({ date: flags.date });
    handle(ctx, await request(ctx, "GET", `/radar/daily${query}`), pretty.radarDaily);
    return;
  }

  fail(
    "radar 子命令：sources | watch <主页链接> | unwatch <sourceId> | followers <sourceId> |\n" +
      "             items | item <itemId> | metrics <itemId> | hot | daily",
  );
}

/**
 * `brief`：每日频道简报——选题 + 可执行性判断 + 对标参考，写稿的起点。
 * 不带子命令 = 最近一份（最常用的用法零参数可达）。
 */
async function cmdBrief(ctx, { positional, flags }) {
  const sub = positional[0];

  if (sub === "list") {
    const query = qs({
      date: flags.date,
      limit: intFlag(flags, "limit", undefined),
      cursor: flags.cursor,
    });
    handle(ctx, await request(ctx, "GET", `/briefs${query}`), pretty.briefList);
    return;
  }

  if (sub === "rebuild") {
    // date 只能是今天或昨天（UTC）；且统计窗口恒为「此刻往前 24 小时」，不是时光机
    const body = typeof flags.date === "string" ? { date: flags.date } : {};
    handle(ctx, await request(ctx, "POST", "/briefs/rebuild", body), pretty.briefRebuild);
    return;
  }

  // 默认：最近一份，或 --date / 位置参数指定的那份（{id} 端点同时收 uuid 与 YYYY-MM-DD）
  const ref = sub ?? (typeof flags.date === "string" ? flags.date : undefined);
  const path = ref ? `/briefs/${encodeURIComponent(ref)}` : "/briefs/latest";

  if (flags.md) {
    // markdown 是 v1 唯一的信封例外：200 时直接回 text/markdown 原文，
    // 所以不能走 request()（它强制 JSON.parse）。错误仍是标准 JSON 信封。
    await printBriefMarkdown(ctx, path);
    return;
  }
  handle(ctx, await request(ctx, "GET", path), pretty.brief);
}

/**
 * 取简报的 markdown 原文。
 *
 * 单独一条路径而不是给 `request()` 加开关：那个函数的返回形状（`{status, envelope}`）
 * 被 40 多处调用点依赖，为一个特例把返回类型变成联合体，得不偿失。
 * 简报是小响应且秒级返回，用不上 `request()` 那套心跳保活与空闲重置。
 */
async function printBriefMarkdown(ctx, path) {
  const url = `${ctx.base}/api/v1${path}${path.includes("?") ? "&" : "?"}format=markdown`;
  let response;
  let text;
  try {
    response = await fetch(url, {
      method: "GET",
      // 两种都收：200 给 markdown，错误给 JSON 信封
      headers: { authorization: `Bearer ${ctx.token}`, accept: "text/markdown, application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(ctx.totalTimeoutMs),
    });
    text = await response.text();
  } catch (err) {
    // 与 request() 同口径：只回显 URL 与错误名，绝不回显请求头（内含令牌）
    process.stderr.write(
      `dj: 请求失败 GET ${url}\n    ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown"}\n`,
    );
    process.exit(EXIT.network);
  }
  if (response.status >= 200 && response.status < 300) {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    return;
  }
  let envelope = null;
  try {
    envelope = JSON.parse(text);
  } catch {
    /* 非 JSON 的错误体：下面按裸状态码报 */
  }
  handle(ctx, { status: response.status, envelope }, () => "");
}

/**
 * `copy <子命令>`：文案库——别人的爆款**是怎么写的**。
 *
 * 平台语料给**转写全文 + 结构化拆解**（钩子手段、段落节奏、金句、CTA、标题公式）。
 * 拿结构写自己的稿，别照搬原文。
 *
 * 两个仍然成立的约束：**检索只匹配钩子行**（正文不参与检索），
 * 别人的**用户私有条目**不给正文——那是各人自己的东西。
 */
async function cmdCopy(ctx, { positional, flags }) {
  const sub = positional[0];

  if (sub === "search" || sub === undefined) {
    const query = qs({
      keyword: flags.keyword,
      language: flags.language,
      vertical: flags.vertical,
      setId: flags.set,
      scope: flags.scope,
      tier: csvFlag(flags, "tier"),
      topicType: csvFlag(flags, "topic-type"),
      hookType: csvFlag(flags, "hook-type"),
      minScore: flags["min-score"],
      sort: flags.sort,
      limit: intFlag(flags, "limit", undefined),
      cursor: flags.cursor,
    });
    handle(ctx, await request(ctx, "GET", `/copy/entries${query}`), pretty.copyEntries);
    return;
  }

  if (sub === "get") {
    const id = positional[1];
    if (typeof id !== "string") fail("copy get 需要 <entryId>");
    handle(ctx, await request(ctx, "GET", `/copy/entries/${encodeURIComponent(id)}`), pretty.copyEntry);
    return;
  }

  if (sub === "import") {
    const file = typeof flags.body === "string" ? flags.body : undefined;
    if (!file) fail("copy import 需要 --body <正文文件路径>");
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      fail(`读不到正文文件：${file}`);
    }
    if (!body.trim()) fail("正文是空的");
    handle(
      ctx,
      await request(ctx, "POST", "/copy/entries", {
        body,
        ...(typeof flags.title === "string" ? { title: flags.title } : {}),
        ...(typeof flags.language === "string" ? { language: flags.language } : {}),
        ...(typeof flags.set === "string" ? { corpusSetId: flags.set } : {}),
        ...(typeof flags.creator === "string" ? { creator: flags.creator } : {}),
        ...(typeof flags["source-video-id"] === "string"
          ? { sourceVideoId: flags["source-video-id"] }
          : {}),
        ...(typeof flags["published-at"] === "string" ? { publishedAt: flags["published-at"] } : {}),
      }),
      (d, meta) =>
        [
          meta?.deduplicated
            ? "这段正文库里已经有了，收敛到同一行（幂等键 = 内容哈希），没有重复入库。"
            : "已入库。",
          `id ${d.id}　语言 ${meta?.language?.effective ?? d.language}` +
            `${meta?.language?.overridden ? "（你显式指定，覆盖了自动检测）" : ""}`,
          Object.entries(meta?.qualityFlags ?? {})
            .filter(([, v]) => v)
            .map(([k]) => `⚠ 质检提示：${k}`)
            .join("\n"),
        ]
          .filter(Boolean)
          .join("\n"),
    );
    return;
  }

  if (sub === "jobs") {
    const query = qs({ stage: csvFlag(flags, "stage"), limit: intFlag(flags, "limit", undefined) });
    handle(ctx, await request(ctx, "GET", `/copy/jobs${query}`), pretty.copyJobs);
    return;
  }

  if (sub === "retry") {
    const id = positional[1];
    if (typeof id !== "string") fail("copy retry 需要 <jobId>");
    handle(
      ctx,
      await request(ctx, "POST", `/copy/jobs/${encodeURIComponent(id)}/retry`, undefined),
      (d) => `已重排队：${d.id} → ${d.stage}（重试计数已归零）`,
    );
    return;
  }

  fail(
    "copy 子命令：search | get <entryId> | import --body <文件> | jobs | retry <jobId>",
  );
}

function versionVerdict(local, remote) {
  if (!local) return { ok: false, text: "本地 SKILL.md 读不到，无法判断版本" };
  if (!remote) return { ok: true, text: `本地 v${local.version}（线上版本拉取失败，跳过比对）` };
  if (local.version === remote.version) {
    return { ok: true, text: `本地 v${local.version} = 线上 v${remote.version}，已是最新` };
  }
  return {
    ok: false,
    text:
      `本地 v${local.version} ≠ 线上 v${remote.version}，请重新下载分发包更新：\n` +
      // URL 加引号：精简版地址带 `?`，zsh 不加引号会当通配符报 no matches found
      `      curl -fsSL "${skillBundleUrl("<base>", local.variant)}" -o rooyun-skill.zip && unzip -o rooyun-skill.zip -d ~/.claude/skills/`,
  };
}

/** `dj version`：报本地版本，并（尽力）比对线上。不需要令牌。 */
async function cmdVersion(ctx, { flags }) {
  const local = readLocalSkillMeta();
  const remote = await fetchRemoteSkillMeta(ctx.base, local.variant);
  const verdict = versionVerdict(local, remote);
  const payload = {
    local: local ?? null,
    remote: remote ?? null,
    upToDate: Boolean(local && remote && local.version === remote.version),
    base: ctx.base,
  };
  if (flags.pretty) {
    process.stdout.write(`${verdict.text}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}

/**
 * `dj update`：把线上最新的 skill 包覆盖到本地安装目录。不需要令牌。
 *
 * 为什么要有它：裸 skill 没有官方更新协议（Claude Code 只对 plugin 提供
 * `plugin update`），用户得自己记住那串 curl + unzip，还得知道自己装在哪。
 * 这条命令把这些都算好——它就装在那个目录里，最清楚路径。
 *
 * 覆盖的是**自己所在的 skill 目录**。Node 启动时已把脚本读进内存，覆盖当前文件
 * 不影响正在跑的这个进程；SKILL.md 是会话内实时生效的，脚本则从下次调用起用新版，
 * 两者都不需要重启 Claude Code。
 */
async function cmdUpdate(ctx, { flags }) {
  let skillDir = null;
  try {
    skillDir = pathDirname(pathDirname(fileURLToPath(import.meta.url)));
  } catch {
    skillDir = null;
  }
  // 只有「完整 skill 目录」才敢原地覆盖：判据是同级真有 SKILL.md。
  // Codex 等宿主常常只把 scripts/ 拷进项目里，那种布局下 skillDir 会算到项目根
  // （甚至项目外），照着解压等于在无关目录里凭空造一个 rooyun/，而用户真正在用的
  // 那份脚本一点没变——「更新成功了却没生效」比不更新更难查。
  const isFullInstall =
    skillDir !== null && existsSync(`${skillDir}/SKILL.md`);
  const local = readLocalSkillMeta();
  if (!isFullInstall) {
    const remoteMeta = await fetchRemoteSkillMeta(ctx.base, local.variant);
    process.stderr.write(
      `dj: 这份脚本不在完整的 skill 目录里（同级没有 SKILL.md），不敢猜该覆盖哪个目录。\n` +
        `    看着像 Codex 那种「只拷了 scripts/」的装法。请手工更新：\n` +
        `      curl -fsSL -o skill.zip ${ctx.base}/api/skill/bundle\n` +
        `      unzip -o skill.zip -d <解压到你放 rooyun-skill 的位置>\n` +
        `    然后把新的 AGENTS.snippet.md 重新粘进你的 AGENTS.md（那是快照，不会自己更新）。\n` +
        `    本地 v${local.version}${remoteMeta ? ` → 线上 v${remoteMeta.version}` : ""}\n`,
    );
    process.exit(EXIT.usage);
  }
  // 经 Claude Code 插件安装（公开仓库 DeepHiveAI/rooyun-skill 的 marketplace）时，脚本在插件缓存里：
  // 原地覆盖会在下次插件更新时被整目录换掉，版本还和插件记录对不上——交给插件自己的更新协议
  // 判据用插件缓存目录 `plugins/cache/`：设了 CLAUDE_CONFIG_DIR 时缓存不在 ~/.claude 下
  if (/[\\/]plugins[\\/]cache[\\/]/.test(skillDir)) {
    process.stderr.write(
      `dj: 这份 skill 是经 Claude Code 插件安装的，请用插件命令更新，再在会话里执行 /reload-plugins：\n` +
        `      claude plugin marketplace update rooyun\n` +
        `      claude plugin update ${local.variant === "cli" ? "rooyun-cli" : "rooyun"}@rooyun\n`,
    );
    process.exit(EXIT.usage);
  }
  const parent = pathDirname(skillDir);
  const remote = await fetchRemoteSkillMeta(ctx.base, local.variant);
  if (!remote) {
    fail(`拉取线上版本失败，检查 --base 是否指向 RooYun 站点：${ctx.base}`);
  }
  if (local && local.version === remote.version && !flags.force) {
    process.stdout.write(
      flags.pretty
        ? `已是最新（v${local.version}），无需更新。要强制重装加 --force\n`
        : `${JSON.stringify({ updated: false, version: local.version, reason: "already_latest" })}\n`,
    );
    return;
  }

  // 拉与本地同一个变体的包：精简版里跑 update 不能凭空装出一份完整版
  const zipUrl = skillBundleUrl(ctx.base, local.variant);
  const tmp = `${tmpdir()}/rooyun-skill-${randomUUID()}.zip`;
  if (flags["dry-run"]) {
    process.stdout.write(
      `将执行：\n  curl -fsSL -o ${tmp} "${zipUrl}"\n  unzip -o ${tmp} -d ${parent}\n`,
    );
    return;
  }

  // 先下到临时文件：下载失败时不会在安装目录留下半截内容
  let bytes;
  try {
    const response = await fetch(zipUrl);
    if (!response.ok) fail(`下载失败：HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    fail(`下载失败：${err instanceof Error ? err.message : "unknown"}`);
  }
  // zip 魔数校验：反代/登录墙返回 HTML 错误页时，unzip 的报错很难懂，不如这里直说
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    fail(`下载到的不是 zip（检查 --base 是否指向 RooYun 站点：${ctx.base}）`);
  }
  // 变体校验：zip 条目名以明文存在文件头里，顶层目录必须是本变体的。
  // 防的是 CDN 缓存键忽略查询串、把 `?variant=cli` 回成完整版包——照解不误就会在
  // 精简版旁边凭空装出一份完整版，两个 skill 抢着触发
  const expectedEntry = `${SKILL_NAME_BY_VARIANT[local.variant]}/SKILL.md`;
  if (!bytes.includes(Buffer.from(expectedEntry))) {
    fail(
      `下载到的包不含 ${expectedEntry}（拿到的不是${local.variant === "cli" ? "精简版" : "完整版"}），` +
        `未做任何改动。稍后重试，或按 README 手工安装`,
    );
  }
  writeFileSync(tmp, bytes);

  // 解压覆盖：Node 无内置 zip 解压，而本脚本零依赖不引第三方库，故调系统 unzip
  const result = spawnSync("unzip", ["-o", "-q", tmp, "-d", parent], {
    encoding: "utf8",
  });
  rmSync(tmp, { force: true });
  if (result.error || result.status !== 0) {
    // 没有 unzip（多见于 Windows）：给出手工命令，绝不假装成功
    process.stderr.write(
      `dj: 自动解压失败（${result.error?.message ?? `unzip 退出码 ${result.status}`}）。请手工执行：\n` +
        `    curl -fsSL -o skill.zip "${zipUrl}"\n` +
        `    unzip -o skill.zip -d ${parent}\n`,
    );
    process.exit(EXIT.apiError);
  }

  const after = readLocalSkillMeta();
  const payload = {
    updated: true,
    from: local?.version ?? null,
    to: after?.version ?? remote.version,
    skillDir,
  };
  process.stdout.write(
    flags.pretty
      ? `已更新：v${payload.from ?? "?"} → v${payload.to}（${skillDir}）\n` +
        `SKILL.md 立即生效；脚本从下次调用起用新版。\n`
      : `${JSON.stringify(payload)}\n`,
  );
}

/**
 * `dj doctor`：一条命令回答「我这套装置现在能不能正常干活」。
 *
 * 四项各自独立、互不阻断（一项失败仍跑完其余项）——自检的价值在于一次给出
 * 全部症状，而不是在第一个问题上停下让用户挤牙膏式地反复重跑。
 */
async function cmdDoctor(ctx, { flags }) {
  const checks = [];

  // ① 版本
  const local = readLocalSkillMeta();
  const remote = await fetchRemoteSkillMeta(ctx.base, local.variant);
  const verdict = versionVerdict(local, remote);
  checks.push({ name: "版本", ok: verdict.ok, detail: verdict.text });

  // ② 同名 skill 冲突（备份副本抢触发，是「更新了却没生效」的头号成因）
  const conflicts = detectSkillConflicts();
  checks.push({
    name: "安装唯一性",
    ok: conflicts.length === 0,
    detail:
      conflicts.length === 0
        ? "未发现 RooYun skill 的其它安装"
        : `发现 ${conflicts.length} 处 RooYun skill 的其它安装（触发时用哪份全看运气，只留一份，其余删除或改名）：\n` +
          conflicts
            .map(
              (c) =>
                `      ${c.dir}（${c.name === SKILL_NAME_BY_VARIANT.cli ? "精简版 rooyun-cli" : "完整版 rooyun"} ${c.version}）`,
            )
            .join("\n") +
          `\n      完整版与精简版二选一：要固定工程流程留 rooyun，要自己掌控提示词与流程留 rooyun-cli`,
  });

  // ③ 令牌来源（环境变量 or dj login 写下的凭据文件）
  checks.push({
    name: "令牌来源",
    ok: true,
    detail:
      ctx.tokenSource === "env"
        ? "环境变量 ROOYUN_API_TOKEN"
        : `本机凭据文件 ${CREDENTIALS_FILE}（dj login 写入）`,
  });

  // ④ 令牌与 scope（真调一次 /me；这是唯一需要令牌的一项）
  let me = null;
  try {
    const result = await request(ctx, "GET", "/me");
    const okAuth = Boolean(result.envelope?.ok);
    me = okAuth ? result.envelope.data : null;
    checks.push({
      name: "令牌",
      ok: okAuth,
      detail: okAuth
        ? `有效，scope：${(me?.scopes ?? []).join(" / ") || "（无）"}`
        : `无效：${result.envelope?.error?.code ?? `http_${result.status}`} — ${result.envelope?.error?.message ?? ""}`,
    });
  } catch (err) {
    checks.push({
      name: "令牌",
      ok: false,
      detail: `校验请求失败：${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // ⑤ 余额（能不能真的干活——scope 齐全但没积分同样寸步难行）
  if (me) {
    try {
      const wallet = await request(ctx, "GET", "/billing/wallet");
      const data = wallet.envelope?.data;
      // 计费整体关闭时 enabled=false：这不是故障，此刻余额无意义，判定为通过
      const enabled = data?.enabled !== false;
      const balance = data?.balance;
      const held = data?.held;
      checks.push({
        name: "余额",
        ok: !enabled || (typeof balance === "number" && balance > 0),
        detail: !enabled
          ? "计费未开启（本站当前不扣积分）"
          : typeof balance === "number"
            ? `${balance} 积分可用${held ? `，另有 ${held} 冻结中` : ""}` +
              `${balance > 0 ? "" : "（为零，生成类调用会被 402 拒绝）"}`
            : "读不到余额字段",
      });
    } catch {
      checks.push({ name: "余额", ok: false, detail: "余额查询失败" });
    }
  }

  const allOk = checks.every((c) => c.ok);
  if (flags.pretty) {
    process.stdout.write(
      `${checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}　${c.detail}`).join("\n")}\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify({ ok: allOk, base: ctx.base, checks })}\n`);
  }
  if (!allOk) process.exit(EXIT.apiError);
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

const HELP = `dj.mjs · RooYun 开放 API v1 客户端（零依赖，Node ≥ 18）

用法：
  dj.mjs <命令> [参数] [全局选项]

登录（首次使用只需这一步，令牌自动保存到本机 ~/.rooyun/credentials.json）：
  dj.mjs login       打开浏览器让用户点「授权」，再运行一次即完成；之后所有命令自动带令牌
  dj.mjs logout      删除本机保存的凭据（不吊销令牌）

环境变量（可选；设了就优先于本机凭据文件）：
  ROOYUN_API_TOKEN   个人访问令牌。只从环境读，永不打印。旧名 DUANJU_API_TOKEN 仍然可用。
  ROOYUN_API_BASE    站点地址，默认 ${DEFAULT_BASE}（旧名 DUANJU_API_BASE 仍然可用）

全局选项：
  --base <url>       覆盖站点地址（本地开发：http://127.0.0.1:3000）
  --pretty           人类可读输出（默认输出原始 JSON 信封，便于机器解析）
  --request-timeout <秒>  单次请求的**空闲**超时（多久没收到字节算死），默认 ${DEFAULT_IDLE_TIMEOUT_MS / 1000}
  --total-timeout <秒>    单次请求的总超时，默认 ${DEFAULT_TOTAL_TIMEOUT_MS / 1000}（拆分镜最慢可达 15 分钟）
  --help             本帮助

命令：
  login [--name <令牌名>] [--no-browser] [--wait-seconds N] [--force]
                                        设备授权登录（**不需令牌**）：第一次运行申请授权码并打开浏览器，
                                        再运行一次等待用户点「授权」并保存令牌；等待超时退出码 6，再跑即可
  logout                                删除本机凭据（**不需令牌**）
  me                                    令牌自省：owner / scope / 限额与已用额度
  uuid                                  生成一个 uuid（用作 generate 的幂等键 requestId）
  version                               本地 skill 版本 + 与线上比对（**不需令牌**）
  update [--force] [--dry-run]          把线上最新 skill 覆盖到本地安装目录（**不需令牌**）
  doctor                                一键自检：版本 / 同名安装冲突 / 令牌 scope / 余额
                                        「更新了却没生效」「明明配了令牌却报错」先跑它
  models [--capability <cap>]           模型目录与单价（pricing 为 null = 未配价，提交必被拒）
  voices [--q <关键词>] [--limit N] [--offset N]
                                        音色目录（配音前先挑嗓子）。kind=system 填 params.voiceId，
                                        kind=user 填 params.voiceName；id 原样回传别 trim
  digital-humans                        专属数字人目录（**仅管理员可见**，非管理员恒为空列表）。
                                        avatar 口播：--params "digitalHumanId=<id>,drivingAudio=<配音assetId>"，
                                        形象图不用传（不能再给 firstFrame / motionVideo），只支持口播
  character-voices <canvasId>           角色定嗓绑定表 + 待定嗓名单（出对白镜头前先跑它）
  character-voices <canvasId> --bind <角色名> --sample <音频assetId> [--label "试镜样本"]
  character-voices <canvasId> --unbind <角色名>
  character-voices <canvasId> -f body.json
                                        增量写绑定（角色名必须与 knownCharacters 逐字一致——
                                        写错不报错但生成时静默不注入，服务端会顶回去 404）。
                                        试镜定嗓全流程见 SKILL.md「角色音色一致性」一章

  projects list [--limit N] [--offset N]
  projects create <name>                建项目（同时得到首画布 canvasId 与浏览器 url）

  canvas list <projectId>               列项目下的全部画布（接着上次的工作先跑它——附加画布的
                                        canvasId 只在创建那一次返回过，不列就只能再建一张）
  canvas create <projectId> <name>      在既有项目里再建一张画布
  canvas structure <canvasId>           读回结构（拿 nodeId/assetIds；version 仅条件写时才用）
                   [--full]             每张卡附带全文 + 全部可写参数（整张画布一次读全；
                                        大画布响应会很大，只要拓扑时别带）
  canvas lint <canvasId>                画布体检（纪律 10 的门禁；只读、不扣积分）：
                                        视频卡缺参考 / 被引用的设定板还没出图 / 空引用坞连了下游 /
                                        提示词点了设定板的名字却没连它（改过 prompt 后最容易撞上）。
                                        **有 error 就别提交生成**——修完重跑，errors 归零再报价。
                                        有 error 时退出码 2，可直接写进脚本卡流水线。
                                        末尾还打印**参考预演**：每张待出片视频卡的
                                        <Picture i> ↔ 是谁，顺序与提交时逐位一致——
                                        写提示词照抄它，别猜编号（不带 --pretty 时是 JSON）
  node <canvasId> <nodeId>              详读单卡：正文全文、可写参数快照、上下游
                                        （精确改卡前先读它——structure 的摘要截断在 600 字）

  upload <path>                         上传本地素材换 assetId（≤50MB，需 assets:write）
                                        幂等：同一份字节重传只有一个 id，deduplicated=true

  ops <canvasId> [-f batch.json] [--if-version N]
                                        执行 ops 批次（stdin 或 -f；1–50 个 op，整批原子）
                                        --if-version 默认别给：不给才有服务端自动重读重放
                                        输入可为 {ops:[…]} / 裸数组 / 单个 op 对象

  —— LLM 分析（需 llm scope；前三条与 caption **扣积分**，inspect 不扣但受限流）——
  extract <characters|scenes|props> --script <剧本文件>
          [--existing 名字,名字] [--model <id>] | [-f body.json]
                                        剧本 → 结构化角色/场景/道具。**只返数据不落卡**，
                                        改完用 ops 的 create*Board 写进画布
  storyboard --script <剧本文件> [--cast 名字,…] [--scenes 地点,…]
             [--anchors <anchors.json>] [--bible <圣经文件>]
             [--segment-max-sec <2-15>] [--model <id>] | [-f body.json]
                                        剧本 → 结构化分镜（场景→镜头两级）。同样不落卡。
                                        --anchors：extract characters 的 shotInjection 映射成
                                        [{name,anchor}]（不传则每镜重新想象角色长相）。
                                        回写用 storyboard-fall（别自己写 jq）
  storyboard-fall <canvasId> -f <storyboard响应.json> [--script <剧本文本卡nodeId>]
                 [--aspect 9:16] [--dry-run]
                                        把上一条的产物按场次落成分镜视频卡：每场一批
                                        createStoryboard kind:"video" + layout:"grouped"，
                                        段字段（title/videoPrompt→prompt/durationSec/audio/
                                        cast/props）原样传回，空名兜底、超 30 段自动拆批。
                                        落出来是站内「提取分镜」同款（引用坞+网格+编组）。
                                        --script：视频卡带站内同款 shotOf 与组名（不传站内
                                        会判「没拆过分镜」再落一套重复卡），务必传。
                                        输出汇总信封：各批 nodeIds/noop + unmatchedNames
                                        （点名的名字 = 没有设定板，回去补建出图再补边）。
                                        禁止 createCard kind:"video" 手搓、禁止自拼 prompt
  rewrite <edit|optimize|translate|lyrics> (--text "…" | --script <path>)
          [--instruction "…"] [--model <id>] | [-f body.json]
                                        改写/优化/翻译/写词。edit 必须给 --instruction；
                                        translate 不接受 --instruction
  caption image <assetId>
  caption video --frames <assetId,…> --duration <秒> [--times t1,t2,…] [--dialogue "…"]
                                        反推提示词。素材一律 assetId（先 dj.mjs upload），
                                        视频要**你自己抽好帧**：服务端不抽帧
  inspect <assetId> [--prompt "…"] [--scene-name 名 --scene-asset <assetId>]
          [--dimensions integrity,character_consistency,prompt_adherence] | [-f body.json]
                                        分镜图质检。判角色一致性要传分组过的定妆照，
                                        用 -f body.json 传 context.characterRefs

  —— 多轮 Agent 会话（纪律 13；需 llm scope；**每轮扣积分**）——
  agents                                Agent 目录：id / conversational / billing.stagesPerTurn。
                                        报价直接读 chat new / chat show 的 meta.estimatedTurnCredits
  chat new --agent <agentId> [--model <id>] [--title "…"] [--params-json '{…}']
                                        开一段会话（不扣钱）。Agent 建好就定死、**中途不可换**；
                                        换 Agent = 新建一段。记下 conversationId——它就是全部状态。
                                        回执 meta.estimatedTurnCredits = 预计一轮多少积分（报价读它）
  chat send <conversationId> --request-id <uuid> "<一句话>"
            [--attach-file a.txt,b.md] [--ref <artifactId>,…] [--regenerate]
            [--model <id>] [--params-json '{…}']
                                        发一轮（**扣积分，先报价再发**）。requestId 必填：
                                        同键重发返回同一轮且不重复扣费（\`dj.mjs uuid\` 现取）。
                                        --attach-file 读本地纯文本成内联附件
                                        （≤${MAX_TURN_ATTACHMENT_FILES} 个、单个 ≤${MAX_TURN_ATTACHMENT_CHARS} 字；
                                        与 --ref 共用「≤${MAX_TURN_MATERIAL_ITEMS} 条 / ≤${MAX_TURN_MATERIAL_CHARS} 字」的联合预算）。
                                        --ref 只给 artifactId，正文由服务端现取——别把稿子贴回来。
                                        --model 换模型：本轮生效且会话往后沿用
  chat history <conversationId> [--after-seq N] [--limit N]
                                        读历史（seq 游标，正文截 200 字）。--after-seq 传上次的
                                        meta.lastSeq 做增量拉取
  chat show <conversationId>            会话元信息 + 最近一轮全文（含产物逐稿）。
                                        meta.estimatedTurnCredits = 下一轮的报价（null=未配价，会被拒）
  chat delete <conversationId>          删掉这段会话与它的全部消息。**硬删、不可撤销**
                                        （网页端也没了），删前先跟用户确认。
                                        不退款、不动账本——删会话省不下钱，只是丢上下文
  chats [--agent <agentId>] [--limit N] [--offset N]
                                        列会话（**上下文丢了就用它**，含网页端建的）。
                                        别新建会话重头说一遍——那是重付每一轮的钱

  —— 人工介入编辑（纪律 9；需 canvas:write）——
  edit-session create <canvasId> <nodeId> [--hint "预填的要求"] [--ttl <1-15 分钟>]
                                        签一条免登录编辑链接交给用户涂（局部重绘选区）。
                                        源图由服务端从那张卡读，**nodeId 必须已经出过图**。
                                        ⚠️ 响应 url 含明文令牌＝凭据：只转述给用户本人，
                                        并**必须一起说明 expiresAt**（默认 15 分钟）
  edit-session status <sessionId>       查状态：pending / submitted / expired / revoked。
                                        submitted 时 result.maskAssetId 就是蒙版，
                                        拿去 t2i + --reference <源图> + params.mask 局部重绘
  edit-session revoke <sessionId>       撤销还没被用的链接（幂等；已提交的返 409）

  precheck [-f items.json]              批量报价（≤100 项）
  precheck --model <id> --capability <cap> [--params k=v,…|--params-json '{…}']
                                        单项快捷报价

  generate [-f body.json] [--request-id <uuid>]
  generate --request-id <uuid> --model <id> --capability <cap>
           [--params k=v,… | --params-json '{…}']
           [--canvas <canvasId> --node <nodeId>] [--reference <assetId,…>]
           [--reference-audio <assetId,…>] [--reference-video <assetId,…>]
                                        提交生成。**requestId 必填**（幂等键，重试原样复用）。
                                        --reference-audio 仅 ref2v（锁音色，≤3 段、每段 2–15s
                                        wav/mp3；顺序即提示词 <Audio j> 编号），见「角色音色一致性」
                                        --reference-video 仅 ref2v（动作/运镜参考，≤3 段视频资产，
                                        模型须声明参考视频能力；顺序即提示词 <Video k> 编号），
                                        白模换角：先 --capability blockout --params sourceVideo=<原片>
                                        出白模片，再把它当 --reference-video 喂 ref2v，见「白模换角」

  task <taskId> [--watch] [--timeout <秒>]
                                        查任务；--watch 轮询到终态（间隔遵守服务端建议，退避封顶 ${POLL_MAX_MS / 1000}s）
  tasks [--status active|all] [--canvas <canvasId>] [--request <requestId>] [--limit N]
                                        列生成任务（**状态丢了就用它**）：缺省只列在途，
                                        回答「我还有什么没跑完」。status 是库里的快照、
                                        不轮询上游——要准确状态仍用 task <taskId>
  cancel <taskId>                       取消（只有排队中的能真停住）

  assets list [--project <projectId>] [--mime image|video|audio] [--limit N] [--offset N]
  assets get <assetId>                  单条资产元数据
  wallet                                钱包余额与冻结
  ledger [--token-id self] [--limit N] [--offset N]
                                        账单流水；--token-id self 只看当前这枚令牌

博主分析（scope creators:read；转存另需 assets:write + assets:read 取文件）：
  creator-resolve <链接或口令>            抖音分享链接 → 博主资料 + 作品列表（不含播放直链）
                                          ⚠️ 主页作品列表已被抖音封锁：主页链接只回 secUid，样本请点名
  video-url <链接或口令>                  抖音**单条视频**链接 → 可直接下载的视频直链
                                          （主页链接当前拿不到列表，见纪律 15）
                                        （不转存；curl -L 即可下，直链数周内失效，拿到就下）
  creator-analyze <secUid> <videoId> <videoId> … [--no-wait] [--timeout <秒>] [--request <幂等键>]
                                        发起分析并等到终态（默认等，间隔 ${ANALYZE_POLL_MS / 1000}s）。
                                        **videoIds 必须点名**：不给则服务端要拉主页作品列表，
                                        而该接口已被抖音封禁，大概率回 502（见纪律 15）
  creator-analysis <jobId>              查一次分析进度（不等）
  reference-analyze (<链接|口令|视频id> | --asset <assetId>) [--no-wait] [--timeout <秒>] [--request <幂等键>] [--out account.json] [--timeline-md TIMELINE.md]
                                        拆解一条参考视频为逐镜「分段实现账」（默认等到终态，5–15 分钟）
                                        ★扣积分 0.1/秒 × 源视频时长（后续改编不另收费，失败自动退款）
  reference-analysis <jobId> [--out …] [--timeline-md …]   查一次拆解进度（不等）
  reference-compare <参考片jobId> <成片jobId>  复刻验收：结构 diff（纯计算，不花钱）
                                        成片先 reference-analyze --asset <assetId> 拆一遍
  reference-template <jobId> <jobId> …     2–12 条拆解 → 赛道结构模板（纯计算，不花钱）
                                        骨架 + 每环节出现率 + 组成占比 + 必保共识
  reference-adapt <jobId> --presenter "…" --product "…" [--setting/--vertical/--language/--pacing/--dialogue/--shot-composition "…"]
                          [--brief "…"] [--duration 60] [--request <幂等键>] [--out a.json] [--script-md SCRIPT.md]
                                        按变换维度改编（同步，十几到几十秒）：同一套结构、不同内容
                                        命中该段「必保」维度的不改并如实标注，function/intent 原样保留
  reference-frames <jobId> (--shot <镜号> | --shots <镜号,…> | --range <秒-秒> | --around <台词>)
                           [--fps 2] [--cols 4] [--out <目录>] [--video <已下好的原片>] [--json]
                                        **自己看画面**：本机 ffmpeg 抽帧 + 拼一张网格图 + 图例
                                        （账本的 visual 是模型说的；复核 proofUnverified 用这个）
  creator <secUid>                      读账号画像：详细资料 + 仿写提示词 stylePrompt
  creator-report <secUid> <videoId>     读单视频报告 + ASR 转写全文
  creator-archive <secUid> <videoId>    把原片转存进资产库 → assetId
                                        （取文件用 download.mjs --asset <assetId> --out ./out）

选题情报（雷达 / 简报 / 文案库；全部**不扣积分**，共用「选题雷达」账号权益）：
  brief [<id或YYYY-MM-DD>] [--md]       每日频道简报：选题 + 可执行性 + 对标参考
                                        不带参数 = 最近一份；--md 出可直接给用户看的全文
  brief list [--date d] [--limit n] [--cursor c]      历史简报
  brief rebuild [--date d]              重建当日简报（只能今天或昨天，不花钱、不调模型）
  radar sources                         我订阅的对标博主
  radar watch <主页链接>                 订阅（幂等；收链接不收 secUid）
  radar unwatch <sourceId>              退订（只删订阅，全局源与历史序列保留）
  radar items [--sort s] [--window 24h|7d|30d] [--platform p] [--source id] [--limit n]
                                        作品按**窗口内增量**排序（不是绝对值）
  radar item <itemId> [--window w]      单条详情
  radar metrics <itemId> [--from t] [--to t]          原始快照序列（不插值不补零）
  radar followers <sourceId> [--from t] [--to t]      粉丝日粒度序列
  radar hot [--boards a,b] [--limit n]  热榜 + 生命周期
  radar daily [--date d]                每日选题报告（自带成稿 markdown）
  copy search [--keyword k] [--language zh|en|other] [--vertical v] [--set id]
              [--tier S,A] [--topic-type t] [--hook-type h] [--sort s] [--limit n]
                                        别人的爆款**怎么写的**；检索只匹配钩子行
  copy get <entryId>                    单条：钩子 + 段落节奏 + 金句 + CTA
  copy import --body <文件> [--title t] [--language l] [--set id]      导入自己的文案
  copy jobs [--stage s]                 提取队列（只列你自己触发的）
  copy retry <jobId>                    重试（只有 failed 能重试）

退出码：
  0 成功 / 任务 succeeded      1 用法或配置错误        2 API 业务错误
  3 402（余额不足 / 令牌限额）  4 429（限流 / 下载配额）  5 网络或响应异常
  6 --watch 超时（任务仍在跑）  7 任务终态但非 succeeded

纪律提醒：任何 generate 之前先 precheck 并把预计消耗报给用户等确认。
博主分析的 partial 是**终态但不是失败**（退出码 0）：逐条报告已产出可读，只是没出账号画像。
`;

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/* ---------------------------------------------------------------------------
 * 博主分析域：解析链接 → 发起分析 → 读产物 → 取原片
 * ------------------------------------------------------------------------- */

/** `creator-resolve <链接或口令>`：拿 secUid 与作品列表（不含播放直链） */
async function cmdCreatorResolve(ctx, { positional, flags }) {
  const input = positional.join(" ").trim() || (typeof flags.input === "string" ? flags.input : "");
  if (!input) fail("creator-resolve 需要一个抖音分享链接或分享口令全文");
  handle(
    ctx,
    await request(ctx, "POST", "/creators/resolve", { input }),
    pretty.creatorResolve,
  );
}

/** `creator <secUid>`：读账号画像（详细资料 + 仿写提示词） */
async function cmdCreator(ctx, { positional, flags }) {
  const secUid = positional[0] ?? flags.sec;
  if (typeof secUid !== "string") fail("creator 需要 secUid（从 creator-resolve 拿）");
  handle(
    ctx,
    await request(ctx, "GET", `/creators/${encodeURIComponent(secUid)}`),
    pretty.creatorProfile,
  );
}

/** `creator-report <secUid> <videoId>`：读单视频报告 + 转写全文 */
async function cmdCreatorReport(ctx, { positional }) {
  const [secUid, videoId] = positional;
  if (typeof secUid !== "string" || typeof videoId !== "string") {
    fail("creator-report 需要 <secUid> <videoId>");
  }
  handle(
    ctx,
    await request(
      ctx,
      "GET",
      `/creators/${encodeURIComponent(secUid)}/videos/${encodeURIComponent(videoId)}/report`,
    ),
    pretty.creatorReport,
  );
}

/**
 * `video-url <链接或口令>`：拿可直接下载的视频直链（不转存、不占资产库）。
 * 同一端点、只是显式索取 playUrl：视频链接得一条；主页链接当前拿不到列表（抖音封了那个接口），
 * 只会回空列表 + videoListUnavailable。
 * 直链短时效，脚本只打印、不落盘——下载交给调用方（curl -L 即可，无需防盗链头）。
 */
async function cmdVideoUrl(ctx, { positional, flags }) {
  const input = positional.join(" ").trim() || (typeof flags.input === "string" ? flags.input : "");
  if (!input) fail("video-url 需要一个抖音单条视频的分享链接或口令全文（主页链接当前拿不到列表）");
  handle(
    ctx,
    await request(ctx, "POST", "/creators/resolve", { input, withPlayUrl: true }),
    pretty.videoUrl,
  );
}

/** `creator-archive <secUid> <videoId>`：把原片转存进资产库，拿 assetId */
async function cmdCreatorArchive(ctx, { positional }) {
  const [secUid, videoId] = positional;
  if (typeof secUid !== "string" || typeof videoId !== "string") {
    fail("creator-archive 需要 <secUid> <videoId>");
  }
  handle(
    ctx,
    await request(
      ctx,
      "POST",
      `/creators/${encodeURIComponent(secUid)}/videos/${encodeURIComponent(videoId)}/archive`,
    ),
    pretty.creatorArchive,
  );
}

/**
 * `creator-analyze <secUid> [videoId...]`：发起分析。
 *
 * 默认**等到终态**（轮询 + 退避），`--no-wait` 只提交就返回。
 * 与生成任务的 watch 同则：限流不判失败（退避续等）、超时不判失败（任务还在跑）。
 */
async function cmdCreatorAnalyze(ctx, { positional, flags }) {
  const secUid = positional[0];
  if (typeof secUid !== "string") fail("creator-analyze 需要 secUid（从 creator-resolve 拿）");
  const videoIds = positional.slice(1);
  // 不点名 = 让服务端从主页作品列表里自动挑，而那条上游腿已被抖音封锁（纪律 15）。
  // 不做硬性拦截（将来解封了自动模式仍然成立），但要在白等一轮之前先提醒
  if (videoIds.length === 0) {
    process.stderr.write(
      "dj: 未点名 videoIds —— 服务端要去拉博主主页作品列表，而该接口已被抖音封锁，大概率回 502。\n" +
        "    正确做法：向用户要 ≥2 条单条视频链接，逐条 `dj.mjs creator-resolve <链接>` 取 videoId，\n" +
        `    再 \`dj.mjs creator-analyze ${secUid} <videoId> <videoId> …\`\n`,
    );
  }

  // 幂等键：`--request-id` 与 generate 同名（那边是必填），这里可省——省了就随机生成。
  // 它的作用范围是**跨进程重跑**：同一个键重发不会让 GPU 白跑两遍
  const requestId =
    typeof flags["request-id"] === "string"
      ? flags["request-id"]
      : typeof flags.request === "string"
        ? flags.request
        : randomUUID();
  const submitResult = await request(ctx, "POST", "/creator-analyses", {
    secUid,
    ...(videoIds.length > 0 ? { videoIds } : {}),
    requestId,
  });

  // 只提交不等：提交信封就是本次调用的产物，正常落 stdout
  if (flags["no-wait"]) {
    handle(ctx, submitResult, pretty.creatorAnalysisSubmitted);
    return;
  }

  // 等待模式：**stdout 只能有一个信封**（文件头契约：stdout 可直接 JSON.parse）。
  // 提交回执改走 stderr——连发两个 JSON 会让 `JSON.parse(stdout)` 直接抛错，
  // `jq '.data.status'` 也会输出两行，做终态判断的脚本必然误判
  if (submitResult.status < 200 || submitResult.status >= 300 || !submitResult.envelope?.ok) {
    handle(ctx, submitResult, pretty.creatorAnalysisSubmitted); // 内部会打印并退出
    return;
  }
  const jobId = submitResult.envelope.data?.jobId;
  if (typeof jobId !== "string") {
    process.stderr.write("dj: 提交响应里没有 jobId，无法继续等待\n");
    process.exit(EXIT.apiError);
  }
  process.stderr.write(
    `dj: 已提交 jobId=${jobId}（中断后可用 \`dj.mjs creator-analysis ${jobId}\` 续查）\n`,
  );
  const path = `/creator-analyses/${encodeURIComponent(jobId)}`;
  // 分析以分钟计（GPU 单条硬超时 540s），默认等得比生成任务更久
  const timeoutMs = intFlag(flags, "timeout", DEFAULT_ANALYZE_TIMEOUT_S) * 1000;
  const deadline = Date.now() + timeoutMs;
  let interval = ANALYZE_POLL_MS;
  let last = null;

  for (;;) {
    const result = await request(ctx, "GET", path);
    if (result.status === 429) {
      interval = Math.min(interval * 2, ANALYZE_POLL_MAX_MS);
      if (Date.now() + interval > deadline) break;
      if (ctx.pretty) process.stderr.write(`dj: 被限流，退避 ${interval}ms 后继续轮询\n`);
      await sleep(interval);
      continue;
    }
    if (result.status < 200 || result.status >= 300 || !result.envelope?.ok) {
      handle(ctx, result, pretty.creatorAnalysis);
      return;
    }
    last = result;
    const status = result.envelope.data?.status;
    if (status === "succeeded" || status === "partial" || status === "failed") {
      emit(ctx, result.envelope, pretty.creatorAnalysis);
      // partial 不是失败：逐条报告已产出可读，只是没有账号画像
      process.exit(status === "failed" ? EXIT.taskNotSucceeded : EXIT.ok);
    }
    if (ctx.pretty) {
      const done = result.envelope.data?.succeededVideoIds?.length ?? 0;
      const total = result.envelope.meta?.total ?? "?";
      process.stderr.write(`dj: ${status}　已出报告 ${done}/${total}，${interval}ms 后再查\n`);
    }
    if (Date.now() + interval > deadline) break;
    await sleep(interval);
  }

  if (last) emit(ctx, last.envelope, pretty.creatorAnalysis);
  process.stderr.write(
    `dj: 等待超时（${Math.round(timeoutMs / 1000)}s），分析仍在进行——不是失败，稍后用 \`dj.mjs creator-analysis ${jobId}\` 再查。\n`,
  );
  process.exit(EXIT.watchTimeout);
}

/** `result.reliability` 一行：先说各字段能信到什么程度，再让读者看内容 */
function renderReliabilityLine(rel) {
  if (!rel) return "";
  const low = (rel.dimensions ?? []).filter((d) => d.signal === "low-signal").map((d) => d.dimension);
  const dialogue = { timed: "逐镜台词可靠", untimed: "只有全文，逐镜台词不可用", none: "无人声" }[rel.dialogue] ?? rel.dialogue;
  const fn = typeof rel.function === "object" && rel.function ? rel.function : { level: String(rel.function), issues: [] };
  const issues = fn.issues?.length ? `\n    ⚠️ 需复核：${fn.issues.join("；")}` : "";
  const unverified = rel.proofUnverified?.length ? ` · proof 未经画面确认 [${rel.proofUnverified.map((i) => `#${i}`).join(",")}]` : "";
  return `可信度  功能标签 ${fn.level} · 台词 ${dialogue}${unverified}${
    low.length ? ` · 无区分力维度 [${low.join(",")}]（从不进 adaptable 却一刀切标 preserve，别据此判断能不能换）` : ""
  }${issues}`;
}

/**
 * 把拆解产物渲染成 TIMELINE.md 骨架（references/reference-video.md 第三步）。
 * 账本给的字段原样进表，人的判断写在「▶ 判读」之后——事实与推断分开是那份文档的硬纪律。
 */
function renderReferenceTimelineMd(d) {
  const a = d.result.account;
  const diag = d.result.diagnostics ?? {};
  const list = (xs) => (xs?.length ? xs.join(", ") : "无");
  const head = [
    `# TIMELINE · ${d.videoId}${d.title ? ` · ${d.title}` : ""}`,
    "",
    "> 由 `dj reference-analyze --timeline-md` 生成的骨架。每镜下面补两样：这一镜服务于哪句台词/动作；",
    "> 复刻时保留什么、重设计什么。账本字段是模型产出（\"模型说\"），你的判断写在「▶ 判读」之后——分开写。",
    "",
    `- 骨架：${a.spine}`,
    `- 转写来源：${d.transcriptSource ?? "?"}${d.transcriptSource === "whisper" ? "（无时间戳，各镜台词为空）" : ""}`,
    `- 无帧镜头：${list(diag.shotsWithoutFrames)} · 画面层失败：${list(diag.visualFailures)} · 结构层漏段：${list(diag.missingStructureIndices)}`,
    `- ${renderReliabilityLine(d.result.reliability) || "可信度：（无）"}`,
    `- 功能序列：${a.segments.map((s) => s.function).join(" ")}`,
    "",
  ];
  const body = a.segments.flatMap((s) => [
    `## #${s.index} · ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s · ${s.function} · c=${s.confidence.toFixed(2)}`,
    "",
    ...(s.sourceSpans?.length ? [`- 合并自原始切镜：${s.sourceSpans.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}s`).join(" / ")}`] : []),
    `- 台词：${s.dialogue || "（无）"}`,
    `- 画面：${s.visual || "（无画面证据——帧预算没覆盖到或画面层失败，系统刻意留空）"}`,
    `- 意图：${s.intent}`,
    `- 可换：[${(s.adaptable ?? []).join(", ")}] · 必保：[${(s.preserve ?? []).join(", ")}]`,
    "- ▶ 判读：（待补：服务于哪句话/哪个动作；复刻时保留什么、重设计什么）",
    "",
  ]);
  return [...head, ...body].join("\n");
}

/** `--out` / `--timeline-md` 落盘；只在 succeeded 且有产物时写 */
function writeReferenceArtifacts(flags, d) {
  if (!d?.result?.account) return;
  const write = (file, content, label) => {
    mkdirSync(pathDirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    process.stderr.write(`dj: ${label}已写入 ${file}\n`);
  };
  if (typeof flags.out === "string") write(flags.out, `${JSON.stringify(d.result, null, 2)}\n`, "产物 JSON ");
  if (typeof flags["timeline-md"] === "string") write(flags["timeline-md"], renderReferenceTimelineMd(d), "TIMELINE 骨架");
}

/**
 * `reference-analyze <链接|口令|视频id>`：发起参考视频拆解，默认等到终态（5–15 分钟）。
 * 提交→等待模式与 creator-analyze 同款；stdout 只有一个信封（终态那份），提交回执走 stderr。
 * 幂等键同 generate 的 `--request-id`，省了就随机生成——重跑不会让 GPU 白跑两遍。
 */
async function cmdReferenceAnalyze(ctx, { positional, flags }) {
  const input = positional.join(" ").trim() || (typeof flags.input === "string" ? flags.input : "");
  // --asset：拆资产库里的视频（多半是你自己的成片，用于复刻验收）；与 input 二选一
  const assetId = typeof flags.asset === "string" ? flags.asset.trim() : "";
  if (!input && !assetId) {
    fail("reference-analyze 需要一条抖音**单条视频**的分享链接、口令全文或视频 id（主页链接不行，要拆博主用 creator-analyze）；拆自己的成片用 --asset <assetId>");
  }
  if (input && assetId) fail("--asset 与视频链接二选一，不能同时给");
  const requestId =
    typeof flags["request-id"] === "string"
      ? flags["request-id"]
      : typeof flags.request === "string"
        ? flags.request
        : randomUUID();
  const submitResult = await request(ctx, "POST", "/reference-decompositions", {
    ...(assetId ? { assetId } : { input }),
    requestId,
  });

  if (flags["no-wait"]) {
    handle(ctx, submitResult, pretty.referenceSubmitted);
    return;
  }
  // 409 reference_job_active：账号已有一条在跑，默认转为等它——这条命令的语义就是「等到终态」，
  // 等别人那条与等自己这条对调用方没区别（等完再重发本条即可）
  const activeJobId = submitResult.envelope?.error?.code === "reference_job_active" ? submitResult.envelope?.meta?.activeJobId : null;
  if (submitResult.status < 200 || submitResult.status >= 300 || !submitResult.envelope?.ok) {
    if (typeof activeJobId !== "string") {
      handle(ctx, submitResult, pretty.referenceSubmitted); // 内部会打印并退出
      return;
    }
    process.stderr.write(`dj: 拆解队列已满（在跑 ${activeJobId} + 排队 ${submitResult.envelope?.meta?.queued ?? "?"} 条），本条**未提交**；先等在跑的那条到终态（等完请重发本条）\n`);
  }
  const jobId = typeof activeJobId === "string" ? activeJobId : submitResult.envelope.data?.jobId;
  if (typeof jobId !== "string") {
    process.stderr.write("dj: 提交响应里没有 jobId，无法继续等待\n");
    process.exit(EXIT.apiError);
  }
  if (!activeJobId) process.stderr.write(`dj: 已提交 jobId=${jobId}（中断后可用 \`dj.mjs reference-analysis ${jobId}\` 续查）\n`);
  const path = `/reference-decompositions/${encodeURIComponent(jobId)}`;
  const timeoutMs = intFlag(flags, "timeout", DEFAULT_ANALYZE_TIMEOUT_S) * 1000;
  const deadline = Date.now() + timeoutMs;
  let interval = ANALYZE_POLL_MS;
  let last = null;

  for (;;) {
    const result = await request(ctx, "GET", path);
    if (result.status === 429) {
      interval = Math.min(interval * 2, ANALYZE_POLL_MAX_MS);
      if (Date.now() + interval > deadline) break;
      if (ctx.pretty) process.stderr.write(`dj: 被限流，退避 ${interval}ms 后继续轮询\n`);
      await sleep(interval);
      continue;
    }
    if (result.status < 200 || result.status >= 300 || !result.envelope?.ok) {
      handle(ctx, result, pretty.referenceAnalysis);
      return;
    }
    last = result;
    const d = result.envelope.data;
    if (d?.status === "succeeded" || d?.status === "failed") {
      writeReferenceArtifacts(flags, d);
      emit(ctx, result.envelope, pretty.referenceAnalysis);
      process.exit(d.status === "failed" ? EXIT.taskNotSucceeded : EXIT.ok);
    }
    if (ctx.pretty) {
      const stage = d?.gpuStage ? `(${d.gpuStage})` : d?.visualProgress ? `(画面层已 ${d.visualProgress.done} 镜)` : "";
      process.stderr.write(`dj: ${d?.status} · ${d?.phase}${stage}，${interval}ms 后再查\n`);
    }
    if (Date.now() + interval > deadline) break;
    await sleep(interval);
  }

  if (last) emit(ctx, last.envelope, pretty.referenceAnalysis);
  process.stderr.write(
    `dj: 等待超时（${Math.round(timeoutMs / 1000)}s），拆解仍在进行——不是失败，稍后用 \`dj.mjs reference-analysis ${jobId}\` 再查。\n`,
  );
  process.exit(EXIT.watchTimeout);
}

/** `reference-analysis <jobId>`：查一次拆解进度（不等）；终态时同样支持 --out / --timeline-md 落盘 */
async function cmdReferenceAnalysis(ctx, { positional, flags }) {
  const jobId = positional[0];
  if (typeof jobId !== "string") fail("reference-analysis 需要 jobId");
  const result = await request(ctx, "GET", `/reference-decompositions/${encodeURIComponent(jobId)}`);
  if (result.status >= 200 && result.status < 300 && result.envelope?.ok) writeReferenceArtifacts(flags, result.envelope.data);
  handle(ctx, result, pretty.referenceAnalysis);
}

/**
 * `reference-compare <参考片jobId> <成片jobId>`：复刻验收——两份账本的结构 diff。
 * 成片先用 `reference-analyze --asset <assetId>` 拆一遍（同一套管线，同一把尺子）。
 */
async function cmdReferenceCompare(ctx, { positional }) {
  const [referenceJobId, candidateJobId] = positional;
  if (typeof referenceJobId !== "string" || typeof candidateJobId !== "string") {
    fail("reference-compare 需要 <参考片jobId> <成片jobId>（成片先用 reference-analyze --asset <assetId> 拆一遍）");
  }
  handle(
    ctx,
    await request(ctx, "POST", `/reference-decompositions/${encodeURIComponent(referenceJobId)}/compare`, { candidateJobId }),
    pretty.referenceCompare,
  );
}

/**
 * `reference-template <jobId> <jobId> …`：把 2–12 条已拆解的参考视频归纳成赛道结构模板。
 * 纯计算端点：不打上游、不花钱。骨架里 `support < 1` 的环节才有信息量（不是每条都有）。
 */
async function cmdReferenceTemplate(ctx, { positional }) {
  const jobIds = positional.filter((x) => typeof x === "string" && x);
  if (jobIds.length < 2) fail("reference-template 需要至少 2 个 jobId（一条片子归纳不出赛道模板）");
  handle(ctx, await request(ctx, "POST", "/reference-templates", { jobIds }), pretty.referenceTemplate);
}

/** 改编可换的维度（与服务端 ADAPTABLE_DIMENSIONS 同名同序；多一个少一个都会被 400 拒） */
const ADAPT_DIMENSIONS = [
  "presenter",
  "product",
  "dialogue",
  "setting",
  "vertical",
  "language",
  "pacing",
  "shot-composition",
];

/** 把改编产物渲染成可直接粘进剧本文本卡的分段文案 */
function renderAdaptationScriptMd(d) {
  const a = d.adaptation;
  const changed = Object.entries(a.changes ?? {})
    .filter(([, v]) => typeof v === "string" && v)
    .map(([k, v]) => `${k} → ${v}`);
  const head = [
    `# 改编稿 · ${a.adaptationId}`,
    "",
    `- 骨架：${a.spine}`,
    `- 变更：${changed.join(" ｜ ") || "（无）"}`,
    ...(a.brief ? [`- 额外要求：${a.brief}`] : []),
    ...(a.conflictCount ? [`- ⚠️ ${a.conflictCount} 段命中「必保」维度未改（见各段的「未改」标注），这些段的功能依赖那个维度`] : []),
    // strained 的稿子粘进剧本卡之前就该被拦下，所以警告写进文件本身而不只在终端一闪而过
    ...(a.verdict === "strained"
      ? ["", "> 🛑 **这条参考片撑不起本次诉求**，以下内容是自相矛盾的混合稿，先解决下面的问题再用：", ...(a.warnings ?? []).map((w) => `> ${w}`)]
      : []),
    "",
    "> 段序与参考片一一对应，`function` / `intent` 原样保留——这就是「同一套结构，不同的片子」。",
    "",
  ];
  const body = (a.segments ?? []).flatMap((s) => [
    `## 第${s.index}段 · ${s.function}（原第${s.sourceIndex}镜）`,
    "",
    `- 意图（固定）：${s.intent}`,
    `- 台词：${s.dialogue || "（无口播）"}`,
    `- 画面：${s.visualBrief || "（待定）"}`,
    ...(s.conflicts?.length ? [`- ⚠️ 未改：${s.conflicts.join("、")}（这一段把它标成「换掉就垮」）`] : []),
    "",
  ]);
  return [...head, ...body].join("\n");
}

/**
 * `reference-adapt <jobId> --presenter … --product …`：按变换维度改编一条已拆解的参考视频。
 *
 * 同步端点（十几到几十秒）。服务端逐段按 adaptable/preserve 决定改不改，
 * `function`/`intent`/段数全部保留——你拿到的是「同一套结构、不同内容」的新段落清单。
 */
async function cmdReferenceAdapt(ctx, { positional, flags }) {
  const jobId = positional[0];
  if (typeof jobId !== "string") fail("reference-adapt 需要 jobId（reference-analyze 给的那个）");
  const changes = {};
  for (const d of ADAPT_DIMENSIONS) {
    const v = flags[d];
    if (typeof v === "string" && v.trim()) changes[d] = v.trim();
  }
  if (Object.keys(changes).length === 0) {
    fail(`reference-adapt 至少要指定一个要改的维度：${ADAPT_DIMENSIONS.map((d) => `--${d} "…"`).join(" / ")}`);
  }
  const duration = Number(flags.duration);
  const body = {
    changes,
    ...(typeof flags.brief === "string" && flags.brief ? { brief: flags.brief } : {}),
    ...(Number.isFinite(duration) && duration > 0 ? { targetDurationSec: duration } : {}),
    requestId:
      typeof flags["request-id"] === "string"
        ? flags["request-id"]
        : typeof flags.request === "string"
          ? flags.request
          : randomUUID(),
  };
  const result = await request(ctx, "POST", `/reference-decompositions/${encodeURIComponent(jobId)}/adaptations`, body);
  if (result.status >= 200 && result.status < 300 && result.envelope?.ok) {
    const d = result.envelope.data;
    if (typeof flags.out === "string") {
      mkdirSync(pathDirname(flags.out), { recursive: true });
      writeFileSync(flags.out, `${JSON.stringify(d.adaptation, null, 2)}\n`, "utf8");
      process.stderr.write(`dj: 改编产物已写入 ${flags.out}\n`);
    }
    if (typeof flags["script-md"] === "string") {
      mkdirSync(pathDirname(flags["script-md"]), { recursive: true });
      writeFileSync(flags["script-md"], renderAdaptationScriptMd(d), "utf8");
      process.stderr.write(`dj: 改编稿已写入 ${flags["script-md"]}（可直接粘进剧本文本卡）\n`);
    }
  }
  handle(ctx, result, pretty.referenceAdaptation);
}

// ---------------------------------------------------------------------------
// reference-frames：把参考视频的指定片段抽成帧 + 网格图，供你**亲眼看画面**
// ---------------------------------------------------------------------------

/** 单次命令最多抽多少帧（超了自动降 fps）：网格图再大读不动，token 也扛不住 */
const FRAMES_MAX = 64;
/** 网格图每格宽度（px）：320 × 4 列 = 1280 宽，竖屏也读得清，又不至于撑爆上下文 */
const FRAMES_TILE_WIDTH = 320;

/** 探测 ffmpeg；没有就给安装指引后退出（绝不假装成功） */
function requireFfmpeg() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    fail(
      "找不到 ffmpeg —— 本命令在你本机抽帧，必须有它。\n" +
        "    macOS: brew install ffmpeg ｜ Debian/Ubuntu: sudo apt install ffmpeg ｜ Windows: winget install ffmpeg",
    );
  }
}

/** 跑一条 ffmpeg；失败时把 stderr 末尾原样给出（ffmpeg 的报错自解释，别包装成「未知错误」） */
function runFfmpeg(args, what) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    const tail = (r.stderr ?? "").trim().split("\n").slice(-4).join("\n    ");
    fail(`${what}失败：${r.error?.message ?? `ffmpeg 退出码 ${r.status}`}\n    ${tail}`);
  }
}

/** 台词模糊匹配用的归一化：去标点与空白，中文口播的 ASR 断句与用户记忆的写法常常只差这些 */
function loosen(text) {
  return String(text ?? "").replace(/[\s，。、！？；：,.!?;:"'"'（）()【】\[\]—-]/g, "");
}

/** 最长公共子串长度（两串都是短句，O(n·m) 滚动数组足够） */
function longestCommonSubstring(a, b) {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/** `--around` 的相似度下限：ASR 错字是常态（「配料表」→「偏料表」），精确匹配在中文口播上太脆 */
const AROUND_SIMILARITY_MIN = 0.6;

/**
 * 解析 `--shot / --shots / --range / --around` → 要抽的片段列表。
 * 一个片段 = `{ label, startSec, endSec, shotIndex?, dialogue?, dense }`；
 * dense=true 按 fps 密集抽（看清一段里发生了什么），false 只取中点一帧（多镜概览）。
 */
function planReferenceFrameCuts(segments, flags) {
  const byIndex = new Map(segments.map((s) => [s.index, s]));
  const cut = (seg, dense) => ({
    label: `第${seg.index}镜`,
    startSec: seg.startSec,
    endSec: seg.endSec,
    shotIndex: seg.index,
    dialogue: seg.dialogue ?? "",
    dense,
  });

  if (typeof flags.range === "string") {
    const m = flags.range.match(/^\s*(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) fail("--range 形如 40-48（秒）");
    const [startSec, endSec] = [Number(m[1]), Number(m[2])];
    if (!(endSec > startSec)) fail("--range 的终点必须大于起点");
    return [{ label: `${startSec}-${endSec}s`, startSec, endSec, dialogue: "", dense: true }];
  }

  if (typeof flags.around === "string") {
    const needle = loosen(flags.around);
    if (!needle) fail("--around 需要一段台词文字");
    const exact =
      segments.find((s) => loosen(s.dialogue).includes(needle)) ??
      segments.find((s) => needle.includes(loosen(s.dialogue)) && loosen(s.dialogue).length >= 4);
    if (exact) return [cut(exact, true)];
    // 相似度回退：ASR 把「配料表」听成「偏料表」这类错字是常态，精确匹配失败不代表这句不在片子里
    let best = null;
    for (const s of segments) {
      const score = longestCommonSubstring(needle, loosen(s.dialogue)) / needle.length;
      if (!best || score > best.score) best = { seg: s, score };
    }
    if (!best || best.score < AROUND_SIMILARITY_MIN) {
      fail(
        `--around「${flags.around}」在账本台词里没找到（最接近的只有 ${Math.round((best?.score ?? 0) * 100)}% 相似）。` +
          `转写来源是 whisper 时各镜台词为空（此时用 --shot/--range）；也可能只是用词出入较大，换个更短的关键词再试`,
      );
    }
    process.stderr.write(
      `dj: --around 按相似度 ${Math.round(best.score * 100)}% 匹配到第${best.seg.index}镜（台词「${best.seg.dialogue}」）——ASR 常有错字，确认是你要的那句再用图\n`,
    );
    return [cut(best.seg, true)];
  }

  const list = typeof flags.shots === "string" ? flags.shots : typeof flags.shot === "string" || typeof flags.shot === "number" ? String(flags.shot) : "";
  if (!list) fail("reference-frames 需要 --shot <镜号> / --shots <镜号,镜号,…> / --range <秒-秒> / --around <台词> 之一");
  const indexes = list
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((x) => Number(x));
  if (indexes.some((i) => !Number.isInteger(i) || i < 1)) fail("镜号必须是从 1 起的整数");
  const missing = indexes.filter((i) => !byIndex.has(i));
  if (missing.length > 0) fail(`账本里没有第 ${missing.join("、")} 镜（共 ${segments.length} 镜）`);
  // 单镜 → 密集看清；多镜 → 各取中点一帧做概览（复核 proofUnverified 那一串镜号正是这个用法）
  const dense = indexes.length === 1;
  return indexes.map((i) => cut(byIndex.get(i), dense));
}

/** 时间轴上某一刻落在哪句台词里（图例用；半开区间，与服务端 shotIndexForTime 同则） */
function dialogueAt(segments, timeSec) {
  const hit = segments.find((s) => timeSec >= s.startSec && timeSec < s.endSec) ?? segments[segments.length - 1];
  return hit?.dialogue ?? "";
}

/**
 * `reference-frames <jobId>`：把账本里指定的镜头/秒区间抽成帧 + 一张网格图，**让你自己看画面**。
 *
 * 为什么需要它：账本里的 `visual` 是平台侧 VLM 写的文字，而生产的帧预算覆盖不到所有镜头——
 * `reliability.proofUnverified` 里的段就是「判了 proof 但没有画面证据」。复核这些段只能亲眼看。
 *
 * 全程在本机跑：拿直链 → 下载原片到 `--out` 目录 → ffmpeg 抽帧 → ffmpeg tile 拼网格。
 * 原片会留在 `<out>/source.mp4`（直链数周失效，留着后续用 `--video` 复用，不必重下）。
 */
async function cmdReferenceFrames(ctx, { positional, flags }) {
  const jobId = positional[0];
  if (typeof jobId !== "string") fail("reference-frames 需要 jobId（reference-analyze 给的那个）");
  requireFfmpeg();

  const statusResult = await request(ctx, "GET", `/reference-decompositions/${encodeURIComponent(jobId)}`);
  if (statusResult.status < 200 || statusResult.status >= 300 || !statusResult.envelope?.ok) {
    handle(ctx, statusResult, pretty.referenceAnalysis); // 内部打印并退出
    return;
  }
  const d = statusResult.envelope.data;
  if (d?.status !== "succeeded" || !d?.result?.account) {
    fail(`拆解任务还没出账本（status=${d?.status} phase=${d?.phase}）——先等它 succeeded 再来抽帧`);
  }
  const segments = d.result.account.segments;
  const cuts = planReferenceFrameCuts(segments, flags);

  const outDir = typeof flags.out === "string" ? flags.out : `./ref-frames/${jobId}`;
  mkdirSync(outDir, { recursive: true });

  // 源片：优先复用已下载的（直链短时效，重下常常已失效）
  let videoPath = typeof flags.video === "string" ? flags.video : pathJoin(outDir, "source.mp4");
  if (!existsSync(videoPath)) {
    // resolve 只认分享链接（裸 id 是 reference-decompositions 自己的便利），按标准视频 URL 还原
    const resolved = await request(ctx, "POST", "/creators/resolve", {
      input: `https://www.douyin.com/video/${d.videoId}`,
      withPlayUrl: true,
    });
    const playUrl = resolved.envelope?.data?.video?.playUrl;
    if (typeof playUrl !== "string" || !playUrl) {
      handle(ctx, resolved, pretty.videoUrl); // 解析失败按统一口径报错退出
      return;
    }
    process.stderr.write("dj: 正在下载原片（只下一次，之后复用）…\n");
    let bytes;
    try {
      const res = await fetch(playUrl, { redirect: "follow" });
      if (!res.ok) fail(`原片下载失败：HTTP ${res.status}（直链有时效，重跑 reference-frames 会重新解析）`);
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      fail(`原片下载失败：${err instanceof Error ? err.message : "unknown"}`);
    }
    writeFileSync(videoPath, bytes);
    process.stderr.write(`dj: 原片已存 ${videoPath}（${(bytes.length / 1048576).toFixed(1)} MB）\n`);
  } else {
    process.stderr.write(`dj: 复用已有原片 ${videoPath}\n`);
  }

  // 抽帧：统一写成 frame-%03d.png 顺序序列（tile 要序列输入），映射关系进图例与 --json
  const fpsFlag = Number(flags.fps);
  let fps = Number.isFinite(fpsFlag) && fpsFlag > 0 ? fpsFlag : 2;
  const denseSpan = cuts.filter((c) => c.dense).reduce((sum, c) => sum + (c.endSec - c.startSec), 0);
  const singleCount = cuts.filter((c) => !c.dense).length;
  const projected = Math.ceil(denseSpan * fps) + singleCount;
  if (projected > FRAMES_MAX && denseSpan > 0) {
    const nextFps = Math.max(0.5, Math.floor(((FRAMES_MAX - singleCount) / denseSpan) * 2) / 2);
    process.stderr.write(`dj: 按 fps=${fps} 会抽 ${projected} 帧（上限 ${FRAMES_MAX}），自动降到 fps=${nextFps}\n`);
    fps = nextFps;
  }

  const tileWidth = Number(flags["tile-width"]) > 0 ? Number(flags["tile-width"]) : FRAMES_TILE_WIDTH;
  const frames = [];
  const pad = (n) => String(n).padStart(3, "0");
  for (const c of cuts) {
    if (c.dense) {
      const workDir = pathJoin(outDir, ".tmp-dense");
      rmSync(workDir, { recursive: true, force: true });
      mkdirSync(workDir, { recursive: true });
      // -ss 在 -i 前是 input seeking（对本地文件既快又准）；-t 给时长，避免 -to 的相对/绝对歧义
      runFfmpeg(
        ["-ss", String(c.startSec), "-t", String(Math.max(0.05, c.endSec - c.startSec)), "-i", videoPath,
          "-vf", `fps=${fps},scale=${tileWidth}:-2`, "-y", pathJoin(workDir, "%03d.png")],
        `抽帧（${c.label}）`,
      );
      const produced = readdirSync(workDir).filter((f) => f.endsWith(".png")).sort();
      produced.forEach((file, i) => {
        const timeSec = Number((c.startSec + i / fps).toFixed(2));
        const name = `frame-${pad(frames.length + 1)}.png`;
        renameSync(pathJoin(workDir, file), pathJoin(outDir, name));
        frames.push({
          file: name,
          timeSec,
          shotIndex: c.shotIndex ?? null,
          dialogue: c.shotIndex ? c.dialogue : dialogueAt(segments, timeSec),
        });
      });
      rmSync(workDir, { recursive: true, force: true });
    } else {
      const timeSec = Number(((c.startSec + c.endSec) / 2).toFixed(2));
      const name = `frame-${pad(frames.length + 1)}.png`;
      runFfmpeg(
        ["-ss", String(timeSec), "-i", videoPath, "-frames:v", "1", "-vf", `scale=${tileWidth}:-2`, "-y", pathJoin(outDir, name)],
        `抽帧（${c.label}）`,
      );
      frames.push({ file: name, timeSec, shotIndex: c.shotIndex ?? null, dialogue: c.dialogue });
    }
  }
  if (frames.length === 0) fail("一帧都没抽到（区间可能超出视频时长）");

  // 网格图：一张图看全部。tile 要求各帧同尺寸——上面统一 scale 过了
  const cols = Math.max(1, Math.min(Number(flags.cols) > 0 ? Number(flags.cols) : 4, frames.length));
  const rows = Math.ceil(frames.length / cols);
  const tilePath = pathJoin(outDir, "tile.png");
  runFfmpeg(
    ["-framerate", "1", "-i", pathJoin(outDir, "frame-%03d.png"),
      "-vf", `tile=${cols}x${rows}:margin=6:padding=4:color=black`, "-frames:v", "1", "-y", tilePath],
    "拼网格图",
  );

  // 图例：格子序号 → 秒 → 镜号 → 那一刻的台词。不在图上烧字（要字体文件、跨平台不稳），图例够用
  const legendLines = frames.map((f, i) => {
    const r = Math.floor(i / cols) + 1;
    const col = (i % cols) + 1;
    return `| ${i + 1} | 第${r}行第${col}列 | ${f.timeSec}s | ${f.shotIndex ? `第${f.shotIndex}镜` : "—"} | ${(f.dialogue || "（无台词）").slice(0, 40)} |`;
  });
  const legend = [
    `# 抽帧图例 · ${jobId}`,
    "",
    `- 视频：${d.videoId}${d.title ? ` · ${d.title}` : ""}`,
    `- 网格：${tilePath}（${cols} 列 × ${rows} 行，按下表编号从左到右、从上到下）`,
    `- 抽帧：${cuts.map((c) => `${c.label}${c.dense ? `（密集 ${fps}fps）` : "（中点 1 帧）"}`).join("、")}`,
    "",
    "| # | 位置 | 时间 | 镜号 | 该刻台词 |",
    "|---|---|---|---|---|",
    ...legendLines,
    "",
    "> 看图写结论时记住：**这里看到的是事实，账本里的 `visual` 是模型说的**——两者不一致时以你看到的为准。",
    "",
  ].join("\n");
  writeFileSync(pathJoin(outDir, "tile.md"), legend, "utf8");

  const payload = { jobId, videoId: d.videoId, outDir, video: videoPath, tile: tilePath, legend: pathJoin(outDir, "tile.md"), cols, rows, frames };
  if (flags.json || !ctx.pretty) {
    process.stdout.write(`${JSON.stringify(payload, null, ctx.pretty ? 2 : 0)}\n`);
  } else {
    process.stdout.write(`${legend}\n`);
  }
  process.stderr.write(`dj: ${frames.length} 帧已抽到 ${outDir}；先看 ${tilePath}，对照 ${pathJoin(outDir, "tile.md")}\n`);
}

/** `creator-analysis <jobId>`：查一次分析任务状态（不等） */
async function cmdCreatorAnalysis(ctx, { positional }) {
  const jobId = positional[0];
  if (typeof jobId !== "string") fail("creator-analysis 需要 jobId");
  handle(
    ctx,
    await request(ctx, "GET", `/creator-analyses/${encodeURIComponent(jobId)}`),
    pretty.creatorAnalysis,
  );
}

// ---------------------------------------------------------------------------
// login / logout：设备授权（用户只需在浏览器点一下「授权」，令牌不经手）
// ---------------------------------------------------------------------------

/** 默认最多等多久（秒）：低于常见 Agent 工具的 2 分钟命令超时，超时就再跑一次 */
const LOGIN_WAIT_SECONDS = 90;

/** 猜一个客户端名给令牌命名：宿主环境变量能认出来就用，认不出来就叫「编程 Agent」 */
function detectClientName() {
  const host = process.env.CLAUDECODE
    ? "Claude Code"
    : process.env.CURSOR_TRACE_ID
      ? "Cursor"
      : process.env.CODEX_SANDBOX || process.env.CODEX_HOME
        ? "Codex"
        : "编程 Agent";
  let machine = "";
  try {
    machine = hostname().replace(/\.local$/, "");
  } catch {
    machine = "";
  }
  return machine ? `${host} · ${machine}` : host;
}

/**
 * 服务端返回的授权链接必须**精确**是「当前 base + /connect?code=XXXX-XXXX」才允许交给系统打开。
 * `--base` 可能指向不受信任的私有部署或被劫持的 http 站点，一个带 `&`/`|` 的 URL 经 Windows
 * `cmd` 解析就是任意命令执行——不校验就等于把命令行交给对方服务器。
 */
function isTrustedVerificationUrl(url, base) {
  return typeof url === "string" && new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/connect\\?code=[A-Z0-9]{4}-[A-Z0-9]{4}$`).test(url);
}

/** 尽力在用户默认浏览器里打开链接；失败静默（链接同时打印在输出里） */
function openInBrowser(url) {
  try {
    const os = platform();
    // Windows 走 rundll32 直接交给 URL 处理器，不经过 cmd 的元字符解析
    const [cmd, args] =
      os === "darwin"
        ? ["open", [url]]
        : os === "win32"
          ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
          : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** 匿名调用 /api/connect/*（不带令牌；失败按网络错误退出） */
async function connectRequest(base, path, body) {
  let response;
  let text;
  try {
    response = await fetch(`${base}/api/connect${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    text = await response.text();
  } catch (err) {
    process.stderr.write(
      `dj: 请求失败 POST ${base}/api/connect${path}\n    ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown"}\n`,
    );
    process.exit(EXIT.network);
  }
  let envelope;
  try {
    envelope = text ? JSON.parse(text) : null;
  } catch {
    process.stderr.write(`dj: 响应不是 JSON（HTTP ${response.status}）。检查 --base 是否指向 RooYun 站点：${base}\n`);
    process.exit(EXIT.network);
  }
  return { status: response.status, envelope };
}

function readPendingLogin(base) {
  const pending = readJsonFile(PENDING_LOGIN_FILE);
  if (pending.base !== base || typeof pending.deviceCode !== "string") return null;
  if (!pending.expiresAt || Date.parse(pending.expiresAt) <= Date.now()) return null;
  return pending;
}

function clearPendingLogin() {
  try {
    rmSync(PENDING_LOGIN_FILE, { force: true });
  } catch {
    // 没有就算了
  }
}

/**
 * `dj login`：两步走，每步都能独立重跑。
 *   第一次：向站点申请授权码，打开浏览器（或打印链接），**立即返回**，让 AI 能把链接转给用户；
 *   再次运行：轮询等待用户点「授权」，拿到令牌写入凭据文件，然后自省一次确认可用。
 * 等待超时（默认 90s）退出码 6（与 --watch 超时同义：还在进行，再跑一次即可）。
 */
async function cmdLogin(ctx, { flags }) {
  const base = ctx.base;
  const waitSeconds = intFlag(flags, "wait-seconds", LOGIN_WAIT_SECONDS);

  // 已有可用凭据且没要求强制重登：直接确认一次就结束，别让用户白点一次授权
  if (!flags.force) {
    const existing = resolveToken(base);
    if (existing) {
      const probe = await request({ ...ctx, token: existing.token }, "GET", "/me");
      if (probe.envelope?.ok) {
        const out = {
          status: "already_logged_in",
          source: existing.source,
          user: probe.envelope.data?.userId ?? null,
          tokenName: probe.envelope.data?.name ?? null,
          base,
        };
        process.stdout.write(
          ctx.pretty
            ? `已登录 RooYun（令牌「${out.tokenName ?? "?"}」，来源：${existing.source === "env" ? "环境变量" : "本机凭据文件"}）。要换账号请加 --force。\n`
            : `${JSON.stringify(out)}\n`,
        );
        return;
      }
      // 只有 401/403 才是「令牌失效」；503（服务端抖动）/ 429（限流）是瞬时故障，
      // 此时删凭据或让用户去 unset 环境变量，都是把一枚有效令牌当坏的扔掉
      const probeStatus = Number(probe.envelope?.meta?.httpStatus) || probe.status;
      if (probeStatus !== 401 && probeStatus !== 403) {
        process.stdout.write(`${JSON.stringify(probe.envelope)}\n`);
        process.stderr.write(
          `dj: 令牌校验暂时失败（HTTP ${probeStatus}），本机凭据未改动，请稍后重试 dj.mjs login 或直接重试原命令。\n`,
        );
        process.exit(exitCodeFor(probeStatus, probe.envelope?.error?.code));
      }
      if (existing.source === "env") {
        // 环境变量优先于凭据文件：它里面的令牌失效时，再走一遍设备授权也会被它盖掉，
        // 白让用户点一次。直接说清楚该怎么办。
        process.stdout.write(`${JSON.stringify(probe.envelope)}\n`);
        process.stderr.write(
          [
            "dj: 环境变量 ROOYUN_API_TOKEN（或旧名 DUANJU_API_TOKEN）里的令牌已失效，且它优先于本机凭据。",
            "    请先在当前环境清掉它（unset ROOYUN_API_TOKEN DUANJU_API_TOKEN），再运行 dj.mjs login；",
            "    或者到 /profile#api 重新签发一枚并更新该环境变量。",
            "",
          ].join("\n"),
        );
        process.exit(EXIT.apiError);
      }
      // 凭据文件里的令牌失效（吊销/过期）：清掉再走正常登录
      removeCredential(base);
    }
  }

  // --force = 从头来一遍：连上一次没点完的待决授权码一起作废，否则 --name / 换账号都不会生效
  if (flags.force) clearPendingLogin();
  let pending = readPendingLogin(base);
  if (!pending) {
    const { status, envelope } = await connectRequest(base, "/code", {
      clientName: flags.name || detectClientName(),
    });
    if (!envelope?.ok) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      process.stderr.write(`dj: 申请授权码失败（HTTP ${status} ${envelope?.error?.code ?? ""}）\n`);
      process.exit(exitCodeFor(status, envelope?.error?.code));
    }
    pending = {
      base,
      deviceCode: envelope.data.deviceCode,
      userCode: envelope.data.userCode,
      verificationUrl: envelope.data.verificationUrl,
      expiresAt: envelope.data.expiresAt,
      intervalSec: envelope.data.intervalSec ?? 3,
    };
    writeJsonFile(PENDING_LOGIN_FILE, pending);
    const opened =
      flags["no-browser"] || !isTrustedVerificationUrl(pending.verificationUrl, base)
        ? false
        : openInBrowser(pending.verificationUrl);
    const out = {
      status: "pending",
      verificationUrl: pending.verificationUrl,
      userCode: pending.userCode,
      expiresAt: pending.expiresAt,
      browserOpened: opened,
      next: "请用户在浏览器里登录并点「授权」；然后再运行一次 dj.mjs login 等待完成",
    };
    process.stdout.write(
      ctx.pretty
        ? [
            opened ? "已在浏览器打开授权页；若没弹出来，请打开：" : "请在浏览器打开：",
            `  ${pending.verificationUrl}`,
            `登录后点「授权」（授权码 ${pending.userCode}，10 分钟内有效）。`,
            "完成后再运行一次 dj.mjs login 即可。",
          ].join("\n") + "\n"
        : `${JSON.stringify(out)}\n`,
    );
    return;
  }

  // 轮询等待用户授权
  const deadline = Date.now() + waitSeconds * 1000;
  const intervalMs = Math.max(1, Number(pending.intervalSec) || 3) * 1000;
  /** 等待到点仍未授权：退出码 6（还在进行，再跑一次即可），任何分支到点都走这里 */
  const exitStillPending = () => {
    const out = {
      status: "pending",
      verificationUrl: pending.verificationUrl,
      userCode: pending.userCode,
      expiresAt: pending.expiresAt,
      next: "用户尚未授权；提醒用户打开链接点「授权」，然后再运行一次 dj.mjs login",
    };
    process.stdout.write(
      ctx.pretty
        ? `用户尚未授权。请打开 ${pending.verificationUrl} 点「授权」，然后再运行一次 dj.mjs login。\n`
        : `${JSON.stringify(out)}\n`,
    );
    process.exit(EXIT.watchTimeout);
  };
  for (;;) {
    const { status, envelope } = await connectRequest(base, "/poll", {
      deviceCode: pending.deviceCode,
    });
    if (status === 429) {
      // 被限流不是失败：退避后继续，但同样受等待上限约束
      if (Date.now() + intervalMs * 2 >= deadline) exitStillPending();
      await sleep(intervalMs * 2);
      continue;
    }
    if (!envelope?.ok) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      process.stderr.write(`dj: 轮询失败（HTTP ${status} ${envelope?.error?.code ?? ""}）\n`);
      process.exit(exitCodeFor(status, envelope?.error?.code));
    }
    const data = envelope.data ?? {};
    if (data.status === "approved") {
      clearPendingLogin();
      saveCredential(base, data.token, {
        name: data.tokenName ?? null,
        savedAt: new Date().toISOString(),
      });
      if (process.env.ROOYUN_API_TOKEN || process.env.DUANJU_API_TOKEN) {
        // --force 重登时常见：环境变量里的旧令牌会盖住刚保存的凭据，不说清用户会以为登录没生效
        process.stderr.write(
          "dj: 注意：当前环境仍设置了 ROOYUN_API_TOKEN / DUANJU_API_TOKEN，它优先于本机凭据；要用刚授权的令牌请先 unset 它。\n",
        );
      }
      // 自省一次：确认令牌真的可用，并把 scope/有效期报给用户
      const probe = await request({ ...ctx, token: data.token }, "GET", "/me");
      const me = probe.envelope?.ok ? probe.envelope.data : null;
      const out = {
        status: "approved",
        tokenName: data.tokenName ?? null,
        credentialsFile: CREDENTIALS_FILE,
        me: me
          ? { userId: me.userId, scopes: me.scopes, expiresAt: me.expiresAt ?? null }
          : null,
      };
      process.stdout.write(
        ctx.pretty
          ? [
              `授权完成：令牌「${out.tokenName ?? "?"}」已保存到 ${CREDENTIALS_FILE}`,
              me ? `权限：${(me.scopes ?? []).join(", ")}` : "（自省未成功，稍后用 dj.mjs me 复查）",
              me ? `有效期至：${me.expiresAt ?? "长期有效"}` : "",
              "以后每次会话都会自动使用这枚令牌，不需要再配置。",
            ]
              .filter(Boolean)
              .join("\n") + "\n"
          : `${JSON.stringify(out)}\n`,
      );
      return;
    }
    if (data.status !== "pending") {
      // expired / consumed / invalid：这次授权作废，清掉待决状态让下次 login 重新申请
      clearPendingLogin();
      process.stdout.write(`${JSON.stringify({ status: data.status ?? "invalid", base })}\n`);
      process.stderr.write("dj: 授权已失效（过期或已用），请再运行一次 dj.mjs login 获取新链接。\n");
      process.exit(EXIT.apiError);
    }
    if (Date.now() + intervalMs >= deadline) exitStillPending();
    await sleep(intervalMs);
  }
}

/** `dj logout`：删除本机保存的当前站点凭据（不吊销令牌——吊销请到 /profile#api） */
async function cmdLogout(ctx) {
  const removed = removeCredential(ctx.base);
  clearPendingLogin();
  const out = { status: removed ? "logged_out" : "not_logged_in", base: ctx.base };
  process.stdout.write(
    ctx.pretty
      ? `${removed ? "已删除本机凭据" : "本机没有该站点的凭据"}（${ctx.base}）。令牌本身未吊销，要作废请到 /profile#api。\n`
      : `${JSON.stringify(out)}\n`,
  );
}

const COMMANDS = {
  login: cmdLogin,
  logout: cmdLogout,
  me: cmdMe,
  models: cmdModels,
  voices: cmdVoices,
  "digital-humans": cmdDigitalHumans,
  "character-voices": cmdCharacterVoices,
  projects: cmdProjects,
  canvas: cmdCanvas,
  node: cmdNode,
  upload: cmdUpload,
  ops: cmdOps,
  extract: cmdExtract,
  storyboard: cmdStoryboard,
  "storyboard-fall": cmdStoryboardFall,
  caption: cmdCaption,
  inspect: cmdInspect,
  rewrite: cmdRewrite,
  agents: cmdAgents,
  chat: cmdChat,
  chats: cmdChats,
  "edit-session": cmdEditSession,
  precheck: cmdPrecheck,
  generate: cmdGenerate,
  task: cmdTask,
  tasks: cmdTasks,
  cancel: cmdCancel,
  assets: cmdAssets,
  wallet: cmdWallet,
  ledger: cmdLedger,
  "creator-resolve": cmdCreatorResolve,
  "video-url": cmdVideoUrl,
  creator: cmdCreator,
  "creator-report": cmdCreatorReport,
  "creator-analyze": cmdCreatorAnalyze,
  "creator-analysis": cmdCreatorAnalysis,
  "reference-analyze": cmdReferenceAnalyze,
  "reference-analysis": cmdReferenceAnalysis,
  "reference-frames": cmdReferenceFrames,
  "reference-adapt": cmdReferenceAdapt,
  "reference-template": cmdReferenceTemplate,
  "reference-compare": cmdReferenceCompare,
  "creator-archive": cmdCreatorArchive,
  // 选题情报三件套（共用「选题雷达」账号权益，全部不扣积分）
  radar: cmdRadar,
  brief: cmdBrief,
  copy: cmdCopy,
  version: cmdVersion,
  doctor: cmdDoctor,
  update: cmdUpdate,
};

/**
 * 免令牌命令：`version` 只读本地文件 + 打无鉴权的分发端点。
 * 「还没配令牌」恰恰是最需要查版本的时刻，此时因为缺令牌被拒等于把梯子抽了。
 * `doctor` 不在此列——它的核心职责之一就是验证令牌。
 */
const TOKENLESS_COMMANDS = new Set(["version", "update", "login", "logout"]);

async function main() {
  const argv = process.argv.slice(2);
  const commandName = argv[0];
  const { positional, flags } = parseArgv(argv.slice(1));

  if (!commandName || commandName === "--help" || commandName === "help" || flags.help) {
    process.stdout.write(HELP);
    process.exit(EXIT.ok);
  }
  if (commandName === "uuid") {
    process.stdout.write(`${randomUUID()}\n`);
    return;
  }

  const command = COMMANDS[commandName];
  if (!command) fail(`未知命令 ${commandName}（用 dj.mjs --help 看全部）`);

  const base = readBase(flags);
  const resolved = TOKENLESS_COMMANDS.has(commandName) ? null : readToken(base);
  const ctx = {
    token: resolved?.token ?? "",
    /** 令牌来源（env / credentials），供 doctor 报告 */
    tokenSource: resolved?.source ?? null,
    base,
    pretty: Boolean(flags.pretty),
    idleTimeoutMs:
      intFlag(flags, "request-timeout", DEFAULT_IDLE_TIMEOUT_MS / 1000) * 1000,
    totalTimeoutMs:
      intFlag(flags, "total-timeout", DEFAULT_TOTAL_TIMEOUT_MS / 1000) * 1000,
  };

  await command(ctx, { positional, flags });
}

main().catch((err) => {
  // 兜底：绝不回显请求头/令牌，只给错误名与消息
  process.stderr.write(`dj: 未预期错误 ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  process.exit(EXIT.network);
});
