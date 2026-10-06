import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const composeFile = join(repositoryRoot, "docker-compose.yml");
const smokeComposeFile = join(repositoryRoot, "docker-compose.smoke.yml");
const configOnly = process.argv.includes("--config-only");
const unexpectedArguments = process.argv.slice(2).filter((argument) => argument !== "--config-only");
const manualEvaluationScripts = [
  "scripts/eval-agent-answers.ts",
  "scripts/eval-agent-workflow.ts",
  "scripts/summarize-agent-eval.ts"
];

if (unexpectedArguments.length > 0) {
  throw new Error(`不支持的参数：${unexpectedArguments.join(", ")}`);
}

type ComposeVolume = {
  type?: string;
  source?: string;
  target?: string;
};

type ComposeService = {
  build?: { target?: string; args?: Record<string, string> };
  container_name?: string;
  environment?: Record<string, string>;
  image?: string;
  ports?: Array<{ host_ip?: string; published?: string; target?: number }>;
  volumes?: ComposeVolume[];
};

type ComposeConfig = {
  name?: string;
  services?: Record<string, ComposeService>;
  volumes?: Record<string, { name?: string }>;
};

type SmokeContext = {
  baseUrl: string;
  dataRoot: string;
  envFile: string;
  projectName: string;
  temporaryRoot: string;
  webPort: number;
};

type CommandError = Error & {
  stderr?: string;
  stdout?: string;
};

let activeChild: ChildProcess | null = null;
let receivedSignal: NodeJS.Signals | null = null;

function handleSignal(signal: NodeJS.Signals) {
  receivedSignal = signal;
  activeChild?.kill(signal);
}

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

function dockerEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "BUILDKIT_PROGRESS",
    "BUILDX_BUILDER",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy"
  ];
  const environment: NodeJS.ProcessEnv = {
    COMPOSE_ANSI: "never",
    NO_COLOR: "1",
    NODE_ENV: process.env.NODE_ENV ?? "test"
  };

  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }

  return environment;
}

function composeArguments(context: SmokeContext, command: string[]) {
  return [
    "compose",
    "--project-name",
    context.projectName,
    "--project-directory",
    repositoryRoot,
    "--env-file",
    context.envFile,
    "--file",
    composeFile,
    "--file",
    smokeComposeFile,
    ...command
  ];
}

async function runDocker(arguments_: string[]) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("docker", arguments_, {
      cwd: repositoryRoot,
      env: dockerEnvironment(),
      stdio: "inherit"
    });
    activeChild = child;

    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      activeChild = null;
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `docker ${arguments_.join(" ")} 失败（exit=${String(code)}, signal=${String(signal)}）。`
        )
      );
    });
  });
}

async function captureDocker(arguments_: string[]) {
  const { stdout } = await execFileAsync("docker", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: dockerEnvironment(),
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout;
}

async function captureCompose(context: SmokeContext, command: string[]) {
  return captureDocker(composeArguments(context, command));
}

async function runCompose(context: SmokeContext, command: string[]) {
  return runDocker(composeArguments(context, command));
}

function errorText(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const commandError = error as CommandError;
  return [commandError.message, commandError.stdout, commandError.stderr]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
}

function asRecord(value: unknown, description: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), description);
  return value as Record<string, unknown>;
}

function asString(value: unknown, description: string) {
  assert.equal(typeof value, "string", description);
  return value as string;
}

function isPathInside(path: string, parent: string) {
  return path === parent || path.startsWith(`${parent}${sep}`);
}

async function reservePort() {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "无法分配 Compose smoke Web 端口。");
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise(address.port);
      });
    });
  });
}

async function createContext(theme?: "default" | "birthday-2026"): Promise<SmokeContext> {
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const projectName = `xoxo-meridian-smoke-${suffix}`;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "xoxo-meridian-compose-smoke-"));
  const dataRoot = join(temporaryRoot, "data");
  const envFile = join(temporaryRoot, "compose.env");
  const webPort = configOnly ? 43_199 : await reservePort();
  const baseUrl = `http://127.0.0.1:${webPort}`;
  const secret = randomBytes(24).toString("hex");

  await Promise.all([
    mkdir(join(dataRoot, "chat-logs"), { recursive: true }),
    mkdir(join(dataRoot, "atlas-uploads"), { recursive: true })
  ]);

  await writeFile(
    envFile,
    [
      `COMPOSE_PROJECT_NAME=${projectName}`,
      `POSTGRES_PASSWORD=smoke-${secret}`,
      `SESSION_SECRET=smoke-session-${secret}`,
      `INVITE_CODE=smoke-invite-${secret}`,
      `APP_BASE_URL=${baseUrl}`,
      `NEXT_PUBLIC_APP_URL=${baseUrl}`,
      ...(theme ? [`NEXT_PUBLIC_AGENT_ENTRY_THEME=${theme}`] : []),
      "ALLOWED_ORIGINS=",
      "DEMO_ROOM_SLUG=compose-smoke-room",
      "LLM_PROVIDER=mock",
      "LLM_API_KEY=",
      "WEATHER_PROVIDER=mock",
      "EMAIL_PROVIDER=mock",
      "EMAIL_FROM=compose-smoke@example.com",
      "ATLAS_STORAGE_PROVIDER=local",
      "AGENT_TASK_INLINE_RUN=false",
      "AGENT_WORKER_POLL_MS=250",
      "AGENT_TASK_LEASE_MS=5000",
      "AGENT_TASK_HEARTBEAT_MS=1000",
      "AGENT_TOOL_TIMEOUT_MS=3000",
      `SMOKE_DATA_ROOT=${dataRoot}`,
      `SMOKE_WEB_PORT=${webPort}`,
      ""
    ].join("\n"),
    { mode: 0o600 }
  );

  return { baseUrl, dataRoot, envFile, projectName, temporaryRoot, webPort };
}

