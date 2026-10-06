import { useId } from "react";

import type { ChatUser } from "@/components/chat/types";
import { resolveParticipantPair } from "@/lib/participant-resolution";

type TimezoneSelectorProps = {
  value: string;
  onChange: (tz: string) => void;
  participants: ChatUser[];
  label?: string;
};

export function TimezoneSelector({
  value,
  onChange,
  participants,
  label = "时区",
}: TimezoneSelectorProps) {
  const id = useId();
  const options = buildTimezoneOptions(participants);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-black/70">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border border-[#d9d9d9] bg-white px-4 py-3 text-[15px] leading-normal transition-colors duration-200 focus:border-[#3a5b22] focus:ring-2 focus:ring-[#3a5b22]/15 focus:outline-hidden cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function buildTimezoneOptions(participants: ChatUser[]) {
  const seen = new Set<string>();
  const options: Array<{ label: string; value: string }> = [];

  for (const p of participants) {
    const tz = p.profile?.timezone;
    if (tz && !seen.has(tz)) {
      seen.add(tz);
      options.push({ label: `${p.displayName} (${tz})`, value: tz });
    }
  }

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!seen.has(browserTz)) {
    options.push({ label: `本机 (${browserTz})`, value: browserTz });
  }

  return options;
}

/** 从当前用户档案获取默认时区，不把参与者数组顺序当作身份。 */
export function getDefaultTimezone(
  participants: ChatUser[],
  currentUserId: string
): string {
  const { self } = resolveParticipantPair(
    participants,
    currentUserId,
    (participant) => participant.id
  );
  return (
    self?.profile?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}
