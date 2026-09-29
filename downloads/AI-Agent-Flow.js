// Scriptable: iCloud Drive/Scriptable/usage.json (exported by the Mac app).
// Small widget parameter: codex (default), claude, or chatgpt.
// Medium / Large parameter: all (default), codex, claude, or chatgpt.
// No credentials, network endpoint, or API keys are needed on iPhone.

async function main() {
const cloud = FileManager.iCloud();
const local = FileManager.local();
const docs = cloud.documentsDirectory();
const source = cloud.joinPath(docs, "usage.json");
const cache = local.joinPath(local.cacheDirectory(), "aiagentflow-usage-v1.json");
// iOS 18.4+ may keep an already-downloaded iCloud file at an old version indefinitely,
// and downloadFileFromiCloud() returns at once for files already on the device.
// The Mac therefore also writes each summary under a new name that was never downloaded here.
const ROTATED = /^\.?(aiagentflow-usage-(\d{10,16})\.json)(?:\.icloud)?$/;
// Device-local diagnostics: one file per widget run, so concurrent widgets cannot
// overwrite each other. Never include account identifiers, credentials, or raw errors.
const runDir = local.joinPath(local.libraryDirectory(), "aiagentflow-widget-runs-v2");
function loadRuns() {
  try {
    if (!local.fileExists(runDir)) return [];
    return local.listContents(runDir).filter(n => n.endsWith(".json")).sort().slice(-12)
      .map(n => { try { return JSON.parse(local.readString(local.joinPath(runDir, n))); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) { return []; }
}
function clockLabel(seconds) {
  return seconds ? new Date(seconds * 1000).toLocaleString("zh-TW") : "無";
}
const pickedLabel = {rotated: "新檔", "usage.json": "usage.json", cache: "本機快取"};
if (config.runsInApp) {
  const menu = new Alert();
  menu.title = "AI Agent Flow";
  menu.addAction("預覽小工具");
  menu.addAction("檢查自動更新");
  menu.addCancelAction("取消");
  const choice = await menu.presentSheet();
  if (choice !== 0) {
    if (choice === 1) {
      const runs = loadRuns();
      const report = new Alert();
      report.title = "背景更新紀錄 v2";
      report.message = runs.length ? runs.slice(-4).reverse().map(r =>
        `${clockLabel(r.startedAt)} · ${r.family}\n${r.stage}\n資料時間：${clockLabel(r.sourceAt)}（${pickedLabel[r.picked] || "無"}）\n` +
        `iCloud 清單最新：${clockLabel(r.listedAt)} · usage.json：${clockLabel(r.usageAt)}${r.usageWasDownloaded ? "（執行前已在本機）" : ""}` +
        (r.errors && r.errors.length ? `\n錯誤類型：${r.errors.join(", ")}` : "")
      ).join("\n\n") : "此裝置尚無 v2 腳本的背景執行紀錄。手動預覽不會算成背景更新；請保留桌面小工具，稍後再檢查。";
      report.addAction("好");
      await report.presentAlert();
    }
    Script.complete();
    return;
  }
}
const runRecord = {startedAt: Date.now() / 1000, family: config.widgetFamily || "unknown", stage: "已啟動"};
const runFile = config.runsInWidget ?
  local.joinPath(runDir, `${String(Date.now()).padStart(13, "0")}-${Math.random().toString(36).slice(2, 8)}.json`) : null;
function recordStage(stage, extra = {}) {
  if (!runFile) return;
  Object.assign(runRecord, extra, {stage});
  try {
    if (!local.fileExists(runDir)) local.createDirectory(runDir, true);
    local.writeString(runFile, JSON.stringify(runRecord));
  } catch (_) {}
}
function pruneRuns() {
  if (!runFile) return;
  try {
    const names = local.listContents(runDir).filter(n => n.endsWith(".json")).sort();
    for (const n of names.slice(0, -24)) { try { local.remove(local.joinPath(runDir, n)); } catch (_) {} }
  } catch (_) {}
}
recordStage("列出 iCloud 檔案");
function validSnapshot(value) {
  return value && value.schemaVersion === 1 && Array.isArray(value.providers) &&
    value.providers.every(p => p && typeof p.id === "string" && Array.isArray(p.rows));
}
function snapshotTime(s) {
  if (numeric(s.generatedAt)) return s.generatedAt;
  const times = s.providers.map(p => p.updatedAt).filter(numeric);
  return times.length ? Math.max(...times) : 0;
}
function errorKind(e) {
  const m = e && e.message;
  return ["timeout", "missing", "schema"].includes(m) ? m : "read";
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = Timer.schedule(ms, false, () => reject(new Error("timeout")));
    promise.then(v => { timer.invalidate(); resolve(v); }, e => { timer.invalidate(); reject(e); });
  });
}
async function readCloud(path, budget) {
  await withTimeout(cloud.downloadFileFromiCloud(path), budget);
  const text = cloud.readString(path);
  const parsed = JSON.parse(text);
  if (!validSnapshot(parsed)) throw new Error("schema");
  return {parsed, text};
}
// Keep the whole read well inside the widget extension's execution window.
const deadline = Date.now() + 10000;
const found = [];
const errors = [];
let listed = [];
try {
  listed = cloud.listContents(docs).map(n => {
    const m = n.match(ROTATED);
    return m ? {name: m[1], at: Number(m[2]) / 1000} : null;
  }).filter(Boolean).sort((a, b) => b.at - a.at);
} catch (_) { errors.push("list"); }
recordStage("等待 iCloud 下載", {listedAt: listed.length ? listed[0].at : null, listedCount: listed.length});
for (const item of listed.slice(0, 2)) {
  const left = deadline - Date.now();
  if (left < 1000) break;
  try {
    found.push({...await readCloud(cloud.joinPath(docs, item.name), Math.min(7000, left)), from: "rotated"});
    break;
  } catch (e) { errors.push(errorKind(e)); }
}
let usageAt = null;
let usageWasDownloaded = null;
try {
  if (!cloud.fileExists(source)) throw new Error("missing");
  usageWasDownloaded = cloud.isFileDownloaded(source);
  const left = deadline - Date.now();
  if (left < 500) throw new Error("timeout");
  const result = await readCloud(source, Math.min(found.length ? 3000 : 7000, left));
  usageAt = snapshotTime(result.parsed);
  found.push({...result, from: "usage.json"});
} catch (e) { if (!found.length || errorKind(e) !== "missing") errors.push(errorKind(e)); }
recordStage("讀取摘要", {usageAt, usageWasDownloaded, errors});
let cached = null;
try {
  const parsed = JSON.parse(local.readString(cache));
  if (validSnapshot(parsed)) cached = parsed;
} catch (_) {}
// Never let an older iCloud copy replace newer data this device already showed.
found.sort((a, b) => snapshotTime(b.parsed) - snapshotTime(a.parsed));
let data = null;
let picked = null;
const syncFailed = found.length === 0;
if (found.length && (!cached || snapshotTime(found[0].parsed) >= snapshotTime(cached))) {
  data = found[0].parsed;
  picked = found[0].from;
  try { local.writeString(cache, found[0].text); } catch (_) {}
} else if (cached) {
  data = cached;
  picked = "cache";
}
const sourceTimes = data ? data.providers.map(p => p.updatedAt).filter(t => typeof t === "number" && Number.isFinite(t)) : [];
recordStage("繪製小工具", {sourceAt: sourceTimes.length ? Math.min(...sourceTimes) : null, cached: picked === "cache", picked});

const widget = new ListWidget();
widget.backgroundColor = new Color("141917");
widget.setPadding(15, 16, 13, 16);
widget.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
const family = config.widgetFamily || "medium";
const isPad = typeof Device !== "undefined" && Device.isPad();
if (family === "medium") widget.setPadding(isPad ? 8 : 10, 14, isPad ? 8 : 9, 14);
const mode = (args.widgetParameter || (family === "small" ? "codex" : "all")).toLowerCase().trim();
const now = Date.now() / 1000;
const white = new Color("F4F6F3");
const muted = new Color("A1ABA5");
const orange = new Color("DDA57F");
const green = new Color("A6D6B0");

function text(parent, value, size, color = white, bold = false) {
  const t = parent.addText(String(value));
  const fittedSize = size;
  t.font = bold ? Font.boldSystemFont(fittedSize) : Font.systemFont(fittedSize);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.85;
  return t;
}
function numeric(v) { return typeof v === "number" && Number.isFinite(v); }
function percent(row) {
  if (numeric(row.resetsAt) && row.resetsAt <= now) return "待更新";
  return numeric(row.remainingPercent) ? `${Math.round(Math.max(0, Math.min(100, row.remainingPercent)))}%` : "—";
}
function reset(row) {
  if (!numeric(row.resetsAt)) return "重置時間未知";
  if (row.resetsAt <= now) return "已到重置時間 · 待更新";
  const total = Math.ceil((row.resetsAt - now) / 60);
  const days = Math.floor(total / 1440);
  const hours = Math.floor(total % 1440 / 60);
  if (days) return `${days} 天 ${hours} 時後重置`;
  if (hours) return `${hours} 時 ${total % 60} 分後重置`;
  return `${total} 分鐘後重置`;
}
function stale(p) {
  return syncFailed || p.status === "stale" || !numeric(p.updatedAt) || now - p.updatedAt > 3600;
}
function progress(parent, row, outdated, barWidth, barHeight) {
  if (!numeric(row.remainingPercent) || (numeric(row.resetsAt) && row.resetsAt <= now)) return;
  const value = Math.max(0, Math.min(100, row.remainingPercent));
  const width = barWidth || (family === "large" ? 280 : family === "small" ? 120 : 110);
  const height = barHeight || (family === "large" ? 5 : 3);
  const drawing = new DrawContext();
  drawing.size = new Size(width, height);
  drawing.opaque = false;
  drawing.respectScreenScale = true;
  drawing.setFillColor(new Color("36413B"));
  drawing.fillRect(new Rect(0, 0, width, height));
  drawing.setFillColor(new Color(value <= 10 ? "EF786E" : value <= 30 ? "E3B571" : "A6D6B0"));
  if (value > 0) drawing.fillRect(new Rect(0, 0, width * value / 100, height));
  const bar = parent.addImage(drawing.getImage());
  bar.imageSize = new Size(width, height);
  bar.imageOpacity = outdated ? 0.45 : 1;
  bar.cornerRadius = height / 2;
}
function renderProvider(parent, p, maxRows, large) {
  const color = p.id === "claude" ? orange : green;
  const heading = parent.addStack();
  heading.centerAlignContent();
  text(heading, p.id === "codex" ? "OpenAI" : p.name, 12, color, true);
  heading.addSpacer(4);
  text(heading, p.plan || "方案未知", 9, muted);
  parent.addSpacer(7);
  if (!p.rows.length) {
    text(parent, "暫無資料", large ? 23 : 17, white, true);
    parent.addSpacer(3);
    text(parent, p.id === "chatgpt" ? "請查看 ChatGPT" : "請在 Mac 連接帳號", 10, muted);
    return;
  }
  for (const r of p.rows.slice(0, maxRows)) {
    const line = parent.addStack();
    line.centerAlignContent();
    text(line, r.label, large ? 12 : 10, muted);
    line.addSpacer(7);
    text(line, percent(r), large ? 25 : 14, white, true);
    progress(parent, r, stale(p));
    parent.addSpacer(1);
    text(parent, reset(r), large ? 10 : 8, muted);
    parent.addSpacer(large ? 7 : 1);
  }
  if (p.rows.length > maxRows) text(parent, `另有 ${p.rows.length - maxRows} 項，請看大型小工具`, 9, muted);
  if (numeric(p.updatedAt)) {
    const d = new Date(p.updatedAt * 1000);
    const clock = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    text(parent, `${stale(p) ? "舊資料" : "更新"} ${clock}`, 8, stale(p) ? orange : muted);
  } else if (stale(p)) text(parent, "舊資料 · 請在 Mac 更新", 9, orange);
}

// Medium: use both halves of the widget; one limit gets a large headline.
function renderMedium(providers) {
  const screen = typeof Device !== "undefined" ? Device.screenSize() : {width:393,height:852};
  // iPad screen width is unrelated to its Home Screen widget grid.
  // 320pt uses the verified iPad medium footprint while preserving side insets.
  const widgetWidth = isPad ? 320 : Math.max(292, Math.min(380, Math.min(screen.width, screen.height) - 55));
  const gap = 16;
  const width = (widgetWidth - 28 - gap * (providers.length - 1)) / providers.length;
  const columns = widget.addStack();
  for (let i = 0; i < providers.length; i++) {
    if (i) columns.addSpacer(gap);
    const p = providers[i];
    const column = columns.addStack();
    column.layoutVertically();
    column.size = new Size(width, 0);
    const heading = column.addStack();
    heading.centerAlignContent();
    text(heading, p.id === "codex" ? "OpenAI" : p.name, isPad ? 14 : 13, p.id === "claude" ? orange : green, true);
    heading.addSpacer(4);
    text(heading, p.plan || "方案未知", 10, muted);
    column.addSpacer(isPad ? 3 : 5);
    if (!p.rows.length) {
      text(column, "暫無資料", 20, white, true);
      text(column, "請在 Mac 連接帳號", 10, muted);
      continue;
    }
    const hero = p.rows.length === 1;
    const visibleRows = p.rows.slice(0, 3);
    const dense = new Set(visibleRows.map(r => r.resetsAt)).size >= 3;
    for (let j = 0; j < visibleRows.length; j++) {
      const r = visibleRows[j];
      if (hero) {
        text(column, r.label + " · 剩餘", 12, muted);
        text(column, percent(r), isPad ? 46 : 43, white, true);
      } else {
        const line = column.addStack();
        line.centerAlignContent();
        text(line, r.label, isPad ? 11.5 : 11, muted);
        line.addSpacer();
        text(line, percent(r), dense ? (isPad ? 17 : 16) : (isPad ? 19 : 18), white, true);
      }
      progress(column, r, stale(p), width, hero ? 7 : (isPad ? 3 : 4));
      column.addSpacer(hero ? 5 : (isPad ? 0 : 1));
      const next = visibleRows[j + 1];
      const sharesNextReset = next && numeric(r.resetsAt) && r.resetsAt === next.resetsAt;
      if (!sharesNextReset) text(column, reset(r), hero ? 11 : (isPad ? 10 : dense ? 9 : 9.5), muted);
      column.addSpacer(hero || dense || isPad ? 0 : 2);
    }
    if (p.rows.length > 3) text(column, `另有 ${p.rows.length - 3} 項`, 9, muted);
  }
  widget.addSpacer();
  const timestamps = providers.map(p => p.updatedAt).filter(numeric);
  const outdated = providers.some(stale);
  const d = timestamps.length ? new Date(Math.min(...timestamps) * 1000) : null;
  const clock = d ? `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}` : "時間未知";
  const footer = widget.addStack();
  text(footer, "剩餘額度", 9, muted);
  footer.addSpacer();
  text(footer, `${syncFailed ? "同步失敗 · " : ""}${outdated ? "舊資料" : "更新"} ${clock}`, 9, outdated ? orange : muted);
}

const mediumOverview = family === "medium" && mode === "all" && data;
if (!mediumOverview) {
  text(widget, "AI 額度  /  剩餘", 11, muted, true);
  widget.addSpacer(9);
}

if (!data) {
  text(widget, "尚未同步", 23, white, true);
  widget.addSpacer(7);
  const instruction = text(widget, "在 Mac 設定 iPhone 同步，選擇 iCloud 的 Scriptable 資料夾。", 11, muted);
  instruction.lineLimit = 3;
} else {
  const providers = data.providers.filter(p => (p.id !== "chatgpt" || p.rows.length > 0) && (mode === "all" || mode === p.id));
  if (!providers.length) text(widget, data.providers.length ? "參數請填 all / codex / claude" : "正在更新帳號資料…", 11, muted);
  else if (family === "small") {
    renderProvider(widget, providers[0], 1, true);
  } else if (family === "medium" && mode === "all") {
    renderMedium(providers.filter(p => p.id !== "chatgpt"));
  } else {
    for (const p of providers) {
      renderProvider(widget, p, family === "large" ? 4 : 3, family === "large");
      widget.addSpacer(5);
    }
  }
}
if (!mediumOverview) widget.addSpacer();
if (syncFailed && data && !mediumOverview) text(widget, "同步失敗 · 顯示上次資料", 9, orange);
Script.setWidget(widget);
recordStage(data ? (picked === "cache" ? "完成：使用快取" : picked === "rotated" ? "完成：讀取 iCloud 新檔" : "完成：讀取 iCloud 摘要") : "完成：尚無資料");
pruneRuns();
if (config.runsInApp) await widget.presentMedium();
Script.complete();

}
await main();
