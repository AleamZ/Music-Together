"use client";

import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type HTMLAttributes,
} from "react";

interface ScrollTitleProps extends HTMLAttributes<HTMLElement> {
  text: string;
  className?: string;
  title?: string;
  as?: ElementType;
  isHovered?: boolean;
  speedPxPerSec?: number;
}

/**
 * ScrollTitle: Displays a song title that truncates normally with ellipsis,
 * but smoothly scrolls horizontally back-and-forth when hovered (like Spotify/Apple Music)
 * if the text is longer than its container.
 */
export default function ScrollTitle({
  text,
  className = "",
  title,
  as: Component = "div",
  isHovered,
  speedPxPerSec = 35,
  ...rest
}: ScrollTitleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  const [selfHovered, setSelfHovered] = useState(false);
  const [overflowPx, setOverflowPx] = useState(0);

  const activeHover = isHovered !== undefined ? isHovered : selfHovered;
  const isOverflowing = overflowPx > 4; // allow slight tolerance for subpixels

  // Measure overflow distance whenever text changes or element resizes
  useEffect(() => {
    function measure() {
      const container = containerRef.current;
      const content = textRef.current;
      if (!container || !content) return;

      const cWidth = container.clientWidth;
      const sWidth = content.scrollWidth;

      if (sWidth > cWidth) {
        setOverflowPx(sWidth - cWidth);
      } else {
        setOverflowPx(0);
      }
    }

    measure();

    if (typeof window === "undefined" || !("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(measure);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [text]);

  const durationSec = Math.max(3.5, overflowPx / speedPxPerSec);

  return (
    <Component
      ref={containerRef}
      title={title ?? text}
      data-testid="scroll-title"
      onMouseEnter={() => setSelfHovered(true)}
      onMouseLeave={() => setSelfHovered(false)}
      onTouchStart={() => setSelfHovered(true)}
      onTouchEnd={() => setSelfHovered(false)}
      className={`relative min-w-0 max-w-full overflow-hidden whitespace-nowrap select-none ${className}`}
      {...rest}
    >
      <span
        ref={textRef}
        className={`inline-block max-w-full ${
          isOverflowing && activeHover
            ? "animate-marquee-hover"
            : "truncate transition-transform duration-300 ease-out"
        }`}
        style={
          isOverflowing && activeHover
            ? ({
                ["--marquee-distance" as string]: `-${overflowPx + 6}px`,
                ["--marquee-duration" as string]: `${durationSec}s`,
              } as React.CSSProperties)
            : { transform: "translateX(0)" }
        }
      >
        {text}
      </span>
    </Component>
  );
}
