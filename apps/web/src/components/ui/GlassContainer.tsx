import React, { useCallback, useEffect, useRef } from 'react';

interface GlassContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  elevated?: boolean;
  iridescent?: boolean;
}

const GlassContainerComponent: React.FC<GlassContainerProps> = ({
  children,
  className = '',
  interactive = false,
  elevated = false,
  iridescent = false,
  onMouseMove,
  ...props
}) => {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const clientX = e.clientX;
      const clientY = e.clientY;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const rect = el.getBoundingClientRect();
          el.style.setProperty('--glint-x', `${clientX - rect.left}px`);
          el.style.setProperty('--glint-y', `${clientY - rect.top}px`);
        });
      }
      onMouseMove?.(e);
    },
    [onMouseMove]
  );

  return (
    <div
      onMouseMove={handleMouseMove}
      className={`
        ${elevated ? 'glass-liquid-elevated' : 'glass-liquid'}
        liquid-glint
        ${iridescent ? 'iridescent-active-rim' : ''}
        relative overflow-hidden flex flex-col
        rounded-[28px] sm:rounded-[32px]
        transform-gpu
        ${
          interactive
            ? 'cursor-pointer active:scale-[0.96] select-none'
            : ''
        }
        ${className}
      `}
      {...props}
    >
      {/* Top Specular Edge Reflection */}
      <div className="absolute inset-x-8 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/80 to-transparent pointer-events-none z-10 opacity-85" />
      <div className="relative z-[1] flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
};

export const GlassContainer = React.memo(GlassContainerComponent);
