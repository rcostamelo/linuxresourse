"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes, ReactNode } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export interface AnimatedIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

function createAnimatedIcon(
  displayName: string,
  renderSvgChildren: (controls: ReturnType<typeof useAnimation>) => ReactNode
) {
  const Comp = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
    ({ onMouseEnter, onMouseLeave, className, ...props }, ref) => {
      const controls = useAnimation();
      const isControlledRef = useRef(false);
      const wrapperRef = useRef<HTMLDivElement>(null);

      useEffect(() => {
        const el = wrapperRef.current;
        if (!el || isControlledRef.current) return;
        const parent = el.closest('button, a, [role="tab"], [data-slot="card"], tr, .group');
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
          if (isControlledRef.current) onMouseEnter?.(e);
          else controls.start("animate");
        },
        [controls, onMouseEnter]
      );

      const handleMouseLeave = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
          if (isControlledRef.current) onMouseLeave?.(e);
          else controls.start("normal");
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
            {renderSvgChildren(controls)}
          </svg>
        </div>
      );
    }
  );
  Comp.displayName = displayName;
  return Comp;
}

export const HardDriveIcon = createAnimatedIcon("HardDriveIcon", (controls) => (
  <>
    <line x1="22" x2="2" y1="12" y2="12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    <motion.line
      animate={controls}
      variants={{
        normal: { scale: 1, opacity: 1 },
        animate: { scale: [1, 1.6, 1], opacity: [1, 0.4, 1], transition: { duration: 0.45, repeat: 1 } },
      }}
      x1="6"
      x2="6.01"
      y1="16"
      y2="16"
    />
    <motion.line
      animate={controls}
      variants={{
        normal: { scale: 1, opacity: 1 },
        animate: { scale: [1, 1.6, 1], opacity: [1, 0.4, 1], transition: { duration: 0.45, delay: 0.15, repeat: 1 } },
      }}
      x1="10"
      x2="10.01"
      y1="16"
      y2="16"
    />
  </>
));

export const MemoryStickIcon = createAnimatedIcon("MemoryStickIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { y: 0 },
      animate: { y: [0, -1.5, 0], transition: { duration: 0.4 } },
    }}
  >
    <path d="M6 19v-3" />
    <path d="M10 19v-3" />
    <path d="M14 19v-3" />
    <path d="M18 19v-3" />
    <path d="M8 11V9" />
    <path d="M16 11V9" />
    <path d="M12 11V9" />
    <path d="M2 15h20" />
    <path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z" />
  </motion.g>
));

export const NetworkIcon = createAnimatedIcon("NetworkIcon", (controls) => (
  <>
    <motion.rect
      animate={controls}
      variants={{
        normal: { y: 0 },
        animate: { y: [0, -1.5, 0], transition: { duration: 0.35 } },
      }}
      x="9"
      y="2"
      width="6"
      height="6"
      rx="1"
    />
    <motion.rect
      animate={controls}
      variants={{
        normal: { x: 0, y: 0 },
        animate: { x: [0, -1.5, 0], y: [0, 1.5, 0], transition: { duration: 0.35 } },
      }}
      x="16"
      y="16"
      width="6"
      height="6"
      rx="1"
    />
    <motion.rect
      animate={controls}
      variants={{
        normal: { x: 0, y: 0 },
        animate: { x: [0, 1.5, 0], y: [0, 1.5, 0], transition: { duration: 0.35 } },
      }}
      x="2"
      y="16"
      width="6"
      height="6"
      rx="1"
    />
    <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
    <path d="M12 12V8" />
  </>
));

export const EraserIcon = createAnimatedIcon("EraserIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { x: 0, rotate: 0 },
      animate: { x: [0, -2, 2, -1, 0], rotate: [0, -6, 6, 0], transition: { duration: 0.45 } },
    }}
  >
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </motion.g>
));

