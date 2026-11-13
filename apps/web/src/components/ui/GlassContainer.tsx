import React from 'react';

interface GlassContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  elevated?: boolean;
}

const GlassContainerComponent: React.FC<GlassContainerProps> = ({
  children,
  className = '',
  interactive = false,
  elevated = false,
  ...props
}) => {
  return (
    <div
      className={`
        ${
          elevated
            ? 'bg-[#070c18]/90 backdrop-blur-3xl backdrop-saturate-[190%] border border-white/15 border-t-white/25 shadow-[0_16px_40px_rgba(0,0,0,0.8)]'
            : 'bg-[#0b1324]/55 backdrop-blur-2xl backdrop-saturate-[160%] border border-white/[0.07] border-t-white/[0.16] shadow-[0_12px_32px_rgba(0,0,0,0.4)]'
        }
        relative overflow-hidden flex flex-col
        rounded-[2rem] sm:rounded-[2.25rem]
        transform-gpu
        ${
          interactive
            ? 'cursor-pointer hover:-translate-y-0.5 hover:scale-[1.006] active:scale-[0.975] transition-[transform,box-shadow,border-color,background-color] duration-250 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:border-white/25 select-none hover:shadow-[0_20px_48px_rgba(0,0,0,0.6),0_0_24px_rgba(0,212,255,0.12)]'
            : ''
        }
        ${className}
      `}
      {...props}
    >
      {/* Specular Top Rim Illumination & Subtle Optical Refraction Flare */}
      <div className="absolute inset-x-6 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none z-10" />
      <div className="absolute -top-12 -right-12 w-36 h-32 rounded-full bg-cyan-400/[0.03] pointer-events-none z-0" />
      <div className="relative z-[1] flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
};

export const GlassContainer = React.memo(GlassContainerComponent);