async function validateComposeConfig(context: SmokeContext, expectedTheme = "default") {
  const rendered = await captureCompose(context, ["config", "--format", "json"]);
  const config = JSON.parse(rendered) as ComposeConfig;
  const services = config.services ?? {};
  const expectedServices = ["postgres", "init", "web", "agent-worker"];

  assert.equal(config.name, context.projectName, "Compose project 未使用隔离名称。");
  for (const serviceName of expectedServices) {
    const service = services[serviceName];
    assert(service, `Compose 缺少 ${serviceName} 服务。`);
    assert.equal(
      service.container_name,
      `${context.projectName}-${serviceName}`,
      `${serviceName} 未使用 project-scoped container name。`
    );
  }

  assert.equal(services.web?.build?.target, "web-runner", "Web 未构建 production runner target。");
  assert.equal(
    services.web?.build?.args?.NEXT_PUBLIC_AGENT_ENTRY_THEME,
    expectedTheme,
    "Web 构建参数没有传递实际选择的 Agent 入口主题。"
  );
  for (const serviceName of ["init", "web", "agent-worker"]) {
    assert.equal(
      services[serviceName]?.environment?.NEXT_PUBLIC_AGENT_ENTRY_THEME,
      undefined,
      `${serviceName} 不应将 Agent 入口主题暴露为运行时可变配置。`
    );
  }
  assert.equal(
    services["agent-worker"]?.build?.args?.NEXT_PUBLIC_AGENT_ENTRY_THEME,
    undefined,
    "Agent Worker 不应接收 Web 入口主题构建参数。"
  );
  assert.equal(
    services["agent-worker"]?.build?.target,
    "worker-runner",
    "Agent Worker 未构建 worker runner target。"
  );
  assert.equal(
    services.init?.image,
    `${context.projectName}-worker:smoke`,
    "init 未复用本次隔离构建的 Worker 镜像。"
  );
  assert.equal(
    services["agent-worker"]?.image,
    `${context.projectName}-worker:smoke`,
    "Agent Worker 镜像标签未按 smoke project 隔离。"
  );

  assert.equal(services.postgres?.ports?.length ?? 0, 0, "Smoke PostgreSQL 不得发布宿主机端口。");
  assert.deepEqual(
    services.web?.ports?.map((port) => ({
      hostIp: port.host_ip,
      published: port.published,
      target: port.target
    })),
    [{ hostIp: "127.0.0.1", published: String(context.webPort), target: 3000 }],
    "Smoke Web 必须只发布随机分配的 127.0.0.1 端口。"
  );

  const bindVolumes = Object.values(services)
    .flatMap((service) => service.volumes ?? [])
    .filter((volume) => volume.type === "bind");
  assert.equal(bindVolumes.length, 6, "Web、init 与 Worker 应各使用两项隔离 bind mount。");
  for (const volume of bindVolumes) {
    assert(volume.source, `挂载到 ${String(volume.target)} 的 bind volume 缺少 source。`);
    assert(
      isPathInside(volume.source, context.dataRoot),
      `Smoke bind mount 越过临时目录：${volume.source}`
    );
  }

  assert.equal(
    config.volumes?.["postgres-data"]?.name,
    `${context.projectName}_postgres-data`,
    "PostgreSQL named volume 未按 smoke project 隔离。"
  );

  for (const serviceName of ["init", "web", "agent-worker"]) {
    const environment = services[serviceName]?.environment ?? {};
    assert.equal(
      environment.AGENT_TASK_INLINE_RUN,
      "false",
      `${serviceName} 必须禁用 inline Agent execution。`
    );
    assert.equal(environment.NODE_ENV, "production", `${serviceName} 必须运行 production 环境。`);
  }

  console.log(
    `[compose-config] 已验证 ${context.projectName}：theme=${expectedTheme}、4 个服务、隔离卷/目录、production runner target 与 inline=false。`
  );
}

