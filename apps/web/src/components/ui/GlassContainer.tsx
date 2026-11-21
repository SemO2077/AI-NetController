import React, { useCallback } from 'react';

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
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty('--glint-x', `${e.clientX - rect.left}px`);
      e.currentTarget.style.setProperty('--glint-y', `${e.clientY - rect.top}px`);
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
