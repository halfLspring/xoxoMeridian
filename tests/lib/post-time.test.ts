import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { formatPostTime, formatPostTimestamp } from "@/lib/post-time";

const date = new Date("2026-09-30T23:30:00.000Z");

describe("作品时间格式", () => {
  it("沿用文章的 en-US 日期与 24 小时时间，按作者快照跨日", () => {
    expect(formatPostTimestamp(date, { timezone: "Asia/Tokyo" })).toBe("10/01/2026, 08:30");
    expect(formatPostTimestamp(date, { timezone: "Asia/Tokyo", dateOnly: true })).toBe("10/01/2026");
    expect(formatPostTime(date, { timezone: "Asia/Tokyo", city: "Tokyo", country: "Japan" }))
      .toBe("10/01/2026, 08:30  Tokyo, Japan");
  });

  it.each([undefined, null, ""])("作者快照 %s 时显式回退 UTC", timezone => {
    expect(formatPostTimestamp(date, { timezone })).toBe("09/30/2026, 23:30");
    expect(formatPostTimestamp(date, { timezone, dateOnly: true })).toBe("09/30/2026");
  });

  it("按作者时区处理夏令时切换", () => {
    expect(formatPostTimestamp(new Date("2026-03-08T09:59:00Z"), { timezone: "America/Los_Angeles" })).toBe("03/08/2026, 01:59");
    expect(formatPostTimestamp(new Date("2026-03-08T10:00:00Z"), { timezone: "America/Los_Angeles" })).toBe("03/08/2026, 03:00");
  });

  it.each([
    ["en_US.UTF-8", "UTC", "en-US"],
    ["zh_CN.UTF-8", "America/Los_Angeles", "zh-CN"],
    ["de_DE.UTF-8", "Pacific/Honolulu", "de-DE"],
  ])("宿主 LANG=%s、TZ=%s 时输出不变", (locale, timezone, resolvedLocale) => {
    // locale 在 Node 启动时读取；使用真实进程验证，不能在同一进程只改 LANG 后假定默认 locale 已变化。
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { formatPostTime, formatPostTimestamp } from "./lib/post-time.ts";
      const date = new Date("2026-09-30T23:30:00.000Z");
      console.log(JSON.stringify({
        locale: new Intl.DateTimeFormat().resolvedOptions().locale,
        timestamp: formatPostTimestamp(date, { timezone: "Asia/Tokyo" }),
        date: formatPostTimestamp(date, { timezone: "Asia/Tokyo", dateOnly: true }),
        fallback: formatPostTimestamp(date),
        post: formatPostTime(date, { timezone: "Asia/Tokyo" }),
      }));
    `], { encoding: "utf8", env: { ...process.env, LANG: locale, LC_ALL: locale, TZ: timezone } });
    expect(JSON.parse(output)).toEqual({
      locale: resolvedLocale, timestamp: "10/01/2026, 08:30", date: "10/01/2026",
      fallback: "09/30/2026, 23:30", post: "10/01/2026, 08:30  —",
    });
  });
});