async function assertBuildContextIsolation(context: SmokeContext) {
  const inputRoot = join(context.temporaryRoot, "build-context-input");
  const outputRoot = join(context.temporaryRoot, "build-context-output");
  const requiredFiles = [
    ".env.example",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "app/api/health/route.ts",
    "agent/agent-worker.ts",
    "lib/env.ts",
    "prisma/schema.prisma",
    "prisma/seed.ts",
    "scripts/cleanup-blog-assets.ts",
    "scripts/agent-entry-assets.ts"
  ];
  const excludedFiles = [
    ".env",
    ".env.local",
    ".env.production.local",
    "tests/evals/agent-answer/cases.ts",
    "tests/evals/agent-answer/validation-cases.ts",
    "tests/evals/agent-answer/legacy-requests.json",
    "test-results/.auth/user-one.json",
    "playwright-report/index.html",
    "playwright-report/data/auth.json",
    ...manualEvaluationScripts
  ];

  // 用合成文件交给 Docker 实际筛选，避免读取真实配置或把认证工件复制到探针中。
  await mkdir(inputRoot, { recursive: true });
  await writeFile(join(inputRoot, ".dockerignore"), await readFile(join(repositoryRoot, ".dockerignore")));
  await writeFile(join(inputRoot, "Dockerfile"), "FROM scratch\nCOPY . /context/\n");
  await Promise.all([...requiredFiles, ...excludedFiles].map(async (path) => {
    const destination = join(inputRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "compose-smoke-synthetic-input\n");
  }));
  await captureDocker([
    "build", "--network=none", "--output", `type=local,dest=${outputRoot}`, inputRoot
  ]);
  for (const path of requiredFiles) {
    await access(join(outputRoot, "context", path));
  }
  for (const path of excludedFiles) {
    await assert.rejects(
      access(join(outputRoot, "context", path)),
      { code: "ENOENT" },
      `Docker 构建上下文不得包含 ${path}。`
    );
  }
  console.log("[compose-smoke] Docker 实际上下文保留生产入口，隔离手动评估、fixture、环境配置与测试认证/报告工件。");
}

async function assertProductionImageIsolation(context: SmokeContext) {
  for (const service of ["web", "agent-worker"]) {
    const container = await inspectContainer(context, service);
    const imageId = asString(container.Image, `${service} inspect.Image 缺失。`);
    const unexpectedPaths = JSON.parse(await captureDocker([
      "run", "--rm", "--network=none", "--read-only", "--entrypoint", "node", imageId,
      "--input-type=module", "-e",
      `import { existsSync, readdirSync } from "node:fs";
       import { join } from "node:path";
       const excluded = ${JSON.stringify(["tests", "test-results", "playwright-report", ...manualEvaluationScripts])};
       const environmentFiles = readdirSync("/app").filter((name) =>
         (name === ".env" || name.startsWith(".env.")) && name !== ".env.example");
       console.log(JSON.stringify([
         ...environmentFiles,
         ...excluded.filter((path) => existsSync(join("/app", path)))
       ]));`
    ])) as unknown;
    assert.deepEqual(unexpectedPaths, [], `${service} 生产镜像包含非生产输入。`);
  }
  console.log("[compose-smoke] Web/Worker 原始镜像均不含环境配置、手动评估或测试认证/报告工件。");
}

async function inspectImageDependencies(context: SmokeContext) {
  for (const service of ["web", "agent-worker"]) {
    const container = await inspectContainer(context, service);
    const imageId = asString(container.Image, `${service} inspect.Image 缺失。`);
    const report = JSON.parse(await captureDocker([
      "run", "--rm", "--network=none", "--read-only", "--entrypoint", "node", imageId,
      "--input-type=module", "-e",
      `import { readdirSync, readFileSync } from "node:fs";
       import { join, relative } from "node:path";
       const names = new Set(["braces", "micromatch", "fast-glob", "chokidar", "tailwindcss",
         "@tailwindcss/postcss", "@tailwindcss/typography", "@next/eslint-plugin-next", "@gltf-transform/cli",
         "source-map-js", "source-map", "source-map08", "postcss", "@tailwindcss/node", "css-tree", "magicast", "postcss-selector-parser"]);
       const packages = [];
       function visit(directory) {
         for (const entry of readdirSync(directory, { withFileTypes: true })) {
           const path = join(directory, entry.name);
           if (entry.isDirectory()) visit(path);
           else if (entry.name === "package.json") {
             const pkg = JSON.parse(readFileSync(path, "utf8"));
             if (names.has(pkg.name)) packages.push({ path: relative("/app", path),
               name: pkg.name, version: pkg.version ?? null, dependencies: pkg.dependencies ?? {} });
           }
         }
       }
       visit("/app/node_modules");
       packages.sort((a, b) => a.path.localeCompare(b.path));
       console.log(JSON.stringify({ node: process.version, packages }));`
    ])) as { node: string; packages: Array<{ path: string; name: string; version: string | null; dependencies: Record<string, string> }> };
    const tailwind = report.packages.filter((pkg) => pkg.name === "tailwindcss");
    assert(tailwind.every((pkg) => pkg.version?.startsWith("4.")), `${service} 不得残留 Tailwind 3。`);
    if (service === "agent-worker") {
      assert.equal(tailwind.length, 1, "Worker 完整安装图应包含唯一 Tailwind 4。 ");
      for (const pkg of report.packages.filter((pkg) => ["tailwindcss", "@tailwindcss/postcss"].includes(pkg.name))) {
        assert.equal(["braces", "micromatch", "fast-glob", "chokidar"].some((name) => name in pkg.dependencies), false,
          `${pkg.name} 不得重新引入旧 Tailwind 的易受影响链。`);
      }
    }
    // Worker 仍含上游未修复的开发工具链，完整记录，不能按 dev 标记声称镜像不存在。
    console.log(`[compose-smoke:dependencies] ${JSON.stringify({ service, imageId, ...report })}`);
  }
}

