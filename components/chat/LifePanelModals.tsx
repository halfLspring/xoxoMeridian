"use client";

import { useState } from "react";
import type { ChatUser, LifeMemo, LifeScheduledJob } from "@/components/chat/types";
import { BaseModal, ModalActions } from "@/components/chat/BaseModal";
import { TimezoneSelector, getDefaultTimezone } from "@/components/chat/TimezoneSelector";
import { CronBuilder } from "@/components/chat/CronBuilder";
import {
  DEFAULT_MEMO_TITLE,
  MEMO_CONTENT_MAX_LENGTH,
  MEMO_TITLE_MAX_LENGTH,
  SCHEDULE_DESCRIPTION_MAX_LENGTH,
  memoContentSchema,
  memoTitleSchema,
  scheduleDescriptionSchema,
} from "@/lib/life-authoring-contract";
import { showError, submitForm } from "@/lib/ui-utils";
import { formatWallClockInZone, wallClockInZoneToDate } from "@/lib/zoned-time";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  onSuccess: () => void;
};

type MemoModalProps = ModalProps & {
  memo?: LifeMemo;
};

type ScheduledJobModalProps = ModalProps & {
  job?: LifeScheduledJob;
  currentUserId: string;
  participants: ChatUser[];
};

export function MemoModal({ isOpen, onClose, roomId, memo, onSuccess }: MemoModalProps) {
  if (!isOpen) return null;

  return (
    <MemoModalForm
      key={memo?.id ?? "new"}
      onClose={onClose}
      roomId={roomId}
      memo={memo}
      onSuccess={onSuccess}
    />
  );
}

