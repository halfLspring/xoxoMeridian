import { createServer, type Server, type Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DeliveredMail = {
  from: string;
  recipients: string[];
  body: string;
};

describe("SMTP 适配层与真实 Nodemailer", () => {
  let server: Server;
  let sockets: Set<Socket>;
  let deliveries: DeliveredMail[];
  let authenticated: boolean;
  let rejectRecipients: boolean;

  beforeEach(async () => {
    vi.resetModules();
    sockets = new Set();
    deliveries = [];
    authenticated = false;
    rejectRecipients = false;

    // 只替换进程外 SMTP 服务。真实 SDK 负责地址解析、认证和 MIME/SMTP 编码。
    // 随机 loopback 端口和合成账号不访问外部邮件服务，也不读取开发配置。
    server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      let buffer = "";
      let inData = false;
      const mail: DeliveredMail = { from: "", recipients: [], body: "" };
      socket.setEncoding("utf8");
      socket.write("220 localhost ESMTP test\r\n");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf("\r\n")) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (inData) {
            if (line === ".") {
              inData = false;
              deliveries.push(mail);
              socket.write("250 2.0.0 queued\r\n");
            } else {
              mail.body += `${line.replace(/^\.\./u, ".")}\r\n`;
            }
          } else if (line.startsWith("EHLO ")) {
            socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          } else if (line.startsWith("AUTH PLAIN ")) {
            authenticated = Buffer.from(line.slice(11), "base64").toString() === "\0smtp-test\0smtp-test-password";
            socket.write(authenticated ? "235 2.7.0 authenticated\r\n" : "535 5.7.8 rejected\r\n");
          } else if (line.startsWith("MAIL FROM:")) {
            mail.from = line.slice(10);
            socket.write("250 2.1.0 sender accepted\r\n");
          } else if (line.startsWith("RCPT TO:")) {
            mail.recipients.push(line.slice(8));
            socket.write(rejectRecipients ? "550 5.1.1 recipient rejected\r\n" : "250 2.1.5 recipient accepted\r\n");
          } else if (line === "DATA") {
            inData = true;
            socket.write("354 end with dot\r\n");
          } else if (line === "QUIT") {
            socket.end("221 goodbye\r\n");
          } else {
            socket.write("500 unsupported command\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("SMTP 测试端口未分配");
    const port = address.port;
    vi.doMock("@/lib/env", () => ({
      env: {
        EMAIL_PROVIDER: "smtp",
        EMAIL_FROM: "XOXO Meridian <noreply@example.com>",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: port,
        SMTP_SECURE: false,
        SMTP_USER: "smtp-test",
        SMTP_PASSWORD: "smtp-test-password",
      },
    }));
  });

  afterEach(async () => {
    try {
      for (const socket of sockets) socket.destroy();
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    } finally {
      vi.doUnmock("@/lib/env");
      vi.restoreAllMocks();
      vi.resetModules();
    }
  });

  it("通过真实 SMTP 认证发送多收件人、回复地址及两种正文", async () => {
    const { sendEmail } = await import("@/lib/email/provider");
    const result = await sendEmail({
      to: [{ email: "one@example.com" }, { email: "two@example.com", name: "收件人二" }],
      replyTo: { email: "reply@example.com", name: "回复地址" },
      subject: "SMTP compatibility",
      html: "<p>Password reset link</p>",
      text: "Password reset link",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^<.+>$/u);
    expect(authenticated).toBe(true);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].from).toBe("<noreply@example.com>");
    expect(deliveries[0].recipients).toEqual(["<one@example.com>", "<two@example.com>"]);
    expect(deliveries[0].body).toContain("Subject: SMTP compatibility\r\n");
    expect(deliveries[0].body).toMatch(/Reply-To: .*<reply@example\.com>/u);
    expect(deliveries[0].body).toContain("Content-Type: multipart/alternative;");
    expect(deliveries[0].body).toContain("Content-Type: text/plain;");
    expect(deliveries[0].body).toContain("Content-Type: text/html;");
    expect(deliveries[0].body).toContain("<p>Password reset link</p>");
  });

  it("带引号地址后的注释和尾随域片段不会形成含空格的 SMTP 收件地址", async () => {
    const { sendEmail } = await import("@/lib/email/provider");
    // GHSA-g57g-f23g-4646：旧包把尾随域片段传入真实 SMTP envelope。
    // 这是适配层输入回归，不表示现有注册 API 接受此地址。
    const result = await sendEmail({
      to: { email: '"user"@example.com(x)evil.com' },
      subject: "Recipient regression",
      html: "<p>Recipient regression</p>",
    });

    expect(result.success).toBe(true);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].recipients).toEqual(["<user@example.com>"]);
  });

  it("SMTP 拒绝收件人时返回失败且不提交邮件正文", async () => {
    rejectRecipients = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sendEmail } = await import("@/lib/email/provider");
    const result = await sendEmail({
      to: { email: "missing@example.com" },
      subject: "Rejected recipient",
      html: "<p>Rejected recipient</p>",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("550 5.1.1 recipient rejected");
    expect(result.messageId).toBeUndefined();
    expect(deliveries).toEqual([]);
  });
});
