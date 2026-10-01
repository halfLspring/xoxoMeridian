# Harness 状态维护

本文件只在维护状态格式或查历史时读取。日常启动仍依次读取根目录 `AGENTS.md`、`feature_list.json`、`session-handoff.md`，状态文件只向上下文输出当前总览、未完成任务和选中任务的完整记录，随后读取相关专题资料。不要批量输出当前批次全部 done 正文，也不要递归加载本目录。

## 当前状态与历史的分工

| 文件 | 保留内容 |
| --- | --- |
| [feature_list.json](../../feature_list.json) | 全部未完成项及当前批次全部 done；状态、依赖、排序、完整验收、简短证据；`featuresNumber` 记录根列表条目数 |
| [session-handoff.md](../../session-handoff.md) | 仅供下一会话恢复，每轮任务结束均重写；不追加、不归档、不保留历史版本 |
| `archive/` | 按批次保存的已完成 feature 全文及验收证据，不包含交接文件 |

取消所有按字节数设置的归档限制、单文件预算和合计上限。上下文占用通过按任务检索、合并重复摘要和批量归档控制，不以文件体积、日期或会话次数触发归档。保留完整验收、失败命令、未运行原因和未决约定。

根列表拥有当前任务状态，质量分数与问题详情归各 QAM 报告。feature 条目负责验证记录，交接负责下一会话如何恢复；详细证据按需链接项目文档，不复制整个实现说明或审查报告。用户约定“未修改代码时不必运行应用验证”已写入 `AGENTS.md`；文档整理的结构核验不能被表述为产品验收。

## 归档触发与计数

- `featuresNumber` 是根 `features` 数组的条目总数，包含全部状态，不含历史归档。常规收尾先读这个字段：不超过 40 时直接跳过归档，无须重数 done；超过 40 时，再统计根列表中 `status === "done"` 的唯一 ID。
- **仍以超过 40 个 done 为归档条件。** 根列表总数超过 40 但 done 未超过 40 时继续保留。触发后一次移出本批全部 done 条目及其验收证据，未完成项留在根列表；done 归零，`featuresNumber` 改为剩余条目数。历史归档、仅提及的 ID 和未登记 feature 的文档维护均不计入这个字段。
- 全部未完成任务及其验收、失败证据、有效约定和下一步仍留在根文件。历史验证记录不能代替根列表的当前状态，也不增加归档 JSON 的任务数。
- 每批只产生一份 feature JSON。除用户明确要求的历史整理外，不提前归档、按单任务拆文件或创建逐会话/同日序号快照。
- `session-handoff.md` 只连接相邻两次会话，每轮任务结束均重写；不保存旧稿或任何归档副本，也不转存完整旧交接。需要长期追踪的事实、失败证据和约定直接写入 feature 条目或项目文档，交接仅摘要引用。此约定以用户要求为准，不将技能的一般持久记忆规则套用到交接文件。

## feature_list.json 格式（schemaVersion 2）

- `features` 保持原有条目字段和四种状态，未完成项保留完整验收及优先级；`archivedFeatureFiles` 是相对仓库根的 JSON 文件路径数组。
- `featuresNumber` 为非负整数，始终等于根 `features.length`。新增任务时加一；归档或移回任务时按移出/移入数同步更新；只修改状态、验收或证据时不变。重开归档任务须先移回完整条目并更新该字段。它不是 done 数、全历史总数或下一个 feature ID，不能用它生成 ID；归档 JSON 不需要补写根列表的计数字段。
- 维护条目数组的同一次编辑必须同步维护 `featuresNumber`；发现不一致时以实际数组长度修正，不能删改任务来配合旧计数。常规归档判断读取字段，只有数组变更、格式维护或发现不一致时才核对字段与长度，避免每轮重复全量统计。
- 归档文件也有 `features` 数组，只能包含 `done` 条目。全量账本是根数组与所有登记归档的并集；ID 不重复、不复用，依赖允许指向任意归档。
- 创建 ID 时先检查并集的最大编号，不能用根数组长度推断。新项开始前，逐个提取依赖并确认 `done`；没有读到的归档依赖不能直接当作已满足。
- 已完成项迁移时保留全部字段与原始验收证据，不合并为只有 ID 的墓碑。需要重新打开时，先将完整条目从归档移回根列表，再更新状态；不能留下两个版本。
- `priorityRank` 仍是既有 P2 批次顺序，`dependencies` 只表示前置条件。历史日志里的“当前状态”“下一步”只描述当时情况。
- 读取工具必须显式合并 `archivedFeatureFiles` 才能宣称全量统计；只读根 `features` 得到的是当前工作集。

