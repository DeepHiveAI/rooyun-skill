#!/usr/bin/env node
/**
 * download.mjs · RooYun 开放 API v1 批量下载
 *
 * 零依赖（只用 Node 内置模块），Node ≥ 18。
 *
 * 三条取件路线：
 *   --project <projectId>   该项目**引用**的资产（附服务端完整性块：引用 / 云端可取 / 缺失）
 *   --all                   账号下**全部**云端资产（兜底找回：画布删了、卡删了，东西还在）
 *   --asset <id> / --ids …  指定 assetId 清单
 *
 * 两条纪律落到代码里：
 * ① **签名地址不落日志**：`/v1/assets/{id}/download` 返回 302，本脚本手动跟随，
 *    且**绝不把 Authorization 头带到存储域**（跨域转发 Bearer = 把令牌送给第三方），
 *    也绝不打印 Location。
 * ② **完整性如实报告**：API 可见 = 云端已同步子集。缺的就写缺的、为什么缺，
 *    不拿「下载成功 N 个」掩盖「其实引用了 M 个」。
 *
 * 校验：assetId 就是内容的 sha256 hex，落盘后逐个比对——不匹配即判失败并删除残件。
 */

import { createWriteStream, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const DEFAULT_BASE = "https://www.rooyun.com";
const DEFAULT_OUT = "./out";
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRY = 3;
/** 列表分页每页条数（服务端上限 100） */
const PAGE_SIZE = 100;
/** 重试基础退避（毫秒），逐次翻倍 */
const RETRY_BASE_MS = 800;

const EXIT = { ok: 0, usage: 1, apiError: 2, partial: 3, network: 5 };

/** mime → 扩展名；认不出就用 .bin（宁可难看也不猜错后缀） */
const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "application/zip": "zip",
};

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  const flags = Object.create(null);
  const repeated = { asset: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) i += 1;
    if (key === "asset" && value !== true) repeated.asset.push(value);
    else flags[key] = value;
  }
  return { flags, repeated };
}

function fail(message) {
  process.stderr.write(`download: ${message}\n`);
  process.exit(EXIT.usage);
}

function intFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const parsed = Number.parseInt(String(flags[name]), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`--${name} 需要一个正整数`);
  return parsed;
}

const HELP = `download.mjs · RooYun 开放 API v1 批量下载（零依赖，Node ≥ 18）

用法（三选一取件源）：
  download.mjs --project <projectId> [--out ./out]
  download.mjs --all [--out ./out]
  download.mjs --asset <assetId> [--asset <assetId> …] [--ids a,b,c] [--ids-file ids.json]

环境变量：
  ROOYUN_API_TOKEN   个人访问令牌（需 assets:read）。可选：没设就用 dj.mjs login 保存的本机凭据。永不打印。
                     旧名 DUANJU_API_TOKEN 仍然可用（新名优先）。
  ROOYUN_API_BASE    站点地址，默认 ${DEFAULT_BASE}（旧名 DUANJU_API_BASE 仍然可用）

选项：
  --out <dir>          落盘目录，默认 ${DEFAULT_OUT}（自动创建）
  --base <url>         覆盖站点地址
  --mime image|video|audio   仅 --project / --all 有效
  --concurrency <N>    并发上限，默认 ${DEFAULT_CONCURRENCY}
  --retry <N>          单件重试次数，默认 ${DEFAULT_RETRY}（429/5xx/网络抖动才重试）
  --overwrite          覆盖已存在文件（默认跳过同名且大小相符的文件）
  --no-verify          跳过 sha256 校验（默认校验：assetId 即内容哈希）
  --pretty             人类可读报告（默认输出 JSON 报告，便于机器解析）
  --help               本帮助

输出：stdout 是完整性报告；文件落在 --out，另写一份 manifest.json（短名 ↔ 完整 assetId）。

退出码：0 全部成功　1 用法错误　2 API 业务错误　3 部分失败或有缺失项　5 网络异常
`;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * 令牌：环境变量优先，其次 `dj.mjs login` 写下的本机凭据文件（~/.rooyun/credentials.json，按站点分桶）。
 * 与 dj.mjs 的 resolveToken 同口径；本文件刻意不共享 lib（单文件可独立运行），故各抄一份。
 */