function MemoModalForm({ onClose, roomId, memo, onSuccess }: Omit<MemoModalProps, "isOpen">) {
  const [busy, setBusy] = useState(false);
  const [formData, setFormData] = useState(() => ({
      title: memo?.title ?? DEFAULT_MEMO_TITLE,
      content: memo?.content ?? "",
      pinned: memo?.pinned ?? false,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const url = memo ? `/api/rooms/${roomId}/memos/${memo.id}` : `/api/rooms/${roomId}/memos`;
      const method = memo ? "PATCH" : "POST";
      // PATCH 只提交修改过的文本，保留旧记录未编辑字段的完整原文。
      const payload = memo ? {
        ...(formData.title !== memo.title ? { title: memoTitleSchema.parse(formData.title) } : {}),
        ...(formData.content !== memo.content ? { content: memoContentSchema.parse(formData.content) } : {}),
        pinned: formData.pinned,
      } : {
        title: memoTitleSchema.parse(formData.title),
        content: memoContentSchema.parse(formData.content),
        pinned: formData.pinned,
      };
      await submitForm(url, method, payload);
      onSuccess();
      onClose();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} title={memo ? "编辑备忘录" : "新建备忘录"}>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="memo-title" className="block text-sm font-medium text-black/70">标题 *</label>
          <input
            id="memo-title"
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="mt-1 w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden"
            required
            maxLength={Math.max(MEMO_TITLE_MAX_LENGTH, memo?.title.length ?? 0)}
            aria-describedby={memo && memo.title.length > MEMO_TITLE_MAX_LENGTH ? "memo-title-legacy" : undefined}
          />
          <LegacyTextHint id="memo-title-legacy" value={memo?.title} maxLength={MEMO_TITLE_MAX_LENGTH} />
        </div>
        <div>
          <label htmlFor="memo-content" className="block text-sm font-medium text-black/70">内容 *</label>
          <textarea
            id="memo-content"
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            className="mt-1 w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden"
            rows={5}
            required
            maxLength={Math.max(MEMO_CONTENT_MAX_LENGTH, memo?.content.length ?? 0)}
            aria-describedby={memo && memo.content.length > MEMO_CONTENT_MAX_LENGTH ? "memo-content-legacy" : undefined}
          />
          <LegacyTextHint id="memo-content-legacy" value={memo?.content} maxLength={MEMO_CONTENT_MAX_LENGTH} />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="pinned"
            checked={formData.pinned}
            onChange={(e) => setFormData({ ...formData, pinned: e.target.checked })}
            className="h-4 w-4 rounded-sm border-warm-300 text-sage-600 focus:ring-sage-500"
          />
          <label htmlFor="pinned" className="text-sm font-medium text-black/70">
            置顶
          </label>
        </div>
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </BaseModal>
  );
}

export function ScheduledJobModal({
  isOpen,
  onClose,
  roomId,
  job,
  currentUserId,
  participants,
  onSuccess,
}: ScheduledJobModalProps) {
  if (!isOpen) return null;

  return (
    <ScheduledJobModalForm
      key={job?.id ?? "new"}
      onClose={onClose}
      roomId={roomId}
      job={job}
      currentUserId={currentUserId}
      participants={participants}
      onSuccess={onSuccess}
    />
  );
}

function ScheduledJobModalForm({
  onClose,
  roomId,
  job,
  currentUserId,
  participants,
  onSuccess,
}: Omit<ScheduledJobModalProps, "isOpen">) {
  const [busy, setBusy] = useState(false);
  const isOnce = !!job?.payload?.runOnce;
  const existingDescription = (job?.payload?.description as string | null) ?? "";
  const [mode, setMode] = useState<"once" | "recurring">(
    isOnce ? "once" : "recurring"
  );
  const [formData, setFormData] = useState(() => {
    const timezone = job?.timezone ?? getDefaultTimezone(participants, currentUserId);
    return {
      description: (job?.payload?.description as string | null) ?? "",
      prompt: (job?.payload?.prompt as string | null) ?? "",
      // `datetime-local` shows a wall clock with no zone, so it has to be read
      // in the job's zone — the same one the sibling timezone selector offers.
      // Reading it as UTC would both mislead the user and, on submit, move the
      // instant by the zone's offset.
      fireAt: job?.nextRunAt ? formatWallClockInZone(new Date(job.nextRunAt), timezone) : "",
      cron: job?.cron ?? "0 9 * * *",
      timezone,
    };
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        prompt: formData.prompt.trim(),
        timezone: formData.timezone,
      };
      if (!job || formData.description !== existingDescription) {
        payload.description = scheduleDescriptionSchema.parse(formData.description);
      }

      if (mode === "once") {
        if (!formData.fireAt) {
          showError("请选择执行时间");
          setBusy(false);
          return;
        }
        payload.fireAt = wallClockInZoneToDate(formData.fireAt, formData.timezone).toISOString();
        payload.runOnce = true;
      } else {
        payload.cron = formData.cron;
        payload.runOnce = false;
      }

      if (job) {
        await submitForm(`/api/rooms/${roomId}/scheduled-jobs/${job.id}`, "PATCH", payload);
      } else {
        await submitForm(`/api/rooms/${roomId}/scheduled-jobs`, "POST", payload);
      }

      onSuccess();
      onClose();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleModeChange = (next: "once" | "recurring") => {
    setMode(next);
    setFormData({
      description: "",
      prompt: "",
      fireAt: "",
      cron: "0 9 * * *",
      timezone: formData.timezone, // 保留时区设置
    });
  };

  return (
    <BaseModal isOpen onClose={onClose} title={job ? "编辑任务" : "新建任务"}>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleModeChange("once")}
            className={`flex-1 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors duration-200 cursor-pointer ${
              mode === "once"
                ? "bg-[#3a5b22]/10 text-[#3a5b22]"
                : "bg-[#fafbfc] text-black/60 hover:bg-neutral-100"
            }`}
          >
            一次性任务
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("recurring")}
            className={`flex-1 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors duration-200 cursor-pointer ${
              mode === "recurring"
                ? "bg-sage-100 text-sage-700"
                : "bg-[#fafbfc] text-black/60 hover:bg-neutral-100"
            }`}
          >
            周期任务
          </button>
        </div>
        <div>
          <label htmlFor="job-description" className="block text-sm font-medium text-black/70">任务描述</label>
          <input
            id="job-description"
            type="text"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="mt-1 w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden"
            placeholder="例如：每天早上的问候"
            maxLength={Math.max(SCHEDULE_DESCRIPTION_MAX_LENGTH, existingDescription.length)}
            aria-describedby={existingDescription.length > SCHEDULE_DESCRIPTION_MAX_LENGTH ? "job-description-legacy" : undefined}
          />
          <LegacyTextHint id="job-description-legacy" value={existingDescription} maxLength={SCHEDULE_DESCRIPTION_MAX_LENGTH} />
        </div>
        <div>
          <label htmlFor="job-prompt" className="block text-sm font-medium text-black/70">执行指令 *</label>
          <textarea
            id="job-prompt"
            value={formData.prompt}
            onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
            className="mt-1 w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden"
            rows={3}
            required
            maxLength={500}
            placeholder="例如：@助手 给对方发一条早安问候"
          />
        </div>
        {mode === "once" ? (
          <div>
            <label htmlFor="job-fire-at" className="block text-sm font-medium text-black/70">执行时间 *</label>
            <input
              id="job-fire-at"
              type="datetime-local"
              value={formData.fireAt}
              onChange={(e) => setFormData({ ...formData, fireAt: e.target.value })}
              className="mt-1 w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden"
              required
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-black/70">执行周期</label>
            <div className="mt-1">
              <CronBuilder
                value={formData.cron}
                onChange={(cron) => setFormData({ ...formData, cron })}
              />
            </div>
          </div>
        )}
        <TimezoneSelector
          value={formData.timezone}
          onChange={(tz) => setFormData({ ...formData, timezone: tz })}
          participants={participants}
        />
        <ModalActions busy={busy} onCancel={onClose} />
      </form>
    </BaseModal>
  );
}

function LegacyTextHint({ id, value, maxLength }: { id: string; value?: string; maxLength: number }) {
  if (!value || value.length <= maxLength) return null;
  return (
    <p id={id} className="mt-1 text-sm text-black/60">
      此字段是较长的旧记录，未修改时会完整保留；如需修改，请缩短至 {maxLength} 字符以内。
    </p>
  );
}
