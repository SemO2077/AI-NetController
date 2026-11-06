import React, { useState } from 'react';
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

  const handleCopy = () => {
    if (!event) return;
    triggerHapticFeedback('light');
    copyToClipboard(event.proposed_command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApprove = () => {
    if (!event) return;
    triggerHapticFeedback('heavy');
    onDecision(event.command_id, 'APPROVED');
  };

  const handleReject = () => {
    if (!event) return;
    triggerHapticFeedback('warning');
    onDecision(event.command_id, 'REJECTED');
  };

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y > 100 || info.velocity.y > 500) {
      handleReject();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && event && (
        <div className="fixed inset-0 z-50 flex items-end justify-center select-none">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleReject}
            className="fixed inset-0 bg-black/75 backdrop-blur-md"
          />

          {/* Drag-to-Dismiss Bottom Sheet */}
          <motion.div
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 35,
              mass: 0.8
            }}
            className="
              relative z-10 w-full max-w-xl
              rounded-t-[2.5rem]
              bg-[#091020]/96 backdrop-blur-3xl
              border border-rose-500/40 border-t-rose-400/50
              shadow-[0_24px_64px_rgba(0,0,0,0.9)]
              flex flex-col overflow-hidden
              transform-gpu will-change-transform
              max-h-[90vh]
            "
          >
            {/* Tactile Drag Handle */}
            <div className="pt-3 pb-1 cursor-grab active:cursor-grabbing w-full flex justify-center">
              <div className="w-12 h-1.5 bg-rose-400/30 rounded-full" />
            </div>

            {/* Warning Header */}
            <div className="px-6 py-3.5 flex items-center justify-between border-b border-rose-500/20 bg-rose-950/20 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center shadow-lg shadow-rose-500/25">
                  <ShieldAlert className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-600 text-white">
                      HITL GATE
                    </span>
                    <span className="text-[10px] text-amber-300 font-mono font-semibold">
                      {event.risk_level} {language === 'bg' ? 'РИСК' : 'RISK'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white mt-0.5 tracking-tight">
                    {language === 'bg' ? 'Потвърждение на команда' : 'Command Elevation Approval'}
                  </h3>
                </div>
              </div>

              <button
                onClick={handleReject}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/10 active:scale-90 transition cursor-pointer"
                aria-label={language === 'bg' ? 'Затвори' : 'Close'}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 space-y-4 overflow-y-auto overscroll-contain text-slate-200 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
              <div className="flex items-center justify-between text-xs bg-white/5 p-3 rounded-2xl border border-white/10 font-mono text-slate-400">
                <span>
                  {language === 'bg' ? 'Цел:' : 'Target:'}{' '}
                  <strong className="text-cyan-400">{event.target_id}</strong>
                </span>
                <span>
                  ID: <strong className="text-slate-300">{event.command_id.slice(0, 10)}...</strong>
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  {language === 'bg' ? 'Анализ на риска' : 'Risk Analysis'}
                </span>
                <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 p-3.5 rounded-2xl leading-relaxed">
                  {event.explanation}
                </p>
              </div>

              {/* Proposed Command Code Block */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {language === 'bg' ? 'Предложена системна команда' : 'Proposed System Command'}
                  </span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center space-x-1 text-[11px] text-cyan-400 hover:text-cyan-300 transition min-h-[36px] px-2 py-1 rounded-lg hover:bg-white/5 cursor-pointer"
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

                <div className="bg-black/70 rounded-2xl border border-rose-500/30 p-3.5 font-mono text-xs text-rose-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
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
                  className="w-full min-h-[44px] py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition flex items-center justify-center cursor-pointer bubble-tap"
                >
                  {language === 'bg' ? 'Блокирай командата' : 'Reject Command'}
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  onClick={handleApprove}
                  className="w-full min-h-[44px] py-3.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-[0_4px_20px_rgba(225,29,72,0.4)] transition flex items-center justify-center cursor-pointer bubble-tap"
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
