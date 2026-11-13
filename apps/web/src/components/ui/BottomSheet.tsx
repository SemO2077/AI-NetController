import React, { useEffect } from 'react';
import { motion, AnimatePresence, PanInfo, useDragControls } from 'motion/react';
import { X } from 'lucide-react';
import { SPRING_BUBBLY } from '../../utils/springPhysics';

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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center select-none">
          {/* Backdrop Blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-md transform-gpu"
          />

          {/* Sheet / Dialog Surface */}
          <motion.div
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            initial={{ opacity: 0, y: 48, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 36, scale: 0.96, transition: { duration: 0.14 } }}
            transition={SPRING_BUBBLY}
            className="
              bg-[#091020]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 shadow-[0_24px_64px_rgba(0,0,0,0.9)]
              relative z-10 w-full max-w-2xl
              rounded-t-[2.5rem] sm:rounded-[2.4rem]
              flex flex-col overflow-hidden
              max-h-[90dvh] sm:max-h-[85dvh]
              transform-gpu
            "
          >
            {/* Samsung Specular Rim Highlight */}
            <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" />

            {/* Tactile Drag Handle (Mobile) */}
            <div
              onPointerDown={(e) => dragControls.start(e)}
              style={{ touchAction: 'none' }}
              className="pt-3 pb-1 cursor-grab active:cursor-grabbing w-full flex justify-center sm:hidden"
            >
              <div className="w-12 h-1.5 bg-white/25 rounded-full hover:bg-white/40 transition-colors" />
            </div>

            {/* Header - Negative space hierarchy without divider border */}
            <div
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                dragControls.start(e);
              }}
              style={{ touchAction: 'none' }}
              className="px-5 sm:px-6 pt-3 sm:pt-4 pb-2 flex items-center justify-between gap-3 shrink-0 cursor-grab active:cursor-grabbing sm:cursor-default"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight truncate">
                  {title}
                </h3>
                {subtitle && (
                  <p className="text-xs text-white/50 mt-0.5 truncate">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full flex items-center justify-center text-white/50 hover:text-white bg-white/5 hover:bg-white/10 active:scale-95 transition cursor-pointer shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content with Safe Insets */}
            <div className="p-5 sm:p-6 overflow-y-auto overflow-x-hidden overscroll-contain pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