function readToken(base) {
  // 回退旧名：改名前配好 DUANJU_API_TOKEN 的用户不用改环境变量
  const fromEnv = process.env.ROOYUN_API_TOKEN ?? process.env.DUANJU_API_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const file = path.join(homedir(), ".rooyun", "credentials.json");
    const saved = JSON.parse(readFileSync(file, "utf8"))?.tokens?.[base]?.token;
    if (typeof saved === "string" && saved.trim()) return saved.trim();
  } catch {
    // 没有凭据文件或损坏：按未登录处理
  }
  process.stderr.write(
    "download: 尚未登录。先运行 `node <skill目录>/scripts/dj.mjs login` 完成授权（令牌自动保存到本机），" +
      "或用环境变量 ROOYUN_API_TOKEN 注入。切勿把令牌写进代码或对话。\n",
  );
  process.exit(EXIT.usage);
}

/** 打一个返回信封的 GET；非 2xx 直接终止（下载前的清单读失败没有继续的意义） */
async function apiGet(ctx, pathname) {
  const url = `${ctx.base}/api/v1${pathname}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${ctx.token}`, accept: "application/json" },
      redirect: "manual",
    });
  } catch (err) {
    process.stderr.write(
      `download: 请求失败 GET ${url}\n    ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown"}\n`,
    );
    process.exit(EXIT.network);
  }
  const text = await response.text();
  let envelope = null;
  try {
    envelope = text ? JSON.parse(text) : null;
  } catch {
    process.stderr.write(`download: 响应不是 JSON（HTTP ${response.status}），检查 --base\n`);
    process.exit(EXIT.network);
  }
  if (!response.ok || !envelope?.ok) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    process.stderr.write(
      `download: HTTP ${response.status} ${envelope?.error?.code ?? "?"} — ${envelope?.error?.message ?? ""}\n`,
    );
    process.exit(EXIT.apiError);
  }
  return envelope;
}

/** 翻完所有页（以空页为终止条件，与文档口径一致） */
async function listAll(ctx, basePath, mime) {
  const items = [];
  let integrity = null;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const search = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (mime) search.set("mime", mime);
    const envelope = await apiGet(ctx, `${basePath}?${search}`);
    const page = envelope.data?.items ?? [];
    if (envelope.data?.integrity) integrity = envelope.data.integrity;
    items.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return { items, integrity };
}

// ---------------------------------------------------------------------------
// 单件下载
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * assetId 必须是 64 位小写 hex（内容 sha256）。
 *
 * 这不是形式主义：assetId 会拼进落盘文件名（path.join），一个含 `../` 的 id 就能把
 * 文件写到 --out 之外。--ids 模式的 id 来自用户，其余两条路线的 id 来自**服务端响应**
 * ——而「服务端响应可信」正是不该有的假设（站点被劫持/中间人/将来的字段变更）。
 * 故三条路线统一在落盘前过这道闸。
 */
const ASSET_ID_RE = /^[0-9a-f]{64}$/;
function isAssetId(value) {
  return typeof value === "string" && ASSET_ID_RE.test(value);
}

function fileNameFor(entry) {
  const ext = EXT_BY_MIME[entry.mime] ?? "bin";
  return `${entry.assetId.slice(0, 16)}.${ext}`;
}

/**
 * 取一件：302 → 手动跟随（**不带 Authorization**）→ 流式落盘 + sha256。
 * 返回 `{ status, reason?, bytes?, quotaRemaining? }`；`status` ∈ downloaded/skipped/failed。
 */
