import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, PanInfo } from 'motion/react';
import { ShieldAlert, Copy, Check, X } from 'lucide-react';
import { ApprovalRequiredEvent } from '../../types';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { copyToClipboard } from '../../utils/clipboard';

interface HitlApprovalModalProps {
  event: ApprovalRequiredEvent | null;
  isOpen: boolean;
  onDecision: (commandId: string, decision: 'APPROVED' | 'REJECTED') => void;
}

/**
 * Mobile-native Bottom Sheet for Human-in-the-Loop Approval
 * Supports drag-to-dismiss (rejects command if dragged down past threshold)
 */
export const HitlApprovalModal: React.FC<HitlApprovalModalProps> = ({
  event,
  isOpen,
  onDecision
}) => {
  const { language } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCopied(false);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [event?.command_id, isOpen]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    if (!event) return;
    triggerHapticFeedback('light');
    copyToClipboard(event.proposed_command);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopied(false);
    }, 2000);
  };

  const handleApprove = useCallback(() => {
    if (!event) return;
    triggerHapticFeedback('heavy');
    onDecision(event.command_id, 'APPROVED');
  }, [event, onDecision]);

  const handleReject = useCallback(() => {
    if (!event) return;
    triggerHapticFeedback('warning');
    onDecision(event.command_id, 'REJECTED');
  }, [event, onDecision]);

  useEffect(() => {
    if (!isOpen || !event) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleReject();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, event, handleReject]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      handleReject();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && event && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={language === 'bg' ? 'Потвърждение на команда' : 'Command Elevation Approval'}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center select-none sm:p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleReject}
            style={{ backgroundColor: 'var(--backdrop-scrim)' }}
            className="fixed inset-0 backdrop-blur-md modal-backdrop-scrim"
          />

          {/* Drag-to-Dismiss Liquid Glass Bottom Sheet */}
          <motion.div
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 35,
              mass: 0.8,
            }}
            className="relative z-10 w-full max-w-xl rounded-t-[2.5rem] sm:rounded-[2.25rem] glass-liquid-modal border-t-2 border-t-rose-500/70 flex flex-col overflow-hidden transform-gpu will-change-transform max-h-[92dvh]"
          >
            {/* Tactile Drag Handle */}
            <div className="pt-3 pb-1 cursor-grab active:cursor-grabbing w-full flex justify-center">
              <div className="w-12 h-1.5 bg-rose-400/40 rounded-full" />
            </div>

            {/* Warning Header */}
            <div className="px-6 py-3.5 flex items-center justify-between border-b border-rose-500/20 bg-rose-500/8 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-11 h-11 squircle-badge squircle-rose flex items-center justify-center">
                  <ShieldAlert className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full squircle-rose preserve-white">
                      HITL Gate
                    </span>
                    <span className="text-[10px] text-amber-400 font-mono font-bold">
                      {event.risk_level} {language === 'bg' ? 'РИСК' : 'RISK'}
                    </span>
                  </div>
                  <h3 className="text-base font-display font-extrabold ink-primary mt-0.5 tracking-tight">
                    {language === 'bg' ? 'Потвърждение на команда' : 'Command Elevation Approval'}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReject}
                className="min-w-[40px] min-h-[40px] w-10 h-10 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
                aria-label={language === 'bg' ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 overflow-y-auto overscroll-contain ink-primary pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
              <div className="flex items-center justify-between text-xs liquid-terminal-entry p-3 rounded-2xl font-mono ink-secondary">
                <span>
                  {language === 'bg' ? 'Цел:' : 'Target:'}{' '}
                  <strong className="text-cyan-400">{event.target_id}</strong>
                </span>
                <span>
                  ID: <strong className="ink-primary">{event.command_id.slice(0, 10)}...</strong>
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-display font-bold ink-secondary block">
                  {language === 'bg' ? 'Анализ на риска' : 'Risk Analysis'}
                </span>
                <p className="text-xs text-amber-400 bg-amber-500/12 border border-amber-500/30 p-3.5 rounded-2xl leading-relaxed font-medium">
                  {event.explanation}
                </p>
              </div>

              {/* Proposed Command Code Block */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-display font-bold ink-secondary">
                    {language === 'bg' ? 'Предложена системна команда' : 'Proposed System Command'}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center space-x-1 text-[11px] font-semibold text-cyan-400 px-3 py-1 rounded-full liquid-control-pill cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>
                      {copied
                        ? language === 'bg'
                          ? 'Копирано'
                          : 'Copied'
                        : language === 'bg'
                        ? 'Копирай'
                        : 'Copy'}
                    </span>
                  </button>
                </div>

                <div className="liquid-terminal-entry rounded-2xl border border-rose-500/35 p-3.5 font-mono text-xs text-rose-400 font-semibold overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {event.proposed_command}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  onClick={handleReject}
                  className="w-full min-h-[44px] py-3 rounded-full liquid-control-pill font-bold text-sm flex items-center justify-center cursor-pointer"
                >
                  {language === 'bg' ? 'Блокирай командата' : 'Reject Command'}
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  onClick={handleApprove}
                  className="w-full min-h-[44px] py-3 rounded-full squircle-rose preserve-white font-bold text-sm flex items-center justify-center cursor-pointer"
                >
                  {language === 'bg' ? 'Одобри и изпълни' : 'Approve & Execute'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