export const CableIcon = createAnimatedIcon("CableIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { scale: 1 },
      animate: { scale: [1, 1.08, 1], transition: { duration: 0.4 } },
    }}
  >
    <path d="M17 21v-2a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1" />
    <path d="M19 15V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V9" />
    <path d="M21 21v-2h-4" />
    <path d="M3 5h4V3" />
    <path d="M7 5a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1V3" />
  </motion.g>
));

export const PlugIcon = createAnimatedIcon("PlugIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { y: 0 },
      animate: { y: [0, -2, 0], transition: { duration: 0.35 } },
    }}
  >
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </motion.g>
));

export const ContainerIcon = createAnimatedIcon("ContainerIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { y: 0 },
      animate: { y: [0, -1.5, 0], transition: { duration: 0.4 } },
    }}
  >
    <path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z" />
    <path d="M10 21.9V14L2.1 9.1" />
    <path d="m10 14 11.9-6.9" />
    <path d="M14 19.8v-8.1" />
    <path d="M18 17.5V9.4" />
  </motion.g>
));

export const ImageIcon = createAnimatedIcon("ImageIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { scale: 1 },
      animate: { scale: [1, 1.08, 1], transition: { duration: 0.35 } },
    }}
  >
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </motion.g>
));

export const ImagePlusIcon = createAnimatedIcon("ImagePlusIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { scale: 1 },
      animate: { scale: [1, 1.08, 1], transition: { duration: 0.35 } },
    }}
  >
    <path d="M16 5h6" />
    <path d="M19 2v6" />
    <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    <circle cx="9" cy="9" r="2" />
  </motion.g>
));

export const ScrollTextIcon = createAnimatedIcon("ScrollTextIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { y: 0 },
      animate: { y: [0, -1.5, 0], transition: { duration: 0.35 } },
    }}
  >
    <path d="M15 12h-5" />
    <path d="M15 8h-5" />
    <path d="M19 17V5a2 2 0 0 0-2-2H4" />
    <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
  </motion.g>
));

export const SkullIcon = createAnimatedIcon("SkullIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { rotate: 0 },
      animate: { rotate: [0, -10, 10, -6, 0], transition: { duration: 0.45 } },
    }}
  >
    <path d="m12.5 17-.5-1-.5 1h1z" />
    <path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="12" r="1" />
  </motion.g>
));

export const SquareIcon = createAnimatedIcon("SquareIcon", (controls) => (
  <motion.rect
    animate={controls}
    variants={{
      normal: { scale: 1 },
      animate: { scale: [1, 0.85, 1], transition: { duration: 0.3 } },
    }}
    width="18"
    height="18"
    x="3"
    y="3"
    rx="2"
  />
));

export const LogInIcon = createAnimatedIcon("LogInIcon", (controls) => (
  <>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <motion.g
      animate={controls}
      variants={{
        normal: { x: 0 },
        animate: { x: [0, 3, 0], transition: { duration: 0.4 } },
      }}
    >
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" x2="3" y1="12" y2="12" />
    </motion.g>
  </>
));

export const ShieldAlertIcon = createAnimatedIcon("ShieldAlertIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { rotate: 0 },
      animate: { rotate: [0, -8, 8, -4, 0], transition: { duration: 0.4 } },
    }}
  >
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </motion.g>
));

export const TriangleAlertIcon = createAnimatedIcon("TriangleAlertIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { y: 0, rotate: 0 },
      animate: { rotate: [0, -7, 7, -4, 0], transition: { duration: 0.4 } },
    }}
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </motion.g>
));

export const InfoIcon = createAnimatedIcon("InfoIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { scale: 1 },
      animate: { scale: [1, 1.1, 1], transition: { duration: 0.35 } },
    }}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </motion.g>
));

export const OctagonXIcon = createAnimatedIcon("OctagonXIcon", (controls) => (
  <motion.g
    animate={controls}
    variants={{
      normal: { rotate: 0 },
      animate: { rotate: [0, -8, 8, 0], transition: { duration: 0.4 } },
    }}
  >
    <path d="m15 9-6 6" />
    <path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z" />
    <path d="m9 9 6 6" />
  </motion.g>
));
