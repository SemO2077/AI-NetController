import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Copy,
  Check,
  Download,
  FileCode,
  Smartphone,
  Server,
  X,
  Code2,
  Terminal,
  Layers,
  Sparkles,
  Package,
  ShieldCheck,
  RefreshCw,
  FileText,
  Monitor,
  ChevronDown,
  ChevronUp,
  Archive,
} from 'lucide-react';
import { CODE_SNIPPETS } from '../../data/codeSnippets';
import { ENTERPRISE_SNIPPETS } from '../../data/enterpriseSnippets';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../store/uiStore';
import { copyToClipboard } from '../../utils/clipboard';
import { MODAL_BUBBLE_VARIANTS, SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

const ALL_SNIPPETS = [...ENTERPRISE_SNIPPETS, ...CODE_SNIPPETS];

interface ReleaseArtifact {
  filename: string;
  kind: 'exe' | 'apk' | 'zip';
  platform: string;
  sizeBytes: number;
  sizeFormatted: string;
  sha256: string;
  downloadUrl: string;
}

interface ReleaseManifest {
  version: string;
  tag: string;
  releaseName: string;
  publishedAt: string;
  protocol: string;
  artifacts: ReleaseArtifact[];
}

interface CodeExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CodeExportModal: React.FC<CodeExportModalProps> = ({ isOpen, onClose }) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';

  const [selectedCategory, setSelectedCategory] = useState<
    'releases' | 'all' | 'crossplatform' | 'backend' | 'android' | 'frontend' | 'docs'
  >('releases');
  const [activeFilename, setActiveFilename] = useState<string>('agent/agent.py');
  const [copied, setCopied] = useState(false);
  const [copiedGhCmd, setCopiedGhCmd] = useState(false);
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [patchNotes, setPatchNotes] = useState<string>('');
  const [liveSnippets, setLiveSnippets] = useState<typeof ALL_SNIPPETS>(ALL_SNIPPETS);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);
  const [showCliDrawer, setShowCliDrawer] = useState(false);
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  const timersRef = useRef<Set<number>>(new Set());

  const scheduleTimer = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetch('/api/releases', { credentials: 'include', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (data.manifest) setManifest(data.manifest);
        if (data.patchNotes) setPatchNotes(data.patchNotes);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        fetch('/releases/v0.90.0/RELEASE_MANIFEST.json', { signal: controller.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((m) => setManifest(m))
          .catch(() => {});
      });

    fetch('/api/source-files', { credentials: 'include', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (data) => {
        if (!Array.isArray(data?.files) || data.files.length === 0) return;

        const completeSnippets = data.files.filter(
          (f: any) => typeof f?.filename === 'string' && typeof f?.code === 'string'
        );
        if (completeSnippets.length > 0) {
          setLiveSnippets(completeSnippets);
          return;
        }

        const existingEntries = data.files.filter(
          (f: any) => typeof f?.id === 'string' && f.exists === true
        );
        if (existingEntries.length === 0) return;

        const fetched = await Promise.allSettled(
          existingEntries.map((entry: { id: string }) =>
            fetch(`/api/source-files?path=${encodeURIComponent(entry.id)}`, {
              credentials: 'include',
              signal: controller.signal,
            }).then((r) => (r.ok ? r.json() : null))
          )
        );
        if (controller.signal.aborted) return;

        const contentById = new Map<string, { content: string; label?: string; language?: string }>();
        for (const res of fetched) {
          if (res.status === 'fulfilled' && res.value?.id && typeof res.value?.content === 'string') {
            contentById.set(res.value.id, {
              content: res.value.content,
              label: res.value.label,
              language: res.value.language,
            });
          }
        }
        if (contentById.size === 0) return;

        setLiveSnippets((prev) => {
          const updated = prev.map((snippet) => {
            const match = contentById.get(snippet.filename);
            if (!match) return snippet;
            contentById.delete(snippet.filename);
            return { ...snippet, code: match.content };
          });
          for (const [id, info] of contentById.entries()) {
            const category = id.startsWith('apps/mobile/')
              ? 'crossplatform'
              : id.startsWith('apps/web/')
              ? 'frontend'
              : id.startsWith('docs/')
              ? 'docs'
              : 'backend';
            updated.push({
              filename: id,
              category,
              description: info.label || id,
              language: info.language || 'text',
              code: info.content,
            } as (typeof ALL_SNIPPETS)[number]);
          }
          return updated;
        });
      })
      .catch(() => {});

    return () => controller.abort();
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredSnippets =
    selectedCategory === 'all' || selectedCategory === 'releases'
      ? liveSnippets
      : liveSnippets.filter((s) => {
          if (selectedCategory === 'crossplatform') {
            return s.filename.startsWith('apps/mobile/') || s.category === 'crossplatform';
          }
          if (selectedCategory === 'backend') {
            return (
              s.category === 'backend' ||
              s.filename.startsWith('agent/') ||
              s.filename.endsWith('.py') ||
              s.filename.endsWith('requirements.txt') ||
              s.filename.endsWith('.spec') ||
              s.filename.endsWith('.bat')
            );
          }
          if (selectedCategory === 'android') {
            return s.category === 'android' || s.filename.includes('android');
          }
          if (selectedCategory === 'frontend') {
            return s.category === 'frontend' || s.filename.startsWith('apps/web/src/');
          }
          if (selectedCategory === 'docs') {
            return s.category === 'docs' || s.filename.startsWith('docs/') || s.filename.endsWith('.md');
          }
          return true;
        });

  const currentFile =
    filteredSnippets.find((f) => f.filename === activeFilename) ||
    filteredSnippets[0] ||
    liveSnippets[0] ||
    ALL_SNIPPETS[0];

  const handleCopy = () => {
    triggerHapticFeedback('light');
    copyToClipboard(currentFile.code);
    setCopied(true);
    scheduleTimer(() => setCopied(false), 2000);
  };

  const handleRebuildBinaries = async () => {
    triggerHapticFeedback('medium');
    setIsRebuilding(true);
    setRebuildMessage(null);
    try {
      const res = await fetch('/api/releases/rebuild', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRebuildMessage(data?.error || `HTTP ${res.status}`);
        return;
      }
      if (data.manifest) {
        setManifest(data.manifest);
      }
      setRebuildMessage(isBg ? 'Бинарните пакети са прекомпилирани.' : 'Release binaries rebuilt.');
    } catch {
      setRebuildMessage(isBg ? 'Няма връзка с Control Server.' : 'Control server unreachable.');
    } finally {
      setIsRebuilding(false);
    }
  };

  const ghReleaseCommands = `# 1. Tag and push v0.90.0 (Beta 0.90.00)
git tag -a v0.90.0 -m "AI NetController v0.90.0 (Beta 0.90.00)"
git push origin main --tags
git push gitlab main --tags

# 2. Publish pre-built binaries to GitHub & GitLab Releases:
python scripts/publish_release.py --platform all`;

  const handleCopyGhCommands = () => {
    triggerHapticFeedback('light');
    copyToClipboard(ghReleaseCommands);
    setCopiedGhCmd(true);
    scheduleTimer(() => setCopiedGhCmd(false), 2000);
  };

  const handleDownloadFile = () => {
    triggerHapticFeedback('medium');
    const blob = new Blob([currentFile.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFile.filename.split('/').pop() || currentFile.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    scheduleTimer(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadZip = async () => {
    triggerHapticFeedback('heavy');
    setIsZipping(true);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      liveSnippets.forEach((file) => {
        zip.file(file.filename, file.code);
      });
      if (patchNotes) {
        zip.file('PATCH_NOTES.md', patchNotes);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai_netcontroller_v0.90.0_source_and_builders.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      scheduleTimer(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      console.error('ZIP generation failed:', err);
    } finally {
      setIsZipping(false);
    }
  };

  const artifacts: ReleaseArtifact[] = manifest?.artifacts || [
    {
      filename: 'AI_NetController_HostAgent_v0.90.0_win64.exe',
      kind: 'exe',
      platform: 'Windows 10/11 x64 (Standalone Host Agent .EXE)',
      sizeBytes: 0,
      sizeFormatted: 'Build Required',
      sha256: 'not_built_yet',
      downloadUrl: '/releases/v0.90.0/AI_NetController_HostAgent_v0.90.0_win64.exe',
    },
    {
      filename: 'AI_NetController_v0.90.0_arm64-v8a.apk',
      kind: 'apk',
      platform: 'Android 10-15 arm64-v8a (Mobile Controller .APK)',
      sizeBytes: 0,
      sizeFormatted: 'Build Required',
      sha256: 'not_built_yet',
      downloadUrl: '/releases/v0.90.0/AI_NetController_v0.90.0_arm64-v8a.apk',
    },
    {
      filename: 'AI_NetController_HostAgent_v0.90.0_win64_portable.zip',
      kind: 'zip',
      platform: 'Windows Portable Agent Bundle + Internal Runtime (.ZIP)',
      sizeBytes: 0,
      sizeFormatted: 'Build Required',
      sha256: 'not_built_yet',
      downloadUrl: '/releases/v0.90.0/AI_NetController_HostAgent_v0.90.0_win64_portable.zip',
    },
  ];

  const hasFrontend = liveSnippets.some(
    (s) => s.category === 'frontend' || s.filename.startsWith('apps/web/src/')
  );

  const navCategories = [
    {
      id: 'releases' as const,
      label: isBg ? 'Релийзи (.APK / .EXE)' : 'Release Binaries',
      icon: Sparkles,
      onClick: () => setSelectedCategory('releases'),
    },
    {
      id: 'backend' as const,
      label: 'Python Agent',
      icon: Server,
      onClick: () => {
        setSelectedCategory('backend');
        setActiveFilename('agent/agent.py');
      },
    },
    {
      id: 'crossplatform' as const,
      label: 'Flutter (Dart)',
      icon: Smartphone,
      onClick: () => {
        setSelectedCategory('crossplatform');
        setActiveFilename('apps/mobile/lib/protocol/binary_protocol.dart');
      },
    },
    {
      id: 'android' as const,
      label: 'Android Manifest',
      icon: Terminal,
      onClick: () => {
        setSelectedCategory('android');
        setActiveFilename('apps/mobile/android/app/src/main/AndroidManifest.xml');
      },
    },
    ...(hasFrontend
      ? [
          {
            id: 'frontend' as const,
            label: 'Web UI (React)',
            icon: Code2,
            onClick: () => {
              const firstFrontend = liveSnippets.find(
                (s) => s.category === 'frontend' || s.filename.startsWith('apps/web/src/')
              );
              setSelectedCategory('frontend');
              if (firstFrontend) setActiveFilename(firstFrontend.filename);
            },
          },
        ]
      : []),
    {
      id: 'docs' as const,
      label: 'Architecture & Docs',
      icon: BookOpen,
      onClick: () => {
        setSelectedCategory('docs');
        setActiveFilename('docs/ARCHITECTURE.md');
      },
    },
    {
      id: 'all' as const,
      label: isBg ? `Всички (${liveSnippets.length})` : `All Files (${liveSnippets.length})`,
      icon: Layers,
      onClick: () => setSelectedCategory('all'),
    },
  ];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          triggerHapticFeedback('light');
          onClose();
        }
      }}
      style={{ backgroundColor: 'var(--backdrop-scrim)' }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 backdrop-blur-md"
    >
      <motion.div
        variants={MODAL_BUBBLE_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-[28px] glass-liquid-modal overflow-hidden"
      >
        {/* Specular Top Accent */}
        <div className="h-1 w-full bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-secondary)] to-[var(--accent-tertiary)] shrink-0" />

        {/* Header Bar */}
        <div className="px-4 sm:px-6 py-4 border-b border-[var(--glass-border)] flex items-start sm:items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 squircle-badge squircle-hero shrink-0">
              <Code2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-sm sm:text-lg font-extrabold ink-primary font-display tracking-tight break-words">
                  {isBg ? 'Бинарни релийзи и сорс код' : 'Release Binaries & Source Code'}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono font-bold shrink-0">
                  v0.90.0
                </span>
                {rebuildMessage && (
                  <span className="text-[11px] font-mono text-[var(--accent-primary)] font-semibold">
                    {rebuildMessage}
                  </span>
                )}
              </div>
              <p className="text-xs ink-secondary break-words line-clamp-2 sm:truncate">
                {isBg
                  ? 'Готови компилирани Windows .EXE и Android .APK пакети • SHA-256 • Сорс код'
                  : 'Pre-packaged Windows .EXE & Android .APK binaries • SHA-256 verification • Source'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.96 }}
              transition={SPRING_POP}
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="min-h-[40px] flex items-center gap-1.5 px-3.5 py-2 rounded-full liquid-hero-btn preserve-white text-xs font-display font-bold cursor-pointer disabled:opacity-50"
            >
              <Package className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {isZipping
                  ? isBg
                    ? 'Архивиране...'
                    : 'Archiving...'
                  : isBg
                  ? 'Свали проект (.ZIP)'
                  : 'Download Source (.ZIP)'}
              </span>
              <span className="sm:hidden">.ZIP</span>
            </motion.button>

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                onClose();
              }}
              className="min-w-[40px] min-h-[40px] w-10 h-10 rounded-full liquid-control-pill ink-secondary hover:ink-primary flex items-center justify-center transition cursor-pointer shrink-0"
              title={isBg ? 'Затвори' : 'Close'}
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sliding Pill Category Bar */}
        <div className="px-4 sm:px-6 py-2.5 glass-liquid-subtle border-b border-[var(--glass-border)] flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
          {navCategories.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  cat.onClick();
                }}
                className={`relative min-h-[34px] px-3.5 py-1.5 rounded-full text-xs font-display font-semibold transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer z-10 ${
                  isActive ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="codeExportCategoryPill"
                    transition={SPRING_BUBBLY}
                    className="absolute inset-0 rounded-full liquid-hero-btn -z-10 transform-gpu"
                  />
                )}
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {selectedCategory === 'releases' ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-5 bouncy-scroll">
            {/* Release Section Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-display font-extrabold ink-primary flex items-center gap-2 break-words">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    {isBg
                      ? 'Официални компилирани пакети (v0.90.0)'
                      : 'Official Packaged Release Binaries (v0.90.0)'}
                  </span>
                </h3>
                <p className="text-xs ink-secondary break-words">
                  {isBg
                    ? 'Директно сваляне на Windows .EXE, Android .APK и SHA-256 контролни суми'
                    : 'Direct download for Windows .EXE Host Agent, Android .APK Mobile Controller & SHA-256'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    useUIStore.getState().openModal('pcDaemonGui');
                  }}
                  className="min-h-[36px] px-3 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/22 border border-emerald-500/35 text-xs font-display font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>{isBg ? 'PC Демон GUI' : 'PC Daemon GUI'}</span>
                </button>
                <a
                  href="/releases/v0.90.0/SHA256SUMS.txt"
                  download="SHA256SUMS.txt"
                  className="min-h-[36px] px-3 py-1.5 rounded-full liquid-control-pill text-xs font-mono font-semibold ink-primary flex items-center gap-1.5 transition"
                >
                  <FileText className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                  <span>SHA256SUMS.txt</span>
                </a>
                <button
                  type="button"
                  onClick={handleRebuildBinaries}
                  disabled={isRebuilding}
                  className="min-h-[36px] px-3 py-1.5 rounded-full liquid-control-pill text-xs font-display font-semibold ink-primary flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-[var(--accent-primary)] ${
                      isRebuilding ? 'animate-spin' : ''
                    }`}
                  />
                  <span>
                    {isRebuilding
                      ? isBg
                        ? 'Компилиране...'
                        : 'Rebuilding...'
                      : isBg
                      ? 'Прекомпилирай'
                      : 'Rebuild'}
                  </span>
                </button>
              </div>
            </div>

            {/* 3 Glossy Artifact Download Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {artifacts.map((art) => {
                const badgeClass =
                  art.kind === 'exe'
                    ? 'squircle-sky'
                    : art.kind === 'apk'
                    ? 'squircle-emerald'
                    : 'squircle-violet';
                const ArtIcon =
                  art.kind === 'exe' ? Monitor : art.kind === 'apk' ? Smartphone : Archive;

                return (
                  <div
                    key={art.filename}
                    className="rounded-3xl glass-liquid-subtle border border-[var(--glass-border)] p-4 flex flex-col justify-between space-y-3 hover:border-[var(--accent-primary)]/45 transition"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-9 h-9 squircle-badge ${badgeClass} shrink-0`}>
                            <ArtIcon className="w-4.5 h-4.5" />
                          </div>
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase liquid-control-pill ink-primary">
                            .{art.kind.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono ink-muted tabular-nums">
                          {art.sizeFormatted}
                        </span>
                      </div>
                      <div className="font-mono text-xs font-bold ink-primary break-all">
                        {art.filename}
                      </div>
                      <p className="text-[11px] ink-secondary leading-snug">{art.platform}</p>
                    </div>

                    <div className="space-y-2.5 pt-2.5 border-t border-[var(--glass-border)]">
                      <div className="flex items-center justify-between text-[10.5px] font-mono ink-muted gap-2">
                        <span className="truncate" title={art.sha256}>
                          SHA256: {art.sha256.slice(0, 12)}…
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            triggerHapticFeedback('light');
                            copyToClipboard(art.sha256);
                            setCopiedSha(art.filename);
                            scheduleTimer(() => setCopiedSha(null), 1800);
                          }}
                          className="text-[var(--accent-primary)] font-semibold hover:underline cursor-pointer shrink-0"
                        >
                          {copiedSha === art.filename
                            ? isBg
                              ? 'Копирано!'
                              : 'Copied!'
                            : isBg
                            ? 'Копирай SHA'
                            : 'Copy SHA'}
                        </button>
                      </div>

                      <a
                        href={art.downloadUrl}
                        download={art.filename}
                        onClick={() => triggerHapticFeedback('medium')}
                        className="w-full min-h-[40px] py-2 px-3 rounded-full liquid-hero-btn preserve-white font-display text-xs font-bold flex items-center justify-center gap-1.5 transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>
                          {isBg
                            ? `Свали .${art.kind.toUpperCase()}`
                            : `Download .${art.kind.toUpperCase()}`}
                        </span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Collapsible Progressive Disclosure: CI Publish CLI */}
            <div className="rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  triggerHapticFeedback('light');
                  setShowCliDrawer((v) => !v);
                }}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 text-xs font-display font-bold ink-primary hover:bg-[var(--glass-surface-hover)] transition cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Terminal className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
                  <span className="truncate">
                    {isBg
                      ? 'Публикуване в GitHub / GitLab Releases (CLI / CI Pipeline)'
                      : 'Publish to GitHub & GitLab Releases (CLI / CI Pipeline)'}
                  </span>
                </span>
                {showCliDrawer ? (
                  <ChevronUp className="w-4 h-4 ink-muted shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 ink-muted shrink-0" />
                )}
              </button>
              <AnimatePresence initial={false}>
                {showCliDrawer && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-[var(--glass-border)]"
                  >
                    <div className="p-4 space-y-2.5">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleCopyGhCommands}
                          className="px-3 py-1 rounded-full liquid-control-pill text-xs font-display font-semibold ink-primary flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedGhCmd ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                          )}
                          <span>
                            {copiedGhCmd
                              ? isBg
                                ? 'Копирано!'
                                : 'Copied!'
                              : isBg
                              ? 'Копирай команди'
                              : 'Copy Commands'}
                          </span>
                        </button>
                      </div>
                      <pre className="p-3.5 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] font-mono text-[11px] ink-primary overflow-x-auto leading-relaxed">
                        <code>{ghReleaseCommands}</code>
                      </pre>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Collapsible Progressive Disclosure: Official Patch Notes */}
            {patchNotes && (
              <div className="rounded-2xl glass-liquid-subtle border border-[var(--glass-border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setShowPatchNotes((v) => !v);
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between gap-2 text-xs font-display font-bold ink-primary hover:bg-[var(--glass-surface-hover)] transition cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>PATCH_NOTES.md (v0.90.0)</span>
                  </span>
                  {showPatchNotes ? (
                    <ChevronUp className="w-4 h-4 ink-muted shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 ink-muted shrink-0" />
                  )}
                </button>
                <AnimatePresence initial={false}>
                  {showPatchNotes && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-[var(--glass-border)]"
                    >
                      <div className="p-4">
                        <pre className="p-3.5 rounded-2xl liquid-terminal-entry border border-[var(--glass-border)] font-mono text-[11px] ink-secondary max-h-64 overflow-y-auto bouncy-scroll whitespace-pre-wrap leading-relaxed">
                          {patchNotes}
                        </pre>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Sub-header File Selector Bar */}
            <div className="px-4 sm:px-6 py-2 glass-liquid-subtle border-b border-[var(--glass-border)] flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-thin">
              {filteredSnippets.map((file) => (
                <button
                  key={file.filename}
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setActiveFilename(file.filename);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono transition whitespace-nowrap cursor-pointer border ${
                    activeFilename === file.filename
                      ? 'bg-[var(--accent-primary)]/16 text-[var(--accent-primary)] border-[var(--accent-primary)]/40 font-bold'
                      : 'ink-secondary hover:ink-primary border-transparent hover:bg-[var(--glass-surface-hover)]'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0" />
                  <span>{file.filename}</span>
                </button>
              ))}
            </div>

            {/* File Metadata & Quick Actions */}
            <div className="px-4 sm:px-6 py-2.5 border-b border-[var(--glass-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 text-xs min-w-0">
                <span className="px-2.5 py-0.5 rounded-full bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] font-mono text-[10px] font-bold uppercase shrink-0">
                  {currentFile.language}
                </span>
                <span className="ink-primary font-display font-semibold break-words truncate">
                  {currentFile.description}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="min-h-[34px] flex items-center gap-1.5 px-3 py-1 rounded-full liquid-control-pill ink-primary text-xs font-display font-semibold transition cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                  )}
                  <span>{copied ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadFile}
                  className="min-h-[34px] flex items-center gap-1.5 px-3.5 py-1 rounded-full liquid-hero-btn preserve-white text-xs font-display font-bold transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Свали файл' : 'Download'}</span>
                </button>
              </div>
            </div>

            {/* Adaptive Liquid Terminal Code Viewer */}
            <div className="flex-1 p-4 sm:p-6 liquid-terminal-pane overflow-y-auto overflow-x-auto font-mono text-xs ink-primary select-text bouncy-scroll">
              <pre className="leading-relaxed">
                <code>{currentFile.code}</code>
              </pre>
            </div>
          </>
        )}

        {/* Footer Info Bar */}
        <div className="px-4 sm:px-6 py-2.5 glass-liquid-subtle border-t border-[var(--glass-border)] flex items-center justify-between text-[11px] font-mono ink-muted shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              {isBg
                ? 'v0.90.0 Бинарни пакети (.APK & .EXE) • UTF-8'
                : 'v0.90.0 Release Pipeline (.APK & .EXE) • UTF-8'}
            </span>
          </div>
          <span>AI-NET/3.0-SECURE</span>
        </div>
      </motion.div>
    </div>
  );
};
