"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface DatabaseBackupIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface DatabaseBackupIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DatabaseBackupIcon = forwardRef<
  DatabaseBackupIconHandle,
  DatabaseBackupIconProps
>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
  const controls = useAnimation();
  const isControlledRef = useRef(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const el = wrapperRef.current;
      if (!el || isControlledRef.current) return;
      const parent = el.closest("button, a, [role=\"tab\"], [data-slot=\"card\"], tr, .group");
      if (!parent || parent === el) return;
      const enter = () => controls.start("animate");
      const leave = () => controls.start("normal");
      parent.addEventListener("mouseenter", enter);
      parent.addEventListener("mouseleave", leave);
      return () => {
        parent.removeEventListener("mouseenter", enter);
        parent.removeEventListener("mouseleave", leave);
      };
    }, [controls]);

  useImperativeHandle(ref, () => {
    isControlledRef.current = true;
    return {
      startAnimation: () => controls.start("animate"),
      stopAnimation: () => controls.start("normal"),
    };
  });

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseEnter?.(e);
      } else {
        controls.start("animate");
      }
    },
    [controls, onMouseEnter]
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isControlledRef.current) {
        onMouseLeave?.(e);
      } else {
        controls.start("normal");
      }
    },
    [controls, onMouseLeave]
  );

  return (
    <div
        ref={wrapperRef}
        className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      <svg
        fill="none"
        className="size-full"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        
        xmlns="http://www.w3.org/2000/svg"
      >
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 12a9 3 0 0 0 5 2.69" />
        <path d="M21 9.3V5" />
        <path d="M3 5v14a9 3 0 0 0 6.47 2.88" />

        <motion.g
          animate={controls}
          style={{ transformOrigin: "17.5px 17px" }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          variants={{
            normal: { rotate: 0 },
            animate: { rotate: 360 },
          }}
        >
          <path d="M12 12v4h4" />
          <path d="M13 20a5 5 0 0 0 9-3 4.5 4.5 0 0 0-4.5-4.5c-1.33 0-2.54.54-3.41 1.41L12 16" />
        </motion.g>
      </svg>
    </div>
  );
});

DatabaseBackupIcon.displayName = "DatabaseBackupIcon";

export { DatabaseBackupIcon };
