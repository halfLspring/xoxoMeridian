import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Playwright 1.62.1 将 Chromium 的墙钟帧时间交给恒定帧率编码器。
// 系统校时会让 FFmpeg 补帧数十分钟，page.close() 因等待录制完成而超时。
// 只修录制器的时间输入；保留视频、trace、关闭协议及全部用例超时。
// 升级 Playwright 时必须重新审查并移除此适配，不能静默套用到其他版本。
export function installPlaywrightVideoClock() {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("playwright-core/package.json");
  const { version } = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };
  if (version !== "1.62.1") {
    throw new Error(`Playwright 视频时钟适配只支持 1.62.1，当前为 ${version}；请先复核上游录制器。`);
  }
  const bundlePath = join(dirname(packagePath), "lib/coreBundle.js");
  const original = "onFrame: (frame) => this._videoRecorder.writeFrame(frame.buffer, frame.frameSwapWallTime / 1e3),";
  const replacement = "onFrame: (frame) => this._videoRecorder.writeFrame(frame.buffer, monotonicTime() / 1e3), // xoxo: monotonic video clock";
  const source = readFileSync(bundlePath, "utf8");
  if (source.split(replacement).length === 2 && !source.includes(original)) return;
  if (source.split(original).length !== 2 || source.includes(replacement)) {
    throw new Error("Playwright 1.62.1 录制器与已审查输入不符，拒绝修改；请复核锁定依赖。");
  }
  const temporary = `${bundlePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, source.replace(original, replacement));
    renameSync(temporary, bundlePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}