async function serviceContainerId(context: SmokeContext, serviceName: string) {
  const id = (await captureCompose(context, ["ps", "--all", "--quiet", serviceName])).trim();
  assert(id, `未找到 ${serviceName} 容器。`);
  return id;
}

async function inspectContainer(context: SmokeContext, serviceName: string) {
  const id = await serviceContainerId(context, serviceName);
  const inspected = JSON.parse(await captureDocker(["inspect", id])) as unknown;
  assert(Array.isArray(inspected) && inspected.length === 1, `${serviceName} inspect 结果无效。`);
  return asRecord(inspected[0], `${serviceName} inspect 结果必须为对象。`);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitFor<T>(
  description: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined>
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (receivedSignal) throw new Error(`收到 ${receivedSignal}，停止 Compose smoke test。`);
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  throw new Error(`${description} 在 ${timeoutMs}ms 内未满足。${lastError ? `\n${errorText(lastError)}` : ""}`);
}

async function waitForHealthyWeb(context: SmokeContext) {
  await waitFor("Web container healthcheck", 180_000, async () => {
    const inspected = await inspectContainer(context, "web");
    const state = asRecord(inspected.State, "Web inspect.State 缺失。");
    const health = asRecord(state.Health, "Web healthcheck 状态缺失。");
    if (health.Status === "unhealthy") throw new Error("Web container healthcheck 进入 unhealthy。");
    return health.Status === "healthy" ? true : undefined;
  });

  const healthPayload = await waitFor("Web /api/health", 30_000, async () => {
    const response = await fetch(`${context.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return undefined;
    const payload = asRecord(await response.json(), "Health payload 必须为对象。");
    return payload.ok === true && payload.db === true ? payload : undefined;
  });
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.db, true);
  console.log("[compose-smoke] Web container healthcheck 与 /api/health 数据库探测均已通过。");
}

function containerCommand(inspected: Record<string, unknown>) {
  const config = asRecord(inspected.Config, "Container Config 缺失。");
  const entrypoint = Array.isArray(config.Entrypoint) ? config.Entrypoint : [];
  const command = Array.isArray(config.Cmd) ? config.Cmd : [];
  return [...entrypoint, ...command].map(String).join(" ");
}

async function assertProductionProcesses(context: SmokeContext) {
  const web = await inspectContainer(context, "web");
  const webCommand = containerCommand(web);
  assert.match(webCommand, /node server\.js/u, `Web 未运行 standalone server：${webCommand}`);
  assert.doesNotMatch(webCommand, /next\s+dev/u, `Web 意外运行 next dev：${webCommand}`);

  const worker = await inspectContainer(context, "agent-worker");
  const workerCommand = containerCommand(worker);
  assert.match(
    workerCommand,
    /agent\/agent-worker\.ts/u,
    `Agent Worker 未运行独立 worker entry：${workerCommand}`
  );
  const workerState = asRecord(worker.State, "Agent Worker inspect.State 缺失。");
  assert.equal(workerState.Running, true, "Agent Worker 容器未保持运行。 ");
  console.log(`[compose-smoke] production processes：web="${webCommand}"；worker="${workerCommand}"。`);
}

async function assertWebImageAssets(context: SmokeContext) {
  const webContainer = await serviceContainerId(context, "web");
  const imageAssets = JSON.parse(await captureDocker([
    "exec", webContainer, "node", "--input-type=module", "-e",
    `import { existsSync, readdirSync, statSync } from "node:fs";
     import { join, relative } from "node:path";
     const files = [];
     function visit(directory) {
       for (const item of readdirSync(directory, { withFileTypes: true })) {
         const path = join(directory, item.name);
         if (item.isDirectory()) {
           if (item.name !== "node_modules" && item.name !== ".next") visit(path);
         } else files.push({ path: relative("/app", path), bytes: statSync(path).size });
       }
     }
     visit("/app");
     console.log(JSON.stringify({ sourceDirectory: existsSync("/app/3d-source"), files }));`
  ])) as { sourceDirectory: boolean; files: Array<{ path: string; bytes: number }> };
  assert.equal(imageAssets.sourceDirectory, false, "Web 镜像不得包含 3d-source 原始资产。");
  const glbs = imageAssets.files.filter((file) => file.path.endsWith(".glb"));
  assert.deepEqual(
    glbs.map((file) => file.path).sort(),
    [
      "public/models/agent-entry/birthday-2026/scene.glb",
      "public/models/agent-entry/default/scene.glb"
    ],
    "Web 镜像必须只含两个已提升的正式 GLB，不得包含原始模型或临时候选。"
  );
  for (const file of glbs) {
    assert(file.bytes > 20 && file.bytes <= 8 * 1024 * 1024, `${file.path} 不满足 8 MiB 资产预算。`);
  }
  assert.equal(
    imageAssets.files.some((file) => /(?:^|\/)(?:3d-source|[^/]*candidates?[^/]*)(?:\/|$)/u.test(file.path)),
    false,
    "Web 镜像不得包含临时候选目录。"
  );
  const web = await inspectContainer(context, "web");
  const imageId = asString(web.Image, "Web inspect.Image 缺失。");
  const imageBytes = (await captureDocker(["image", "inspect", "--format", "{{.Size}}", imageId])).trim();
  console.log(`[compose-smoke] Web 镜像 ${imageBytes} bytes；正式 GLB：${JSON.stringify(glbs)}。`);
}

async function jsonRequest(
  url: string,
  init: RequestInit,
  expectedStatus: number
): Promise<{ payload: unknown; response: Response }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} 返回非 JSON 响应（status=${response.status}）：${text.slice(0, 500)}`);
  }
  assert.equal(
    response.status,
    expectedStatus,
    `${url} 状态码异常：${response.status}，body=${text.slice(0, 500)}`
  );
  return { payload, response };
}

function extractSessionCookie(response: Response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const values = [...setCookie.matchAll(/(?:^|,\s*)xoxo_session=([^;]*)/gu)]
    .map((match) => match[1].trim())
    .filter(Boolean);
  const value = values.at(-1);
  assert(value, "注册响应未返回有效 xoxo_session cookie。");
  return `xoxo_session=${value}`;
}

async function exerciseWorkerThroughWeb(context: SmokeContext) {
  const requestHeaders = {
    "content-type": "application/json",
    origin: context.baseUrl
  };
  const registration = await jsonRequest(
    `${context.baseUrl}/api/auth/register`,
    {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        email: `compose-smoke-${randomBytes(6).toString("hex")}@example.com`,
        password: "compose-smoke-password-2026",
        displayName: "Compose Smoke",
        inviteCode: (await readTemporaryInviteCode(context.envFile)),
        timezone: "Asia/Shanghai"
      })
    },
    200
  );
  const cookie = extractSessionCookie(registration.response);
  const registrationBody = asRecord(registration.payload, "注册响应必须为对象。");
  const room = asRecord(registrationBody.room, "注册响应缺少 room。");
  const roomId = asString(room.id, "注册响应 room.id 无效。");

  const dispatch = await jsonRequest(
    `${context.baseUrl}/api/agent/dispatch`,
    {
      method: "POST",
      headers: { ...requestHeaders, cookie },
      body: JSON.stringify({ roomId, content: "请介绍一下你自己" })
    },
    201
  );
  const dispatchBody = asRecord(dispatch.payload, "Agent dispatch 响应必须为对象。");
  const createdTask = asRecord(dispatchBody.task, "Agent dispatch 响应缺少 task。");
  const taskId = asString(createdTask.id, "Agent dispatch task.id 无效。");

  const completedTask = await waitFor("独立 Agent Worker 完成任务", 60_000, async () => {
    const taskResponse = await jsonRequest(
      `${context.baseUrl}/api/agent/tasks/${taskId}`,
      { headers: { cookie } },
      200
    );
    const body = asRecord(taskResponse.payload, "Agent task 响应必须为对象。");
    const task = asRecord(body.task, "Agent task 响应缺少 task。");
    const status = asString(task.status, "Agent task status 无效。");
    if (["failed", "cancelled", "limit_exceeded", "waiting_approval"].includes(status)) {
      throw new Error(`Agent task 进入非预期终态 ${status}：${String(task.error ?? "")}`);
    }
    return status === "completed" ? task : undefined;
  });

  assert.equal(completedTask.attemptCount, 1, "Agent task 应只被 Worker claim 一次。");
  const finalMessage = asRecord(completedTask.finalMessage, "完成任务缺少 finalMessage。");
  const finalMessageId = asString(finalMessage.id, "finalMessage.id 无效。");
  const finalContent = asString(finalMessage.content, "finalMessage.content 无效。");
  assert(finalContent.length > 0, "Agent 最终消息为空。");

  assert(Array.isArray(completedTask.steps), "完成任务缺少 durable steps。");
  const steps = completedTask.steps.map((step) => asRecord(step, "Agent step 必须为对象。"));
  for (const stepKey of ["plan", "final"]) {
    assert(
      steps.some((step) => step.stepKey === stepKey && step.status === "completed"),
      `缺少 completed ${stepKey} durable step。`
    );
  }

  assert(Array.isArray(completedTask.eventLogs), "完成任务缺少 event logs。");
  const runningEvent = completedTask.eventLogs
    .map((event) => asRecord(event, "Event log 必须为对象。"))
    .find((event) => event.type === "agent.task.running");
  assert(runningEvent, "未找到 agent.task.running 事件。");
  const runningPayload = asRecord(runningEvent.payload, "agent.task.running payload 无效。");
  const runningWorkerId = asString(runningPayload.workerId, "运行事件缺少 workerId。");
  const workerHostname = (
    await captureCompose(context, ["exec", "--no-TTY", "agent-worker", "hostname"])
  ).trim();
  assert(
    runningWorkerId.startsWith(`${workerHostname}:`),
    `任务由非预期 Runtime 消费：workerId=${runningWorkerId}, container=${workerHostname}`
  );

  const messagesResponse = await jsonRequest(
    `${context.baseUrl}/api/rooms/${roomId}/messages`,
    { headers: { cookie } },
    200
  );
  const messagesBody = asRecord(messagesResponse.payload, "消息列表响应必须为对象。");
  assert(Array.isArray(messagesBody.messages), "消息列表缺少 messages。");
  const visibleFinalMessage = messagesBody.messages
    .map((message) => asRecord(message, "Message 必须为对象。"))
    .find((message) => message.id === finalMessageId && message.content === finalContent);
  assert(visibleFinalMessage, "Worker 最终消息未出现在房间消息 API 中。");

  console.log(
    `[compose-smoke] task=${taskId} 由 worker=${runningWorkerId} 完成，durable plan/final 与可见消息均已验证。`
  );

  const identityResponse = await jsonRequest(`${context.baseUrl}/api/auth/me`, { headers: { cookie } }, 200);
  const viewerId = asString(asRecord(identityResponse.payload, "身份响应无效。").id, "身份响应缺少 id。");
  const privateHeaders = { ...requestHeaders, cookie, "X-Agent-Viewer-Id": viewerId };
  const privateSend = await jsonRequest(`${context.baseUrl}/api/agent/conversation/messages`, {
    method: "POST", headers: privateHeaders,
    body: JSON.stringify({ content: "这是我的专属对话，请介绍一下你自己", clientMessageId: randomUUID() }),
  }, 201);
  assert.match(privateSend.response.headers.get("cache-control") ?? "", /private.*no-store/u);
  const accepted = asRecord(privateSend.payload, "私聊发送响应无效。");
  const privateTaskId = asString(asRecord(accepted.task, "私聊缺少 task。").id, "私聊缺少 taskId。");
  const privateRoomId = asString(accepted.roomId, "私聊缺少 roomId。");
  assert.notEqual(privateRoomId, roomId, "私聊不能复用共享房间。");
  const privateTask = await waitFor("独立 Worker 完成私聊任务", 60_000, async () => {
    const response = await jsonRequest(`${context.baseUrl}/api/agent/tasks/${privateTaskId}`, { headers: privateHeaders }, 200);
    const task = asRecord(asRecord(response.payload, "私聊任务响应无效。").task, "私聊 task 缺失。");
    const status = asString(task.status, "私聊任务状态缺失。");
    assert(!["failed", "cancelled", "limit_exceeded", "waiting_approval"].includes(status), `私聊任务进入意外状态 ${status}`);
    return status === "completed" ? task : undefined;
  });
  const privateFinal = asRecord(privateTask.finalMessage, "私聊缺少最终消息。");
  assert(Array.isArray(privateTask.eventLogs), "私聊缺少持久运行事件。");
  const privateRunning = privateTask.eventLogs.map((event) => asRecord(event, "私聊事件无效。"))
    .find((event) => event.type === "agent.task.running");
  assert(privateRunning, "私聊缺少 running 事件。");
  const privateWorkerId = asString(asRecord(privateRunning.payload, "私聊事件payload无效。").workerId, "私聊事件缺少workerId。");
  assert(privateWorkerId.startsWith(`${workerHostname}:`), "私聊必须由独立 Worker 容器消费。");
  const privateSnapshot = await jsonRequest(`${context.baseUrl}/api/agent/conversation`, { headers: privateHeaders }, 200);
  const snapshot = asRecord(privateSnapshot.payload, "私聊快照无效。");
  assert.equal(snapshot.roomId, privateRoomId);
  assert(Array.isArray(snapshot.messages), "私聊快照缺少 messages。");
  const privateMessages = snapshot.messages.map((message) => asRecord(message, "私聊消息无效。"));
  assert(privateMessages.some((message) => message.id === privateFinal.id && message.content === privateFinal.content), "Worker 回复未出现在专属快照。");
  assert(privateMessages.every((message) => message.role === "user" || message.role === "agent"), "私聊出现第三种角色。");
  const sharedOnly = await jsonRequest(`${context.baseUrl}/api/rooms/${roomId}/messages`, { headers: { cookie } }, 200);
  const sharedMessages = asRecord(sharedOnly.payload, "共享消息响应无效。").messages;
  assert(Array.isArray(sharedMessages), "共享 messages 缺失。");
  assert(!sharedMessages.some((message) => asRecord(message, "共享消息无效。").id === privateFinal.id), "私聊回复混入共享 Chat。");
  await exerciseBlogAssetCleanup(context, cookie, viewerId);
  console.log(`[compose-smoke] private task=${privateTaskId} 由 worker=${privateWorkerId} 完成，专属快照、双角色、禁缓存与共享隔离均已验证。`);
}

