import React, { useEffect } from 'react';
import { motion, AnimatePresence, PanInfo, useDragControls } from 'motion/react';
import { X } from 'lucide-react';
import { SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
}) => {
  const dragControls = useDragControls();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center select-none p-0 sm:p-4">
          {/* Adaptive Backdrop Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{ backgroundColor: 'var(--backdrop-scrim)' }}
            className="fixed inset-0 backdrop-blur-md transform-gpu modal-backdrop-scrim"
          />

          {/* Liquid Glass Sheet / Dialog Surface */}
          <motion.div
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.22}
            onDragEnd={handleDragEnd}
            initial={{ opacity: 0, y: 52, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 36, scale: 0.95, transition: { duration: 0.14 } }}
            transition={SPRING_BUBBLY}
            className="
              glass-liquid-modal
              relative z-10 w-full max-w-2xl
              rounded-t-[2.25rem] sm:rounded-[2.25rem]
              flex flex-col overflow-hidden
              max-h-[90dvh] sm:max-h-[86dvh]
              transform-gpu
            "
          >
            {/* Top Specular Rim Reflection */}
            <div className="absolute inset-x-10 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/85 to-transparent pointer-events-none" />

            {/* Tactile Drag Handle (Mobile) */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              style={{ touchAction: 'none' }}
              className="pt-3 pb-1 cursor-grab active:cursor-grabbing w-full flex justify-center sm:hidden"
            >
              <div className="w-12 h-1.5 bg-current opacity-20 rounded-full hover:opacity-35 transition-opacity" />
            </div>

            {/* Header */}
            <div
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                dragControls.start(e);
              }}
              style={{ touchAction: 'none' }}
              className="px-5 sm:px-6 pt-3.5 sm:pt-5 pb-2.5 flex items-center justify-between gap-3 shrink-0 cursor-grab active:cursor-grabbing sm:cursor-default"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-display font-bold ink-primary tracking-tight truncate">
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-xs ink-muted truncate mt-0.5">{subtitle}</p>
                )}
              </div>

              <motion.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.88 }}
                transition={SPRING_POP}
                onClick={onClose}
                className="w-9 h-9 rounded-full liquid-control-pill flex items-center justify-center shrink-0"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 pb-6 pt-1 bouncy-scroll">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
