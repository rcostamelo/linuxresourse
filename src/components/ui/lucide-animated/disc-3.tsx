"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface Disc3IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface Disc3IconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const Disc3Icon = forwardRef<Disc3IconHandle, Disc3IconProps>(
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
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="2" />

          <motion.g
            animate={controls}
            style={{ transformOrigin: "12px 12px" }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            variants={{
              normal: { rotate: 0 },
              animate: { rotate: 90 },
            }}
          >
            <path d="M6 12c0-1.7.7-3.2 1.8-4.2" />
            <path d="M18 12c0 1.7-.7 3.2-1.8 4.2" />
          </motion.g>
        </svg>
      </div>
    );
  }
);

Disc3Icon.displayName = "Disc3Icon";

export { Disc3Icon };