在仓库根执行下面的只读命令，提取一个完整条目；更换末尾 ID 即可。JSON 在进程内读取，终端只输出目标项。

```bash
./scripts/run-node22.sh node --input-type=module - feat-044 <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const current = read("feature_list.json");
const all = [...current.features, ...current.archivedFeatureFiles.flatMap((file) => read(file).features)];
const matches = all.filter(({ id }) => id === process.argv[2]);
assert.equal(matches.length, 1, "目标 ID 必须存在且唯一");
console.log(JSON.stringify(matches[0], null, 2));
NODE
```

常规启动读取根 JSON 的 `featuresNumber` 和未完成项；done 的完整正文仅在选中或作为依赖时提取。历史验证记录先按 `feat-NNN` 定位对应区段，避免整份读取。

## 批量归档步骤

1. 工作前查看 `git status --short`，以当前工作树为迁移来源，包含未提交记录；不得用 HEAD 覆盖用户的新内容。
2. 收尾先读取 `featuresNumber`，不超过 40 时只更新当前记录；超过 40 时再检查 done 数，满足 done 超过 40 才启动一次全批次归档。长期证据应已经写入 feature 条目或其引用的项目文档。
3. 以未使用的批次号写入 `archive/features-batch-NNN.json`；保留初次批次的既有文件名，后续从 `002` 起。JSON 保存本批全部 done 的原字段、归档日期及批次说明；编号空洞不补造任务，已存在的批次文件不覆盖。
4. 核对全量 feature 字段与验收证据完整后，登记新的 `archivedFeatureFiles` 路径，将本批全部 done 移出根数组，同步把 `featuresNumber` 更新为剩余条目数。同步更新所有指向已迁移任务的引用；相对 Markdown 链接按新位置修正，命令中的路径仍以仓库根为工作目录。
5. 每轮任务结束重写交接，不参与归档，也不另存旧版。异常中断后先检查根与归档中的重复 ID，确认内容一致后完成迁移并修正 `featuresNumber`；历史状态不能用于回滚当前状态。
6. 比较迁移前后全量字段、ID 唯一性、依赖存在及已满足状态、排序、验收证据与链接；确认根列表 done 已归零，`featuresNumber` 等于剩余数组长度，未完成任务及失败证据未丢失。更新本页目录，重写交接，检查 `git diff --check`、`git status --short`；只做文档归档时沿用应用门禁例外。

以下只读账本核对示例用于数组变更、归档或状态格式维护，无须常规每轮运行；不包含体积判断或应用测试，迁移时还须比较前后字段及验收证据。

```bash
./scripts/run-node22.sh node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const current = read("feature_list.json");
assert.equal(current.schemaVersion, 2);
assert.ok(Number.isInteger(current.featuresNumber) && current.featuresNumber >= 0);
assert.equal(current.featuresNumber, current.features.length, "featuresNumber 须与根列表条目数一致");
const archived = current.archivedFeatureFiles.flatMap((file) => read(file).features);
const all = [...current.features, ...archived];
const byId = new Map(all.map((item) => [item.id, item]));
assert.equal(byId.size, all.length, "ID 重复");
assert.ok(archived.every((item) => item.status === "done"));
if (current.featuresNumber > 40) {
  const doneCount = current.features.filter((item) => item.status === "done").length;
  assert.ok(doneCount <= 40, "超过 40 个 done，须将本批全部已完成记录一次归档");
}
assert.ok(all.filter((item) => item.status === "in-progress").length <= 1);
for (const item of all) {
  assert.match(item.id, /^feat-\d{3,}$/);
  assert.ok(["not-started", "in-progress", "blocked", "done"].includes(item.status));
  assert.ok(item.acceptanceCriteria.length > 0);
  for (const id of item.dependencies) {
    assert.ok(byId.has(id), `${item.id} 缺少依赖 ${id}`);
    if (["in-progress", "done"].includes(item.status)) assert.equal(byId.get(id).status, "done");
  }
}
console.log("featuresNumber、状态与依赖核对通过");
NODE
```

## 历史目录

当前任务入口始终是根 `feature_list.json`；以下文件仅在查询对应历史任务时读取。

| 文件 | 内容 |
| --- | --- |
| [features-001-053.json](archive/features-001-053.json) | feat-001～053 已完成记录（schemaVersion 1） |
| [features-batch-002.json](archive/features-batch-002.json) | 第二次归档：feat-054～096 已完成记录，2026-10-01 迁移，条目保留 priority/priorityRank/sourceReport 等原字段（schemaVersion 2） |
| [首批验证记录](archive/progress-through-2026-09-12.md) | 首批任务的验证命令、失败与恢复证据 |