async function downloadOne(ctx, entry) {
  // 路径穿越闸（全模式）：非 64-hex 的 assetId 一律拒绝，绝不让它进 path.join。
  // 放在这里而不是各取件源分支里，是为了「新增取件源也自动受保护」——本仓最高频的
  // 缺陷类型正是「修了一个忘了兄弟」。
  if (!isAssetId(entry?.assetId)) {
    return {
      status: "failed",
      reason: "assetId 形态非法（应为 64 位小写 hex），已拒绝落盘",
    };
  }
  const fileName = fileNameFor(entry);
  const target = path.join(ctx.outDir, fileName);

  if (!ctx.overwrite) {
    try {
      const existing = await stat(target);
      // 大小相符即认为已取过（内容寻址 + 定长比对足够；要严格重取用 --overwrite）
      if (existing.size === entry.sizeBytes) {
        return { status: "skipped", reason: "已存在且大小相符", file: fileName };
      }
    } catch {
      // 不存在 → 正常下载
    }
  }

  let lastReason = "";
  for (let attempt = 1; attempt <= ctx.retry; attempt += 1) {
    const outcome = await attemptDownload(ctx, entry, target, fileName);
    if (outcome.status !== "retry") return outcome;
    lastReason = outcome.reason;
    if (attempt < ctx.retry) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  return { status: "failed", reason: `重试 ${ctx.retry} 次仍失败：${lastReason}`, file: fileName };
}

async function attemptDownload(ctx, entry, target, fileName) {
  // ① 签发 302（带令牌）
  let signal;
  try {
    signal = await fetch(`${ctx.base}/api/v1/assets/${entry.assetId}/download`, {
      headers: { authorization: `Bearer ${ctx.token}` },
      redirect: "manual",
    });
  } catch (err) {
    return { status: "retry", reason: err instanceof Error ? err.message : "网络错误" };
  }

  if (signal.status !== 302 && signal.status !== 307) {
    const body = await signal.text().catch(() => "");
    let code = `http_${signal.status}`;
    let message = "";
    try {
      const envelope = JSON.parse(body);
      code = envelope?.error?.code ?? code;
      message = envelope?.error?.message ?? "";
    } catch {
      /* 非 JSON 响应：只用状态码，绝不回显正文（可能含无关信息） */
    }
    // 429 / 5xx 可重试；其余（404 / asset_not_in_cloud / 配额耗尽）重试没有意义
    const retryable = signal.status >= 500 || (signal.status === 429 && code !== "download_quota_exceeded");
    return retryable
      ? { status: "retry", reason: `${code} ${message}` }
      : { status: "failed", reason: `${code}${message ? `：${message}` : ""}`, file: fileName };
  }

  const location = signal.headers.get("location");
  // 头缺失（管理员令牌不受日配额约束）记 NaN，下游按「无余额信息」处理，别当成 0
  const quotaHeader = signal.headers.get("x-download-quota-remaining");
  const quotaRemaining = quotaHeader === null ? Number.NaN : Number(quotaHeader);
  if (!location) {
    return { status: "failed", reason: "302 缺少 location 头", file: fileName };
  }

  // ② 取字节：**不带 Authorization**——签名 URL 自带凭据，把 Bearer 转发到存储域
  //    等于把令牌交给第三方。同理，location 全程不打印、不写日志。
  let body;
  try {
    body = await fetch(location, { redirect: "follow" });
  } catch (err) {
    return { status: "retry", reason: err instanceof Error ? err.message : "取字节失败" };
  }
  if (!body.ok || !body.body) {
    return body.status >= 500 || body.status === 429
      ? { status: "retry", reason: `存储返回 ${body.status}` }
      : { status: "failed", reason: `存储返回 ${body.status}`, file: fileName };
  }

  // ③ 先写临时文件，校验通过再改名——半截文件绝不冒充完整产物
  const temp = `${target}.part`;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const sink = createWriteStream(temp);
    for await (const chunk of body.body) {
      hash.update(chunk);
      bytes += chunk.length;
      if (!sink.write(chunk)) {
        await new Promise((resolve) => sink.once("drain", resolve));
      }
    }
    await new Promise((resolve, reject) => {
      sink.end(() => resolve());
      sink.once("error", reject);
    });
  } catch (err) {
    await rm(temp, { force: true });
    return { status: "retry", reason: err instanceof Error ? err.message : "落盘失败" };
  }

  if (ctx.verify) {
    const digest = hash.digest("hex");
    if (digest !== entry.assetId) {
      await rm(temp, { force: true });
      return {
        status: "failed",
        reason: `内容校验失败：sha256 ${digest.slice(0, 12)}… ≠ assetId ${entry.assetId.slice(0, 12)}…`,
        file: fileName,
      };
    }
  }

  await rename(temp, target);
  return {
    status: "downloaded",
    file: fileName,
    bytes,
    ...(Number.isFinite(quotaRemaining) ? { quotaRemaining } : {}),
  };
}

