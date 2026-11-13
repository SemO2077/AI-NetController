/**
 * Viewport Resolution & Aspect Ratio Scaling Engine
 * Computes optimal grid columns, D3 force parameters, and remote screen letterbox/pillarbox
 * geometry across all device classes (280px foldables -> 16:9 desktops -> 32:9 ultrawides).
 */

export type ViewportCategory =
  | 'compact-mobile'    // < 360px (foldable cover / mini phone)
  | 'mobile-portrait'   // 360px - 639px
  | 'mobile-landscape'  // height <= 520px and width > height
  | 'tablet'            // 640px - 1023px
  | 'desktop'           // 1024px - 1535px
  | 'widescreen'        // 1536px - 2559px
  | 'ultrawide';        // >= 2560px or aspect >= 2.2 (21:9 / 32:9 / 4K)

export type ScreenAspectPreset = 'fit' | 'fill' | '16:9' | '16:10' | '21:9' | '4:3';

export interface ViewportMetrics {
  width: number;
  height: number;
  aspectRatio: number;
  category: ViewportCategory;
  isShortLandscape: boolean;
  isUltrawide: boolean;
  recommendedFleetColumns: 1 | 2 | 3;
  topologyForceConfig: {
    uplinkDistance: number;
    meshDistance: number;
    chargeStrength: number;
    gatewayRadius: number;
    nodeRadius: number;
  };
}

/**
 * Computes responsive layout and physics metrics for any viewport resolution & aspect ratio.
 * Handles edge cases such as zero/negative/NaN dimensions gracefully.
 */
export function computeViewportMetrics(rawWidth: number, rawHeight: number): ViewportMetrics {
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : 1280;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : 800;
  const aspectRatio = Number((width / Math.max(1, height)).toFixed(3));

  const isUltrawide = width >= 2560 || (width >= 1440 && aspectRatio >= 2.15);
  const isShortLandscape = height <= 520 && width > height && !isUltrawide;

  let category: ViewportCategory = 'desktop';
  if (isUltrawide) {
    category = 'ultrawide';
  } else if (isShortLandscape) {
    category = 'mobile-landscape';
  } else if (width < 360) {
    category = 'compact-mobile';
  } else if (width < 640) {
    category = 'mobile-portrait';
  } else if (width < 1024) {
    category = 'tablet';
  } else if (width >= 1536) {
    category = 'widescreen';
  } else {
    category = 'desktop';
  }

  let recommendedFleetColumns: 1 | 2 | 3 = 1;
  if (width >= 1536) {
    recommendedFleetColumns = 3;
  } else if (width >= 1024 || (isShortLandscape && width >= 760)) {
    recommendedFleetColumns = 2;
  }

  // Scale D3 topology distances proportionally so nodes never clip on small screens
  // and spread naturally on wide screens.
  const minDim = Math.min(width, height);
  const scaleFactor = Math.max(0.65, Math.min(1.45, minDim / 520));

  return {
    width,
    height,
    aspectRatio,
    category,
    isShortLandscape,
    isUltrawide,
    recommendedFleetColumns,
    topologyForceConfig: {
      uplinkDistance: Math.round(110 * scaleFactor * (aspectRatio > 1.8 ? 1.12 : 1)),
      meshDistance: Math.round(70 * scaleFactor),
      chargeStrength: Math.round(-280 * scaleFactor),
      gatewayRadius: Math.round(44 * scaleFactor),
      nodeRadius: Math.round(32 * scaleFactor),
    },
  };
}

/**
 * Computes exact pixel dimensions for a remote screen canvas inside a container
 * while respecting the selected aspect ratio preset and zoom factor.
 */
export function computeContainedScreenRect(
  containerWidth: number,
  containerHeight: number,
  preset: ScreenAspectPreset,
  zoom: number = 1
): { width: number; height: number; targetAspect: number; resolutionLabel: string } {
  const safeW = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 800;
  const safeH = Number.isFinite(containerHeight) && containerHeight > 0 ? containerHeight : 450;
  const safeZoom = Number.isFinite(zoom) ? Math.min(3, Math.max(0.5, zoom)) : 1;

  const presetMap: Record<ScreenAspectPreset, { aspect: number; label: string }> = {
    fit: { aspect: 16 / 9, label: '1920×1080 (16:9)' },
    fill: { aspect: safeW / Math.max(1, safeH), label: 'Adaptive Fill' },
    '16:9': { aspect: 16 / 9, label: '1920×1080 (16:9)' },
    '16:10': { aspect: 16 / 10, label: '2560×1600 (16:10)' },
    '21:9': { aspect: 21 / 9, label: '3440×1440 (21:9)' },
    '4:3': { aspect: 4 / 3, label: '1600×1200 (4:3)' },
  };

  const { aspect: targetAspect, label: resolutionLabel } = presetMap[preset] || presetMap['fit'];

  if (preset === 'fill') {
    return {
      width: Math.round(safeW * safeZoom),
      height: Math.round(safeH * safeZoom),
      targetAspect: Number(targetAspect.toFixed(3)),
      resolutionLabel,
    };
  }

  const containerAspect = safeW / Math.max(1, safeH);
  let fittedWidth: number;
  let fittedHeight: number;

  if (containerAspect > targetAspect) {
    fittedHeight = safeH;
    fittedWidth = safeH * targetAspect;
  } else {
    fittedWidth = safeW;
    fittedHeight = safeW / targetAspect;
  }

  return {
    width: Math.max(1, Math.round(fittedWidth * safeZoom)),
    height: Math.max(1, Math.round(fittedHeight * safeZoom)),
    targetAspect: Number(targetAspect.toFixed(3)),
    resolutionLabel,
  };
}

/**
 * Clamps percentage telemetry values (CPU, RAM, Battery) safely into [0, 100],
 * guarding against NaN, Infinity, or out-of-range daemon reports.
 */
export function clampPercentage(value: number | undefined | null, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Math.min(100, Math.max(0, fallback));
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}