async function exerciseBlogAssetCleanup(context: SmokeContext, cookie: string, viewerId: string) {
  const headers = { cookie, origin: context.baseUrl, "content-type": "application/json", "X-Blog-Viewer-Id": viewerId };
  const created = await jsonRequest(`${context.baseUrl}/api/blog/works`, {
    method: "POST", headers, body: JSON.stringify({ mutationId: randomUUID(), viewportX: 0, viewportY: 0, viewportWidth: 960, viewportHeight: 540, draftX: 0, draftY: 0 }),
  }, 200);
  const work = asRecord(asRecord(created.payload, "草稿创建结果无效").work, "草稿缺失");
  const workId = asString(work.id, "缺少作品 ID");
  const form = new FormData();
  form.set("file", new Blob([Buffer.from("89504e470d0a1a0a49454e44", "hex")], { type: "image/png" }), "smoke.png");
  form.set("metadata", JSON.stringify({ mutationId: randomUUID(), baseRevision: work.revision, expectedStatus: "draft", data: { x: 10, y: 10, width: 320, height: 240, caption: "隔离清理测试" } }));
  const upload = await jsonRequest(`${context.baseUrl}/api/blog/works/${workId}/uploads`, { method: "POST", headers: { cookie, origin: context.baseUrl, "X-Blog-Viewer-Id": viewerId }, body: form }, 200);
  const uploaded = asRecord(upload.payload, "图片上传无效");
  const uploadedWork = asRecord(uploaded.work, "上传后作品无效");
  assert(Array.isArray(uploadedWork.elements));
  const photo = asRecord(uploadedWork.elements[0], "图片缺失");
  const imageUrl = asString(photo.imageUrl, "图片地址缺失");
  const before = await fetch(`${context.baseUrl}${imageUrl}`, { headers: { cookie } });
  assert.equal(before.status, 200); assert.match(before.headers.get("cache-control") ?? "", /no-store/u);
  await jsonRequest(`${context.baseUrl}/api/blog/works/${workId}`, { method: "DELETE", headers, body: JSON.stringify({ mutationId: randomUUID(), baseRevision: uploadedWork.revision, expectedStatus: "draft" }) }, 200);
  const key = decodeURIComponent(imageUrl.slice("/api/atlas/uploads/".length));
  // 在本次隔离账本上模拟晚到的对象写入，验证镜像内 CLI 的实际回收能力。
  const script = `import { prisma } from "./lib/prisma.ts"; import { getAtlasStorage } from "./lib/storage/atlas-storage.ts";
    const key = ${JSON.stringify(key)}; const asset = await prisma.blogMediaAsset.findUniqueOrThrow({where:{storageKey:key}});
    if (asset.status !== "cleanup") throw new Error("cleanup ledger missing");
    await getAtlasStorage().save({key,body:Buffer.from("late smoke write"),contentType:"image/png"});
    await prisma.blogMediaAsset.update({where:{id:asset.id},data:{nextRetryAt:null}}); await prisma.$disconnect();`;
  await captureCompose(context, ["exec", "-T", "agent-worker", "node", "--import", "tsx", "--input-type=module", "-e", script]);
  const dry = await captureCompose(context, ["exec", "-T", "agent-worker", "npm", "run", "blog:assets:cleanup", "--", "--dry-run", "--limit=100"]);
  assert.match(dry, /"inspected":1/u); assert.match(dry, /"deleted":0/u);
  const cleaned = await captureCompose(context, ["exec", "-T", "agent-worker", "npm", "run", "blog:assets:cleanup", "--", "--limit=100"]);
  assert.match(cleaned, /"deleted":1/u); assert.match(cleaned, /"failed":0/u);
  assert.equal((await fetch(`${context.baseUrl}${imageUrl}`, { headers: { cookie } })).status, 404);
  await captureCompose(context, ["exec", "-T", "agent-worker", "node", "--import", "tsx", "--input-type=module", "-e", `import { getAtlasStorage,isAtlasStorageNotFoundError } from "./lib/storage/atlas-storage.ts"; let missing=false; try { await getAtlasStorage().read(${JSON.stringify(key)}); } catch(e) { missing=isAtlasStorageNotFoundError(e); } if(!missing) throw new Error("blob still exists");`]);
  console.log("[compose-smoke] 草稿迁移、私密上传、删除授权及 worker 镜像内回收 CLI/dry-run 已验证。");
}

