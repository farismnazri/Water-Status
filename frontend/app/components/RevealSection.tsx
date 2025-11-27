// @ts-nocheck
import { useEffect, useRef, useState } from "react";

type RevealSectionProps = {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
  initialOffset?: number; // 👈 NEW: how far down it starts (px)
};

export function RevealSection({
  children,
  className = "",
  delayMs = 0,
  initialOffset = 40, // default travel distance
}: RevealSectionProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={["transition-all duration-700 ease-out", className].join(" ")}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0px)" : `translateY(${initialOffset}px)`,
        transitionProperty: "opacity, transform",
        transitionTimingFunction: "ease-out",
        transitionDuration: "700ms",
        transitionDelay: visible ? `${delayMs}ms` : "0ms",
      }}
    >
      {children}
    </div>
  );
}