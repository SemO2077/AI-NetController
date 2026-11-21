import type { Transition, Variants } from 'motion/react';

/**
 * Expressive & Playful Apple Liquid Glass Jelly Spring Physics System (120Hz GPU)
 * Animates only GPU-composited properties (transform & opacity) with tactile
 * liquid overshoot on pills, toggles, cards, modals, and sliding nav droplets.
 */

/** Playful bouncy spring for cards, modals, bottom sheets & floating pills */
export const SPRING_BUBBLY: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 20,
  mass: 0.72,
};

/** Snappy jelly micro-pop for buttons, filter pills, switches & badges */
export const SPRING_POP: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 19,
  mass: 0.58,
};

/** Signature liquid-droplet spring for the sliding nav capsule lens */
export const SPRING_JELLY: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 18,
  mass: 0.75,
};

/** Fluid spring for tab transitions, drawers & smooth layout morphs */
export const SPRING_FLUID: Transition = {
  type: 'spring',
  stiffness: 330,
  damping: 23,
  mass: 0.76,
};

/** Elastic pop spring for status orbs, badges & telemetry transitions */
export const SPRING_ELASTIC: Transition = {
  type: 'spring',
  stiffness: 360,
  damping: 16,
  mass: 0.68,
};

/** Expressive tap & hover micro-interaction presets */
export const BUBBLE_HOVER = {
  scale: 1.03,
  y: -1.5,
  transition: SPRING_POP,
};

export const BUBBLE_TAP = {
  scale: 0.92,
  transition: SPRING_POP,
};

export const CARD_HOVER = {
  y: -3,
  scale: 1.008,
  transition: SPRING_BUBBLY,
};

/** Expressive Tab View Variants (GPU transform + opacity with subtle buoyant spring) */
export const TAB_VIEW_VARIANTS: Variants = {
  initial: {
    opacity: 0,
    y: 12,
    scale: 0.985,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 360,
      damping: 24,
      mass: 0.72,
    },
  },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.99,
    transition: {
      duration: 0.12,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};

/** Bouncy Popover / Dropdown Menu Variants */
export const POPOVER_BUBBLE_VARIANTS: Variants = {
  initial: {
    opacity: 0,
    y: -8,
    scale: 0.92,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 460,
      damping: 21,
      mass: 0.65,
    },
  },
  exit: {
    opacity: 0,
    y: -5,
    scale: 0.95,
    transition: {
      duration: 0.11,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};

/** Bouncy Modal Dialog Entrance & Exit Variants */
export const MODAL_BUBBLE_VARIANTS: Variants = {
  initial: {
    opacity: 0,
    y: 22,
    scale: 0.93,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 22,
      mass: 0.74,
    },
  },
  exit: {
    opacity: 0,
    y: 14,
    scale: 0.95,
    transition: {
      duration: 0.13,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};
