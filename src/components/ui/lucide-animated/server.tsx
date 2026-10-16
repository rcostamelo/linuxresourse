"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface ServerIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ServerIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const TOP_RECT_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: {
    y: [0, 12, 12, 0],
    transition: {
      duration: 0.9,
      ease: "easeInOut",
      repeat: 1,
      times: [0, 0.35, 0.65, 1],
    },
  },
};

const BOTTOM_RECT_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: {
    y: [0, -12, -12, 0],
    transition: {
      duration: 0.9,
      ease: "easeInOut",
      repeat: 1,
      times: [0, 0.35, 0.65, 1],
    },
  },
};

const ServerIcon = forwardRef<ServerIconHandle, ServerIconProps>(
  ({ onMouseEnter, onMouseLeave, className, ...props }, ref) => {
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
      isControlledRef.current = ref != null;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    }, [controls, ref]);

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
          className="size-full overflow-visible"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.g
            animate={controls}
            initial="normal"
            variants={TOP_RECT_VARIANTS}
          >
            <rect height="8" rx="2" ry="2" width="20" x="2" y="2" />
            <line x1="6" x2="10" y1="6" y2="6" />
          </motion.g>
          <motion.g
            animate={controls}
            initial="normal"
            variants={BOTTOM_RECT_VARIANTS}
          >
            <rect height="8" rx="2" ry="2" width="20" x="2" y="14" />
            <line x1="6" x2="10" y1="18" y2="18" />
          </motion.g>
        </svg>
      </div>
    );
  }
);

ServerIcon.displayName = "ServerIcon";

export { ServerIcon };
