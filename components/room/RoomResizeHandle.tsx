"use client";

import { Separator } from "react-resizable-panels";

interface RoomResizeHandleProps {
  id?: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
  title?: string;
  disabled?: boolean;
}

export default function RoomResizeHandle({
  id,
  orientation = "horizontal",
  className = "",
  title = "Kéo để đổi kích thước (Nhấp đúp để về mặc định)",
  disabled = false,
}: RoomResizeHandleProps) {
  const isHorizontal = orientation === "horizontal";

  return (
    <Separator
      id={id}
      disabled={disabled}
      className={`group relative flex items-center justify-center shrink-0 select-none transition-all outline-none focus-visible:ring-1 focus-visible:ring-gold/60 ${
        isHorizontal
          ? "w-3 sm:w-3.5 h-full cursor-col-resize hover:w-3.5 px-0.5"
          : "h-3 sm:h-3.5 w-full cursor-row-resize hover:h-3.5 py-0.5"
      } ${className}`}
      title={title}
    >
      {/* Visual divider line with theme-adaptive gold glow */}
      <div
        className={`rounded-full transition-all duration-200 pointer-events-none ${
          isHorizontal
            ? "w-[2px] h-[94%] bg-gold-200/40 group-hover:bg-gold group-hover:w-[3px] group-data-[separator=active]:bg-burgundy-accent group-data-[separator=active]:w-[3px] group-hover:shadow-[0_0_8px_rgba(205,185,138,0.75)] group-data-[separator=active]:shadow-[0_0_10px_rgba(154,49,73,0.85)]"
            : "h-[2px] w-[94%] bg-gold-200/40 group-hover:bg-gold group-hover:h-[3px] group-data-[separator=active]:bg-burgundy-accent group-data-[separator=active]:h-[3px] group-hover:shadow-[0_0_8px_rgba(205,185,138,0.75)] group-data-[separator=active]:shadow-[0_0_10px_rgba(154,49,73,0.85)]"
        }`}
      />

      {/* Grip pill button indicator */}
      <div
        className={`pointer-events-none absolute z-20 flex items-center justify-center rounded-full border border-gold-200/80 bg-cream/95 text-burgundy shadow-xs backdrop-blur-xs transition-all duration-150 opacity-0 group-hover:opacity-100 group-data-[separator=active]:opacity-100 group-hover:scale-105 ${
          isHorizontal
            ? "h-7 w-3 text-[10px]"
            : "h-3 w-7 text-[10px]"
        }`}
      >
        <span className="font-mono leading-none select-none tracking-tighter">
          {isHorizontal ? "⋮" : "⋯"}
        </span>
      </div>
    </Separator>
  );
}
