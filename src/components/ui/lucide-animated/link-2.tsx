"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useEffect } from "react";

import { cn } from "@/lib/utils";

export interface Link2IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface Link2IconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const LEFT_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: {
    x: [0, -0.7, 0.3, 0],
    transition: {
      duration: 0.6,
      times: [0, 0.4, 0.75, 1],
      ease: "easeInOut",
    },
  },
};

const RIGHT_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: {
    x: [0, 0.7, -0.3, 0],
    transition: {
      duration: 0.6,
      times: [0, 0.4, 0.75, 1],
      ease: "easeInOut",
    },
  },
};

const Link2Icon = forwardRef<Link2IconHandle, Link2IconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
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
          <motion.g animate={controls} variants={LEFT_VARIANTS}>
            <path d="M9 17H7A5 5 0 0 1 7 7h2" />
            <line x1="8" x2="12" y1="12" y2="12" />
          </motion.g>
          <motion.g animate={controls} variants={RIGHT_VARIANTS}>
            <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
            <line x1="16" x2="12" y1="12" y2="12" />
          </motion.g>
        </svg>
      </div>
    );
  }
);

Link2Icon.displayName = "Link2Icon";

export { Link2Icon };