/** 固定并发的工作池（不引第三方库，够用且行为透明） */
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { flags, repeated } = parseArgv(process.argv.slice(2));
  if (flags.help || process.argv.length <= 2) {
    process.stdout.write(HELP);
    process.exit(EXIT.ok);
  }

  // 回退旧名：改名前配好 DUANJU_API_BASE 的用户不用改环境变量
  const base = String(
    flags.base || process.env.ROOYUN_API_BASE || process.env.DUANJU_API_BASE || DEFAULT_BASE,
  ).replace(/\/+$/, "");
  try {
    new URL(base);
  } catch {
    fail(`基址不是合法 URL：${base}`);
  }

  const outDir = path.resolve(String(flags.out || DEFAULT_OUT));
  const ctx = {
    token: readToken(base),
    base,
    outDir,
    concurrency: intFlag(flags, "concurrency", DEFAULT_CONCURRENCY),
    retry: intFlag(flags, "retry", DEFAULT_RETRY),
    overwrite: Boolean(flags.overwrite),
    verify: !flags["no-verify"],
  };

  const mime = typeof flags.mime === "string" ? flags.mime : undefined;
  if (mime && !["image", "video", "audio"].includes(mime)) {
    fail("--mime 只能是 image / video / audio");
  }

  // 取件源三选一
  const explicitIds = [
    ...repeated.asset,
    ...(typeof flags.ids === "string" ? flags.ids.split(",") : []),
    ...(typeof flags["ids-file"] === "string" ? await readIdsFile(flags["ids-file"]) : []),
  ]
    .map((id) => String(id).trim())
    .filter(Boolean);

  let source;
  let entries = [];
  let integrity = null;

  if (typeof flags.project === "string") {
    source = { kind: "project", projectId: flags.project, ...(mime ? { mime } : {}) };
    const listed = await listAll(ctx, `/projects/${encodeURIComponent(flags.project)}/assets`, mime);
    entries = listed.items;
    integrity = listed.integrity;
  } else if (flags.all) {
    source = { kind: "all", ...(mime ? { mime } : {}) };
    entries = (await listAll(ctx, "/assets", mime)).items;
  } else if (explicitIds.length > 0) {
    source = { kind: "ids", count: explicitIds.length };
    // 逐个取元数据：要 mime（定扩展名）与 sizeBytes（跳过已存在）；
    // 取不到的按 missing 记，不静默丢
    const metas = await runPool(explicitIds, ctx.concurrency, async (assetId) => {
      if (!isAssetId(assetId)) {
        return { assetId, error: "assetId 形态非法（应为 64 位小写 hex）" };
      }
      const envelope = await apiGetSoft(ctx, `/assets/${assetId}`);
      return envelope.ok ? envelope.data : { assetId, error: envelope.code };
    });
    entries = metas.filter((m) => !m.error);
    const badIds = metas.filter((m) => m.error);
    if (badIds.length > 0) {
      integrity = {
        referenced_total: explicitIds.length,
        cloud_available: entries.length,
        missing: badIds.map((m) => ({ assetId: m.assetId, reason: m.error })),
        unreadable_canvases: [],
      };
    }
  } else {
    fail("需要一个取件源：--project <id> / --all / --asset <assetId>（用 --help 看全部）");
  }

  await mkdir(outDir, { recursive: true });

  const results = await runPool(entries, ctx.concurrency, (entry) => downloadOne(ctx, entry));

  const files = entries.map((entry, i) => ({
    assetId: entry.assetId,
    mime: entry.mime,
    sizeBytes: entry.sizeBytes,
    ...results[i],
  }));
  const summary = {
    listed: entries.length,
    downloaded: files.filter((f) => f.status === "downloaded").length,
    skipped: files.filter((f) => f.status === "skipped").length,
    failed: files.filter((f) => f.status === "failed").length,
    bytes: files.reduce((sum, f) => sum + (f.bytes ?? 0), 0),
  };
  const quota = files.map((f) => f.quotaRemaining).filter((v) => Number.isFinite(v));

  const notes = [];
  if (integrity?.missing?.length) {
    // 两种 missing 语义不同，note 必须按实际 reason 分开说，否则会把用户引去做无用功：
    // not_synced = 东西在浏览器侧没上云；其他码（--asset 模式）= id 本身有问题。
    const notSynced = integrity.missing.filter((m) => m.reason === "not_synced");
    const otherwise = integrity.missing.filter((m) => m.reason !== "not_synced");
    if (notSynced.length > 0) {
      notes.push(
        `有 ${notSynced.length} 件被引用但云端取不到（reason=not_synced）：` +
          "东西在用户的浏览器里没推上云（超 50MB 不自动上云 / 上传在途 / 该画布从未在登录态同步过）。" +
          "请如实告知用户，并请其在原设备打开该画布让它完成同步，或直接导出。",
      );
    }
    if (otherwise.length > 0) {
      notes.push(
        `有 ${otherwise.length} 个 assetId 取不到元数据（形态非法 / 不存在 / 不属于本账号）：` +
          "这不是同步问题，请核对 id 来源。",
      );
    }
  }
  if (integrity?.unreadable_canvases?.length) {
    notes.push(
      `有 ${integrity.unreadable_canvases.length} 张画布整档读不出，其引用集未知（未计入 referenced_total）——` +
        "这不是「没有缺失」，是「不知道缺了多少」。请用户在浏览器里打开确认。",
    );
  }
  if (source.kind === "all") {
    notes.push("--all 取的是账号级云端资产全集，服务端不提供引用完整性口径，故本次无 integrity 块。");
  }
  if (source.kind === "project" && mime) {
    notes.push(
      `integrity 按项目的**全量引用**计算，与 --mime ${mime} 过滤无关——` +
        `所以 referenced_total(${integrity?.referenced_total ?? "?"}) 大于本次列出的 ${entries.length} 件是正常的，不是缺失。`,
    );
  }
  if (summary.failed > 0) notes.push("有失败项，逐条原因见 files[].reason。");

  const report = {
    ok: summary.failed === 0 && !(integrity?.missing?.length > 0),
    outDir,
    source,
    integrity,
    summary,
    ...(quota.length ? { downloadQuotaRemainingBytes: Math.min(...quota) } : {}),
    files,
    notes,
  };

  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), source, integrity, files }, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(flags.pretty ? `${renderReport(report)}\n` : `${JSON.stringify(report)}\n`);
  process.exit(report.ok ? EXIT.ok : EXIT.partial);
}

