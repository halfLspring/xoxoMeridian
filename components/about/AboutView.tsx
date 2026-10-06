"use client";

import Image from "next/image";
import { useRef, useEffect, useMemo } from "react";
import { motion, useScroll, useSpring, useInView, useMotionValue, useReducedMotion, type MotionValue } from "framer-motion";

import type { AboutPhoto } from "@/lib/about-photos";

import type { RightNowPerson } from "./right-now-content";

/** 已经解析过照片交付状态的展示模型；`photo.src` 为 null 时渲染内置回退。 */
export type AboutViewPerson = Omit<RightNowPerson, "imageSrc" | "imageAlt"> & {
  photo: AboutPhoto;
};

// ── colour tokens (matching project's sage palette) ───────────
const sage = {
  50: "#f3f7f0",
  100: "#dfead8",
  200: "#c8ddbf",
  300: "#a7c49b",
  400: "#7da878",
  500: "#668a5b",
  600: "#527349",
  700: "#3f5d38",
};

// ── static data ─────────────────────────────────────────────────
const TECH_STACK = [
  { emoji: "💻", label: "Tech stack", val: "Next.js · Prisma · TypeScript · Tailwind" },
  { emoji: "🌍", label: "Timezone-aware", val: "built for different corners of the world" },
  { emoji: "🔒", label: "Privacy-first", val: "end-to-end, just for two" },
];

const INTERESTS: [string, string][] = [
  ["💌", "thoughtful notes"],
  ["📸", "shared memories"],
  ["🌙", "goodnight rituals"],
  ["🎵", "long-distance playlists"],
  ["📝", "daily journaling"],
  ["🌸", "slow living"],
  ["🍵", "morning check-ins"],
  ["✨", "little surprises"],
  ["🗺️", "counting down days"],
  ["🐈", "cat pictures, always"],
  ["📚", "reading together"],
  ["🌿", "growing side by side"],
];

const AMBIENT_DOTS = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  x: (index * 37 + 11) % 100,
  y: (index * 61 + 23) % 100,
  size: 3 + ((index * 17 + 5) % 50) / 10,
  delay: ((index * 29 + 7) % 40) / 10,
  duration: 4 + ((index * 43 + 13) % 40) / 10,
}));

const MOOD_BARS = [
  { label: "handwritten warmth", val: 95 },
  { label: "attention to detail", val: 88 },
  { label: "gentle tech", val: 82 },
];


function FadeUp({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function FloatingLeaf({
  style,
  delay = 0,
}: {
  style?: React.CSSProperties;
  delay?: number;
}) {
  return (
    <motion.div
      style={style}
      initial={{ opacity: 0, scale: 0.6, rotate: -10 }}
      animate={{
        opacity: [0, 0.7, 0.5, 0.7],
        scale: [0.6, 1, 0.95, 1],
        rotate: [-10, 4, -4, 4],
        y: [0, -8, 4, -4],
      }}
      transition={{
        duration: 6 + delay,
        delay,
        repeat: Infinity,
        repeatType: "mirror",
        ease: "easeInOut",
      }}
      className="pointer-events-none select-none absolute"
    >
      <svg
        viewBox="0 0 60 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: 48, height: 64 }}
      >
        <path
          d="M30 75 C10 60 2 40 8 18 C14 -2 46 -2 52 18 C58 40 50 60 30 75Z"
          fill={sage[300]}
          fillOpacity="0.55"
        />
        <path
          d="M30 75 L30 12"
          stroke={sage[500]}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M30 50 C20 44 14 36 16 26"
          stroke={sage[500]}
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M30 50 C40 44 46 36 44 26"
          stroke={sage[500]}
          strokeWidth="1"
          strokeLinecap="round"
        />
      </svg>
    </motion.div>
  );
}

function Sprout() {
  return (
    <svg
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: 56, height: 70 }}
    >
      <path
        d="M40 90 L40 40"
        stroke={sage[600]}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M40 65 C28 58 20 46 24 34 C28 22 52 22 56 34 C60 46 52 58 40 65Z"
        fill={sage[300]}
        fillOpacity="0.8"
      />
      <path
        d="M40 80 C30 72 18 58 20 44"
        stroke={sage[400]}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="40" cy="92" rx="12" ry="4" fill={sage[200]} />
    </svg>
  );
}