async function readTemporaryInviteCode(envFile: string) {
  const contents = await readFile(envFile, "utf8");
  const line = contents.split("\n").find((entry) => entry.startsWith("INVITE_CODE="));
  assert(line, "临时 Compose env 缺少 INVITE_CODE。");
  return line.slice("INVITE_CODE=".length);
}

async function assertInitSucceeded(context: SmokeContext) {
  const init = await inspectContainer(context, "init");
  const state = asRecord(init.State, "init inspect.State 缺失。");
  assert.equal(state.Status, "exited", "init 容器未退出。");
  assert.equal(state.ExitCode, 0, `init 容器退出码异常：${String(state.ExitCode)}`);
  console.log("[compose-smoke] init 已成功执行 migrate deploy 与 seed，并以 exit 0 退出。");
}

async function preserveFailureLogs(context: SmokeContext, failure: unknown) {
  const outputDirectory = join(repositoryRoot, "test-results", "compose-smoke");
  const outputPath = join(outputDirectory, `${context.projectName}.log`);
  let composePs = "";
  let composeLogs = "";

  try {
    composePs = await captureCompose(context, ["ps", "--all"]);
  } catch (error) {
    composePs = `无法读取 compose ps：${errorText(error)}`;
  }
  try {
    composeLogs = await captureCompose(context, ["logs", "--no-color", "--timestamps"]);
  } catch (error) {
    composeLogs = `无法读取 compose logs：${errorText(error)}`;
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    outputPath,
    [
      `project: ${context.projectName}`,
      `failedAt: ${new Date().toISOString()}`,
      "",
      "failure:",
      errorText(failure),
      "",
      "compose ps:",
      composePs,
      "",
      "compose logs:",
      composeLogs
    ].join("\n"),
    "utf8"
  );
  console.error(`[compose-smoke] 失败日志已保留：${outputPath}`);
}

