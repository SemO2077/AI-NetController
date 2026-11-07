import type { Transition, Variants } from 'motion/react';

/**
 * 120Hz Native Android Critically-Damped Spring Physics System
 * Strictly animates GPU-composited properties (transform: translate3d/scale & opacity)
 * with zero wobble, zero overshoot jitter, and zero layout thrashing.
 */

/** Crisp, critically-damped native spring for cards, modals & sheets */
export const SPRING_BUBBLY: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.7,
};

/** Snappy, tactile micro-response for buttons, chips & toggles */
export const SPRING_POP: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 36,
  mass: 0.6,
};

/** Silky, high-frame-rate fluid spring for tab transitions & drawers */
export const SPRING_FLUID: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
  mass: 0.7,
};

/** Smooth spring for badges, status indicators & telemetry bars */
export const SPRING_ELASTIC: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 32,
  mass: 0.7,
};

/** Cohesive tap micro-interaction presets (no sticky hover scale on mobile) */
export const BUBBLE_HOVER = {
  scale: 1.01,
  transition: SPRING_POP,
};

export const BUBBLE_TAP = {
  scale: 0.96,
  transition: SPRING_POP,
};

export const CARD_HOVER = {
  y: -2,
  transition: SPRING_BUBBLY,
};

/** 120Hz Native Tab View Variants (GPU transform + opacity only, zero scale distortion) */
export const TAB_VIEW_VARIANTS: Variants = {
  initial: {
    opacity: 0,
    y: 8,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.16,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: {
      duration: 0.1,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};

/** Popover / Dropdown Menu Variants */
export const POPOVER_BUBBLE_VARIANTS: Variants = {
  initial: {
    opacity: 0,
    y: -6,
    scale: 0.97,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.15,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.98,
    transition: {
      duration: 0.1,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};

/** Modal Dialog Native Entrance & Exit Variants */
export const MODAL_BUBBLE_VARIANTS: Variants = {
  initial: {
    opacity: 0,
    y: 16,
    scale: 0.97,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.18,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    opacity: 0,
    y: 10,
    scale: 0.98,
    transition: {
      duration: 0.12,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};