/** 软失败版 GET：把错误变成返回值而不是退出（逐件取元数据要能继续） */
async function apiGetSoft(ctx, pathname) {
  try {
    const response = await fetch(`${ctx.base}/api/v1${pathname}`, {
      headers: { authorization: `Bearer ${ctx.token}`, accept: "application/json" },
      redirect: "manual",
    });
    const envelope = await response.json().catch(() => null);
    if (!response.ok || !envelope?.ok) {
      return { ok: false, code: envelope?.error?.code ?? `http_${response.status}` };
    }
    return { ok: true, data: envelope.data };
  } catch (err) {
    return { ok: false, code: err instanceof Error ? err.name : "network_error" };
  }
}

async function readIdsFile(file) {
  const { readFile } = await import("node:fs/promises");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    fail(`读取 ${file} 失败：${err instanceof Error ? err.message : "unknown"}`);
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) fail(`${file} 的 JSON 不是数组`);
      return parsed;
    } catch (err) {
      fail(`${file} 不是合法 JSON：${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  return trimmed.split(/\r?\n/);
}

function renderReport(report) {
  const lines = [
    `落盘目录 ${report.outDir}`,
    `取件源  ${JSON.stringify(report.source)}`,
    `结果    列出 ${report.summary.listed}　下载 ${report.summary.downloaded}` +
      `　跳过 ${report.summary.skipped}　失败 ${report.summary.failed}` +
      `　合计 ${(report.summary.bytes / 1024 / 1024).toFixed(2)}MB`,
  ];
  if (report.integrity) {
    lines.push(
      `完整性  引用 ${report.integrity.referenced_total}　云端可取 ${report.integrity.cloud_available}` +
        `　缺失 ${report.integrity.missing.length}` +
        `　读不出的画布 ${report.integrity.unreadable_canvases.length}`,
    );
    for (const m of report.integrity.missing) {
      lines.push(`  缺失 ${m.assetId}（${m.reason}）`);
    }
  }
  if (Number.isFinite(report.downloadQuotaRemainingBytes)) {
    lines.push(`下载配额剩余 ${(report.downloadQuotaRemainingBytes / 1024 / 1024 / 1024).toFixed(2)}GiB`);
  }
  for (const f of report.files) {
    lines.push(
      `  ${f.status === "downloaded" ? "✓" : f.status === "skipped" ? "-" : "✗"} ` +
        `${f.file ?? f.assetId}  ${f.mime}${f.reason ? `　${f.reason}` : ""}`,
    );
  }
  lines.push(...report.notes.map((n) => `※ ${n}`));
  return lines.join("\n");
}

main().catch((err) => {
  process.stderr.write(
    `download: 未预期错误 ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`,
  );
  process.exit(EXIT.network);
});