async function cleanupCompose(context: SmokeContext) {
  // init/worker 用容器 UID 创建的嵌套上传目录须先交还宿主用户，才能完整删除隔离 bind mount。
  const workerImage = `${context.projectName}-worker:smoke`;
  const builtImage = await captureDocker(["image", "ls", "--quiet", workerImage]);
  if (builtImage.trim() && process.getuid && process.getgid) {
    await captureCompose(context, ["run", "--rm", "--no-deps", "--user", "0:0", "agent-worker", "chown", "-R", `${process.getuid()}:${process.getgid()}`, "/app/data/chat-logs", "/app/data/atlas-uploads"]);
  }
  await runCompose(context, [
    "down",
    "--volumes",
    "--remove-orphans",
    "--rmi",
    "local",
    "--timeout",
    "10"
  ]);

  for (const image of [
    `${context.projectName}-worker:smoke`,
    `${context.projectName}-web:latest`
  ]) {
    await captureDocker(["image", "remove", image]).catch(() => "");
  }

  const remaining = {
    containers: await captureDocker([
      "container",
      "ls",
      "--all",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${context.projectName}`
    ]),
    images: (
      await Promise.all([
        captureDocker(["image", "ls", "--quiet", `${context.projectName}-worker:smoke`]),
        captureDocker(["image", "ls", "--quiet", `${context.projectName}-web:latest`])
      ])
    ).join(""),
    networks: await captureDocker([
      "network",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${context.projectName}`
    ]),
    volumes: await captureDocker([
      "volume",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${context.projectName}`
    ])
  };
  for (const [resourceType, identifiers] of Object.entries(remaining)) {
    assert.equal(
      identifiers.trim(),
      "",
      `Compose smoke 清理后仍残留 ${resourceType}：${identifiers.trim()}`
    );
  }
}

async function runSmoke(context: SmokeContext) {
  let failure: unknown;

  try {
    await assertBuildContextIsolation(context);
    await runCompose(context, ["build", "web", "agent-worker"]);
    await runCompose(context, ["up", "--detach", "--no-build", "init"]);
    await runCompose(context, ["wait", "init"]);
    await assertInitSucceeded(context);
    await runCompose(context, ["up", "--detach", "--no-build", "web", "agent-worker"]);
    await waitForHealthyWeb(context);
    await assertProductionProcesses(context);
    await assertProductionImageIsolation(context);
    await inspectImageDependencies(context);
    await assertWebImageAssets(context);
    await exerciseWorkerThroughWeb(context);
  } catch (error) {
    failure = error;
    await preserveFailureLogs(context, error).catch((logError) => {
      console.error(`[compose-smoke] 保存失败日志时出错：${errorText(logError)}`);
    });
  }

  try {
    await cleanupCompose(context);
  } catch (cleanupError) {
    console.error(`[compose-smoke] 清理隔离资源失败：${errorText(cleanupError)}`);
    failure ??= cleanupError;
  }

  if (failure) throw failure;
  console.log(`[compose-smoke] ${context.projectName} 通过，隔离容器、网络、卷与测试镜像已清理。`);
}

async function main() {
  if (configOnly) {
    for (const theme of [undefined, "default", "birthday-2026"] as const) {
      const context = await createContext(theme);
      try {
        await validateComposeConfig(context, theme ?? "default");
      } finally {
        await rm(context.temporaryRoot, { force: true, recursive: true });
      }
    }
    console.log("[compose-config] 缺省值及两主题的静态配置门禁通过；该命令未访问 Docker daemon。");
    return;
  }
  const context = await createContext("default");
  try {
    await validateComposeConfig(context);
    await runSmoke(context);
  } finally {
    await rm(context.temporaryRoot, { force: true, recursive: true });
  }
}

main()
  .catch((error) => {
    console.error(errorText(error));
    process.exitCode = 1;
  })
  .finally(() => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  });
