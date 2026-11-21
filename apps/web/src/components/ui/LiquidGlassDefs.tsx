import React from 'react';

/**
 * Global SVG Optical Refraction Filters for Apple Liquid Glass hero capsules.
 * Chromium-based browsers apply subtle curved-lens displacement on floating pills;
 * browsers that ignore SVG backdrop-filter URLs gracefully keep crisp frosted blur + saturate.
 */
export const LiquidGlassDefs: React.FC = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    style={{
      position: 'fixed',
      width: 0,
      height: 0,
      overflow: 'hidden',
      pointerEvents: 'none',
    }}
  >
    <defs>
      <filter
        id="liquid-glass-refraction"
        x="-8%"
        y="-8%"
        width="116%"
        height="116%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.012 0.018"
          numOctaves="2"
          seed="7"
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="2.2" result="softNoise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="softNoise"
          scale="5"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      <filter
        id="liquid-lens-refraction"
        x="-10%"
        y="-10%"
        width="120%"
        height="120%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.016 0.022"
          numOctaves="2"
          seed="19"
          result="lensNoise"
        />
        <feGaussianBlur in="lensNoise" stdDeviation="1.8" result="smoothLens" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="smoothLens"
          scale="7"
          xChannelSelector="R"
          yChannelSelector="B"
        />
      </filter>
    </defs>
  </svg>
);