function Chip({
  icon,
  label,
  delay = 0,
}: {
  icon: string;
  label: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={inView ? { opacity: 1, scale: 1 } : {}}
      whileHover={{ scale: 1.08, y: -2 }}
      transition={{ duration: 0.4, delay, type: "spring", stiffness: 260, damping: 20 }}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm select-none cursor-default"
      style={{
        background: sage[100],
        color: sage[700],
        border: `1px solid ${sage[200]}`,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </motion.span>
  );
}

function TimelineItem({
  year,
  title,
  desc,
  delay = 0,
}: {
  year: string;
  title: string;
  desc: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -28 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-5"
    >
      <div className="flex flex-col items-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={inView ? { scale: 1 } : {}}
          transition={{
            duration: 0.4,
            delay: delay + 0.15,
            type: "spring",
            stiffness: 300,
          }}
          className="w-4 h-4 rounded-full mt-1 shrink-0"
          style={{
            background: sage[400],
            border: `3px solid ${sage[200]}`,
          }}
        />
        <div className="w-0.5 flex-1 mt-1" style={{ background: sage[200] }} />
      </div>
      <div className="pb-8">
        <p
          style={{
            fontFamily: "var(--font-caveat), cursive",
            fontSize: 15,
            color: sage[500],
          }}
        >
          {year}
        </p>
        <p
          style={{
            fontFamily: "var(--font-lora), serif",
            fontSize: 15,
            fontWeight: 500,
            color: "#3d3d3a",
            marginTop: 2,
          }}
        >
          {title}
        </p>
        <p
          className="text-[13px] mt-1 leading-relaxed"
          style={{ color: "#7a7a72" }}
        >
          {desc}
        </p>
      </div>
    </motion.div>
  );
}

function AmbientDots() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {AMBIENT_DOTS.map((d) => (
        <motion.div
          key={d.id}
          className="absolute rounded-full"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            background: sage[300],
            opacity: 0.35,
          }}
          animate={{ y: [0, -12, 0], opacity: [0.2, 0.5, 0.2] }}
          transition={{
            duration: d.duration,
            delay: d.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

function WavingHand() {
  return (
    <motion.span
      animate={{ rotate: [0, 18, -8, 18, 0] }}
      transition={{
        duration: 1.8,
        repeat: Infinity,
        repeatDelay: 2.5,
        ease: "easeInOut",
      }}
      style={{ display: "inline-block", transformOrigin: "70% 80%" }}
    >
      👋
    </motion.span>
  );
}

function MoodBar({
  label,
  val,
  delay = 0,
}: {
  label: string;
  val: number;
  delay?: number;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  return (
    <div ref={ref} className="mb-3">
      <div className="flex justify-between mb-1">
        <span className="text-xs" style={{ color: sage[700] }}>
          {label}
        </span>
        <span
          className="text-xs"
          style={{
            fontFamily: "var(--font-caveat), cursive",
            color: sage[500],
          }}
        >
          {val}%
        </span>
      </div>
      <div
        className="rounded-full h-2 overflow-hidden"
        style={{ background: sage[100] }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${sage[400]}, ${sage[300]})`,
          }}
          initial={{ width: 0 }}
          animate={inView ? { width: `${val}%` } : {}}
          transition={{ duration: 1, delay, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

const PHOTO_SHADOW = { filter: `drop-shadow(0 18px 30px ${sage[700]}24)` } as React.CSSProperties;
const EYEBROW_STYLE: React.CSSProperties = { fontFamily: "var(--font-caveat), cursive", fontSize: 18, color: sage[500] };
const NAME_STYLE: React.CSSProperties = { fontFamily: "var(--font-lora), serif", color: sage[700] };
const TITLE_STYLE: React.CSSProperties = { fontFamily: "var(--font-lora), serif", fontSize: 16, color: "#3d3d3a" };

export function PersonPhoto({ person }: { person: AboutViewPerson }) {
  const reduceMotion = useReducedMotion();
  const rotate = person.rotation;

  const base = useMemo(
    () => ({
      initial: { opacity: 0, y: reduceMotion ? 0 : 16, rotate },
      whileInView: { opacity: 1, y: 0, rotate },
      whileHover: reduceMotion ? undefined : { y: -4, rotate: rotate + (rotate > 0 ? -1.5 : 1.5) },
    }),
    [reduceMotion, rotate],
  );

  return (
    <motion.div
      initial={base.initial}
      whileInView={base.whileInView}
      whileHover={base.whileHover}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto aspect-[4/5] w-full max-w-[250px] sm:max-w-[280px]"
      style={PHOTO_SHADOW}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[1.75rem]">
        {person.photo.src ? (
          <Image
            src={person.photo.src}
            alt={person.photo.alt}
            fill
            sizes="(min-width: 768px) 260px, 72vw"
            className="object-cover"
          />
        ) : (
          <PhotoFallback photo={person.photo} name={person.name} />
        )}
      </div>
    </motion.div>
  );
}

/**
 * 照片尚未交付时的回退：占满同一照片框，保留同一可访问描述，
 * 只请求内置样式，不向不存在的照片路径发起请求。
 */
function PhotoFallback({ photo, name }: { photo: AboutPhoto; name: string }) {
  return (
    <div
      role="img"
      aria-label={photo.alt}
      className="flex h-full w-full flex-col items-center justify-center gap-1"
      style={{
        background: `linear-gradient(155deg, ${sage[100]} 0%, ${sage[50]} 52%, ${sage[200]} 100%)`,
      }}
    >
      <svg
        viewBox="0 0 60 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ width: 34, height: 46, opacity: 0.75 }}
      >
        <path
          d="M30 75 C10 60 2 40 8 18 C14 -2 46 -2 52 18 C58 40 50 60 30 75Z"
          fill={sage[200]}
        />
        <path d="M30 75 L30 14" stroke={sage[400]} strokeWidth="1.5" strokeLinecap="round" />
        <path
          d="M30 52 C20 46 14 38 16 28"
          stroke={sage[400]}
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M30 52 C40 46 46 38 44 28"
          stroke={sage[400]}
          strokeWidth="1"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontFamily: "var(--font-caveat), cursive",
          fontSize: 30,
          lineHeight: 1.1,
          color: sage[600],
        }}
      >
        {name}
      </span>
      <span
        className="px-4 text-center text-[10px] uppercase tracking-[0.18em]"
        style={{ color: sage[500] }}
      >
        photo coming soon
      </span>
    </div>
  );
}

function PersonNowPanel({ person, index }: { person: AboutViewPerson; index: number }) {
  const isPhotoLeft = person.layout === "photo-left";

  return (
    <div className={person.layout === "photo-right" ? "md:pl-10" : "md:pr-10"}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{
          duration: 0.65,
          delay: index * 0.1,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="grid items-center gap-8 py-7 md:grid-cols-[0.9fr_1.1fr]"
      >
        <div className={isPhotoLeft ? "md:order-1" : "md:order-2"}>
          <PersonPhoto person={person} />
        </div>

        <div className={isPhotoLeft ? "md:order-2" : "md:order-1"}>
          <p className="mb-2" style={EYEBROW_STYLE}>
            {person.eyebrow}
          </p>
          <h3 className="text-[clamp(1.65rem,4vw,2.25rem)] leading-tight" style={NAME_STYLE}>
            {person.name}
          </h3>
          <p className="mt-2" style={TITLE_STYLE}>
            {person.title}
          </p>
          <div className="mt-4 space-y-3">
            {person.body.map((paragraph, i) => (
              <p
                key={`${person.id}-p-${i}`}
                className="text-[14px] leading-relaxed"
                style={{ color: "#5f5f57" }}
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function GrowingVine({ progress }: { progress: MotionValue<number> }) {
  const pathLength = useSpring(progress, { stiffness: 80, damping: 20 });
  return (
    <svg
      viewBox="0 0 40 300"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        width: 40,
        height: 300,
        position: "absolute",
        left: -16,
        top: 0,
      }}
    >
      <motion.path
        d="M20 280 C20 240 10 210 20 180 C30 150 10 120 20 90 C30 60 15 30 20 10"
        stroke={sage[400]}
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        style={{ pathLength }}
      />
      <motion.circle cx="10" cy="190" r="6" fill={sage[300]} style={{ opacity: pathLength }} />
      <motion.circle cx="30" cy="140" r="5" fill={sage[200]} style={{ opacity: pathLength }} />
      <motion.circle cx="12" cy="90" r="7" fill={sage[300]} style={{ opacity: pathLength }} />
    </svg>
  );
}

export function AboutView({ people }: { people: AboutViewPerson[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();

  const cursorX = useMotionValue(-200);
  const cursorY = useMotionValue(-200);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      cursorX.set(e.clientX - 160);
      cursorY.set(e.clientY - 160);
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [cursorX, cursorY]);

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen overflow-x-hidden bg-cream"
    >
      <motion.div
        className="pointer-events-none fixed z-0 rounded-full"
        style={{
          width: 320,
          height: 320,
          background: `radial-gradient(circle, ${sage[200]}55 0%, transparent 70%)`,
          translateZ: 0,
          x: cursorX,
          y: cursorY,
        }}
      />

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6 pt-20 pb-32">
        <AmbientDots />
        <FloatingLeaf style={{ top: "8%", left: "6%" }} delay={0} />
        <FloatingLeaf
          style={{ top: "14%", right: "8%", transform: "scaleX(-1)" }}
          delay={1.2}
        />
        <FloatingLeaf
          style={{ bottom: "22%", left: "4%", transform: "rotate(30deg)" }}
          delay={0.6}
        />
        <FloatingLeaf
          style={{
            bottom: "18%",
            right: "5%",
            transform: "scaleX(-1) rotate(20deg)",
          }}
          delay={1.8}
        />

        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 mb-8"
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="relative"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute rounded-full"
              style={{
                width: 140,
                height: 140,
                background: `conic-gradient(from 0deg, ${sage[300]}, ${sage[100]}, ${sage[400]}, ${sage[100]}, ${sage[300]})`,
                margin: -5,
              }}
            />
            <div
              className="relative rounded-full overflow-hidden flex items-center justify-center"
              style={{
                width: 130,
                height: 130,
                border: "4px solid #fff9f2",
                background: `linear-gradient(135deg, ${sage[200]}, ${sage[50]})`,
              }}
            >
              <span className="text-5xl">🌿</span>
            </div>
          </motion.div>
          <motion.div
            className="absolute -right-6 -bottom-4"
            animate={{ rotate: [0, 6, -3, 6, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sprout />
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="z-10 text-center"
        >
          <h1
            className="text-[clamp(2rem,6vw,3.5rem)] leading-tight"
            style={{
              fontFamily: "var(--font-lora), serif",
              color: "#3f5d38",
              letterSpacing: "-0.01em",
            }}
          >
            Hi there <WavingHand />
          </h1>
          <p
            className="mt-2 text-[clamp(1rem,3vw,1.4rem)]"
            style={{
              fontFamily: "var(--font-lora), serif",
              color: sage[600],
              fontStyle: "italic",
            }}
          >
            We are{" "}
            <span style={{ color: sage[700], fontWeight: 600 }}>XOXO Meridian</span>{" "}
            — a tiny corner of the internet for two 🌸
          </p>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.55 }}
          className="z-10 mt-4 text-center max-w-md"
          style={{
            fontFamily: "var(--font-caveat), cursive",
            fontSize: 20,
            color: sage[500],
            lineHeight: 1.5,
          }}
        >
          &ldquo;Because distance means so little when someone means so
          much.&rdquo;
        </motion.p>

        <motion.div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <p
            className="text-[11px] uppercase tracking-widest"
            style={{ color: sage[400] }}
          >
            scroll
          </p>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="w-0.5 h-8 rounded-full"
            style={{ background: sage[300] }}
          />
        </motion.div>
      </section>

      {/* ── ABOUT CARDS ──────────────────────────────────────── */}
      <section className="relative px-6 py-20 max-w-5xl mx-auto">
        <GrowingVine progress={scrollYProgress} />

        <div className="grid md:grid-cols-2 gap-8">
          <FadeUp delay={0} className="md:col-span-2">
            <div
              className="rounded-3xl p-8 relative overflow-hidden"
              style={{
                background: "rgba(255,252,246,0.7)",
                backdropFilter: "blur(16px)",
                border: `1px solid ${sage[200]}`,
                boxShadow: `0 4px 32px ${sage[100]}`,
              }}
            >
              <FloatingLeaf
                style={{ top: -12, right: -8, opacity: 0.4 }}
                delay={0}
              />
              <p
                className="mb-3"
                style={{
                  fontFamily: "var(--font-lora), serif",
                  fontSize: 15,
                  fontStyle: "italic",
                  color: sage[600],
                }}
              >
                — about this space
              </p>
              <p
                className="text-[15px] leading-relaxed"
                style={{ color: "#4a4a42" }}
              >
                XOXO Meridian is a private long-distance chat room — a quiet
                digital home built for two. Here, timezones don&apos;t matter,
                and every little moment finds its place. We built this because
                love deserves its own quiet corner of the internet, away from
                the noise. A place to share photos, write notes, leave memos,
                and simply be together across the miles. If you&apos;ve found
                your way here, you probably already know the password to
                someone&apos;s heart 🌸.
              </p>
            </div>
          </FadeUp>

          <FadeUp delay={0.1}>
            <div
              className="rounded-3xl p-6 relative overflow-hidden"
              style={{
                background: "#fff9f2",
                border: `1px solid ${sage[200]}`,
                boxShadow: `0 2px 20px ${sage[100]}`,
                minHeight: 280,
              }}
            >
              <p
                className="mb-5"
                style={{
                  fontFamily: "var(--font-lora), serif",
                  fontSize: 15,
                  fontStyle: "italic",
                  color: sage[600],
                }}
              >
                — behind the scenes
              </p>
              <div className="space-y-4">
                {TECH_STACK.map(({ emoji, label, val }) => (
                  <div key={label} className="flex gap-3 items-start">
                    <span className="text-xl shrink-0">{emoji}</span>
                    <div>
                      <p className="text-[13px] font-medium" style={{ color: sage[700] }}>
                        {label}
                      </p>
                      <p className="text-[13px]" style={{ color: "#7a7a72" }}>
                        {val}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeUp>

          <FadeUp delay={0.15}>
            <div
              className="rounded-3xl p-6 relative overflow-hidden"
              style={{
                background: "#fff9f2",
                border: `1px solid ${sage[200]}`,
                boxShadow: `0 2px 20px ${sage[100]}`,
                minHeight: 280,
              }}
            >
              <p
                className="mb-5"
                style={{
                  fontFamily: "var(--font-lora), serif",
                  fontSize: 15,
                  fontStyle: "italic",
                  color: sage[600],
                }}
              >
                — what we believe
              </p>
              <div className="flex flex-wrap gap-2.5">
                {INTERESTS.map(([icon, label], i) => (
                  <Chip key={label} icon={icon} label={label} delay={i * 0.04} />
                ))}
              </div>

              <div className="mt-6">
                <p
                  className="mb-2"
                  style={{
                    fontFamily: "var(--font-caveat), cursive",
                    fontSize: 16,
                    color: sage[600],
                  }}
                >
                  project vibes ✨
                </p>
                {MOOD_BARS.map(({ label, val }, i) => (
                  <MoodBar key={label} label={label} val={val} delay={0.3 + i * 0.08} />
                ))}
              </div>
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── TIMELINE ─────────────────────────────────────────── */}
      <section className="relative px-6 py-16 max-w-2xl mx-auto">
        <FadeUp>
          <h2
            className="text-2xl mb-2"
            style={{
              fontFamily: "var(--font-lora), serif",
              color: "#3f5d38",
            }}
          >
            The story so far 🌱
          </h2>
          <p
            className="mb-9"
            style={{
              fontFamily: "var(--font-caveat), cursive",
              fontSize: 17,
              color: sage[500],
            }}
          >
            a quiet journey across timezones…
          </p>
        </FadeUp>
        <TimelineItem
          year="2026.06"
          title="home/ — a place to call home"
          desc="Spatial canvas meets personal timeline. Photos find their own coordinates, blog posts become anchors on a linen map, and search ties scattered memories back together. A digital living room that's always open."
          delay={0.05}
        />
        <TimelineItem
          year="2026.06"
          title="Polished every corner"
          desc="A full frontend UI refresh. One design language, one gentle feeling — rounded corners, soft shadows, and a palette that feels like morning light. Every pixel placed with intention."
          delay={0.1}
        />
        <TimelineItem
          year="2026.05"
          title="Atlas — a shared canvas"
          desc="Built a visual space to scatter photos and connect ideas. Right-click to add, drag to arrange, draw lines between memories. Optimistic UI so everything responds instantly — no flicker, just flow."
          delay={0.15}
        />
        <TimelineItem
          year="2026.05"
          title="chat/ — the first message"
          desc="Optimistic rendering so words arrive before the server replies. JSONL chat logs to keep every conversation safe. Late nights learning Next.js, a lot of broken builds, and that first real-time message across the ocean — pure magic."
          delay={0.2}
        />
        <TimelineItem
          year="2026.04"
          title="XOXO Meridian was born"
          desc="A single commit — a blank Next.js app, a Prisma schema, and a quiet hope. The first brick in what would become a shared digital home. Every project starts somewhere; ours started here."
          delay={0.25}
        />
      </section>

      {/* ── NOW section ──────────────────────────────────────── */}
      <section className="px-6 py-16 max-w-5xl mx-auto">
        <FadeUp>
          <div
            className="rounded-3xl p-8 relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${sage[50]} 0%, rgba(255,249,242,0.9) 60%, ${sage[100]} 100%)`,
              border: `1px solid ${sage[200]}`,
              boxShadow: `0 4px 40px ${sage[200]}80`,
            }}
          >
            <FloatingLeaf
              style={{
                bottom: -10,
                right: -10,
                opacity: 0.35,
                transform: "rotate(40deg) scaleX(-1)",
              }}
              delay={0.5}
            />
            <p
              className="mb-2"
              style={{
                fontFamily: "var(--font-lora), serif",
                fontSize: 15,
                fontStyle: "italic",
                color: sage[600],
              }}
            >
              — you and me
            </p>
            <h2
              className="mb-7 text-[clamp(1.45rem,4vw,2rem)] leading-tight"
              style={{
                fontFamily: "var(--font-lora), serif",
                color: sage[700],
              }}
            >
              Two lives, one quiet orbit
            </h2>
            <div className="relative grid gap-7">
              {people.map((person, index) => (
                <PersonNowPanel key={person.id} person={person} index={index} />
              ))}
            </div>
          </div>
        </FadeUp>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <FadeUp>
        <footer className="text-center py-16 px-6">
          <motion.div
            animate={{ rotate: [0, 8, -5, 8, 0] }}
            transition={{
              duration: 3,
              repeat: Infinity,
              repeatDelay: 1.5,
              ease: "easeInOut",
            }}
            style={{ fontSize: 32, display: "inline-block" }}
          >
            🌿
          </motion.div>
          <p
            className="mt-3"
            style={{
              fontFamily: "var(--font-caveat), cursive",
              fontSize: 20,
              color: sage[500],
            }}
          >
            thanks for stopping by ♡
          </p>
          <p className="text-xs mt-1.5" style={{ color: sage[400] }}>
            made with care (and a lot of late-night coding)
          </p>
        </footer>
      </FadeUp>
    </div>
  );
}
