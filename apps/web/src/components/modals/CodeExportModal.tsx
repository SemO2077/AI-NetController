import React, { useState, useEffect, useRef, useCallback } from 'react';
import JSZip from 'jszip';
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
  Monitor
} from 'lucide-react';
import { CODE_SNIPPETS } from '../../data/codeSnippets';
import { ENTERPRISE_SNIPPETS } from '../../data/enterpriseSnippets';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../store/uiStore';
import { copyToClipboard } from '../../utils/clipboard';

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
        fetch('/releases/v0.60.0/RELEASE_MANIFEST.json', { signal: controller.signal })
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
    filteredSnippets.find((f) => f.filename === activeFilename) || filteredSnippets[0] || liveSnippets[0] || ALL_SNIPPETS[0];

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

  const ghReleaseCommands = `# 1. Tag and push Beta 0.60.00 (v0.60.0)
git add .
git commit -m "release: AI NetController Beta 0.60.00 (v0.60.0)"
git tag -a v0.60.0 -m "AI NetController v0.60.0 (Beta 0.60.00)"
git push origin main --tags

# 2. Publish pre-built binaries to GitHub Releases:
python scripts/publish_github_release.py`;

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
    a.click();
    scheduleTimer(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadZip = async () => {
    triggerHapticFeedback('heavy');
    setIsZipping(true);
    try {
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
      a.download = 'ai_netcontroller_v0.60.0_source_and_builders.zip';
      a.click();
      scheduleTimer(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      console.error('ZIP generation failed:', err);
    } finally {
      setIsZipping(false);
    }
  };

  const artifacts: ReleaseArtifact[] = manifest?.artifacts || [
    {
      filename: 'AI_NetController_HostAgent_v0.60.0_win64.exe',
      kind: 'exe',
      platform: 'Windows 10/11 x64 (Standalone Host Agent .EXE)',
      sizeBytes: 0,
      sizeFormatted: 'Build Required',
      sha256: 'not_built_yet',
      downloadUrl: '/releases/v0.60.0/AI_NetController_HostAgent_v0.60.0_win64.exe',
    },
    {
      filename: 'AI_NetController_v0.60.0_arm64-v8a.apk',
      kind: 'apk',
      platform: 'Android 10-15 arm64-v8a (Mobile Controller .APK)',
      sizeBytes: 0,
      sizeFormatted: 'Build Required',
      sha256: 'not_built_yet',
      downloadUrl: '/releases/v0.60.0/AI_NetController_v0.60.0_arm64-v8a.apk',
    },
    {
      filename: 'AI_NetController_HostAgent_v0.60.0_win64_portable.zip',
      kind: 'zip',
      platform: 'Windows Portable Agent Bundle + Internal Runtime (.ZIP)',
      sizeBytes: 0,
      sizeFormatted: 'Build Required',
      sha256: 'not_built_yet',
      downloadUrl: '/releases/v0.60.0/AI_NetController_HostAgent_v0.60.0_win64_portable.zip',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-[24px] bg-[#091020]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 shadow-[0_24px_64px_rgba(0,0,0,0.9)] overflow-hidden">
        {/* Header Bar */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-white/[0.02] flex items-start sm:items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-start sm:items-center space-x-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-[12px] bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.25)] shrink-0">
              <Code2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-sm sm:text-lg font-bold text-white font-display uppercase tracking-wider break-words">
                  {isBg ? 'БИНАРНИ РЕЛИЙЗИ (.APK / .EXE) И КОД' : 'RELEASE BINARIES (.APK / .EXE) & SOURCE'}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-[10px] font-mono font-semibold shrink-0">
                  Beta v0.60.0
                </span>
                {rebuildMessage && (
                  <span className="text-[11px] font-mono text-cyan-300">{rebuildMessage}</span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono break-words line-clamp-2 sm:truncate">
                {isBg
                  ? 'Готови компилирани .EXE и .APK пакети • GitHub Release Pipeline • Пълен сорс код'
                  : 'Pre-packaged Windows .EXE & Android .APK binaries • GitHub Release Pipeline • Full Source'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="min-h-[42px] flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-mono font-bold transition shadow-[0_0_15px_rgba(34,211,238,0.35)] cursor-pointer"
            >
              <Package className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">
                {isZipping ? (isBg ? 'Архивиране...' : 'Archiving...') : isBg ? 'Свали Проект (.ZIP)' : 'Download Source (.ZIP)'}
              </span>
              <span className="sm:hidden">.ZIP</span>
            </button>

            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                onClose();
              }}
              className="min-w-[42px] min-h-[42px] w-10 h-10 rounded-xl bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 flex items-center justify-center transition cursor-pointer shrink-0"
              title={isBg ? 'Затвори' : 'Close'}
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Category Navigation Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#060b16]/90 border-y border-white/10 flex items-center space-x-2 overflow-x-auto shrink-0 scrollbar-none">
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('releases');
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition flex items-center space-x-2 whitespace-nowrap cursor-pointer ${
              selectedCategory === 'releases'
                ? 'bg-emerald-400 text-slate-950 shadow-[0_0_12px_rgba(52,211,153,0.45)] font-bold'
                : 'bg-white/5 text-emerald-300 hover:text-white border border-emerald-500/30'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isBg ? 'Beta v0.60.0 .APK & .EXE Релийз' : 'Beta v0.60.0 .APK & .EXE Releases'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedCategory('backend');
              setActiveFilename('agent/agent.py');
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition flex items-center space-x-2 whitespace-nowrap cursor-pointer ${
              selectedCategory === 'backend'
                ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)] font-bold'
                : 'bg-white/5 text-slate-300 hover:text-white border border-white/10'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>🐍 Python Agent (3.12+)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedCategory('crossplatform');
              setActiveFilename('apps/mobile/lib/main.dart');
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition flex items-center space-x-2 whitespace-nowrap cursor-pointer ${
              selectedCategory === 'crossplatform'
                ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)] font-bold'
                : 'bg-white/5 text-slate-300 hover:text-white border border-white/10'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>📱 Flutter 3.29 (Dart)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedCategory('android');
              setActiveFilename('apps/mobile/android/app/src/main/AndroidManifest.xml');
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition flex items-center space-x-2 whitespace-nowrap cursor-pointer ${
              selectedCategory === 'android'
                ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)] font-bold'
                : 'bg-white/5 text-slate-300 hover:text-white border border-white/10'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>🤖 Android Manifest</span>
          </button>

          {liveSnippets.some(
            (s) => s.category === 'frontend' || s.filename.startsWith('apps/web/src/')
          ) && (
            <button
              type="button"
              onClick={() => {
                const firstFrontend = liveSnippets.find(
                  (s) => s.category === 'frontend' || s.filename.startsWith('apps/web/src/')
                );
                setSelectedCategory('frontend');
                if (firstFrontend) setActiveFilename(firstFrontend.filename);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition flex items-center space-x-2 whitespace-nowrap cursor-pointer ${
                selectedCategory === 'frontend'
                  ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)] font-bold'
                  : 'bg-white/5 text-slate-300 hover:text-white border border-white/10'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>⚛️ Web UI (React)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setSelectedCategory('docs');
              setActiveFilename('docs/OPEN_SOURCE_MODELS_ARCH.md');
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition flex items-center space-x-2 whitespace-nowrap cursor-pointer ${
              selectedCategory === 'docs'
                ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)] font-bold'
                : 'bg-white/5 text-slate-300 hover:text-white border border-white/10'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>📚 Architecture &amp; CI/CD</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedCategory('all');
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-semibold transition flex items-center space-x-2 whitespace-nowrap cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.45)] font-bold'
                : 'bg-white/5 text-slate-300 hover:text-white border border-white/10'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{isBg ? `Всички файлове (${liveSnippets.length})` : `All Files (${liveSnippets.length})`}</span>
          </button>
        </div>

        {selectedCategory === 'releases' ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-5 bg-[#050914]">
            {/* Binary Release Cards */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-white font-mono flex items-center gap-2 break-words">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {isBg
                      ? 'Официални компилирани бинарни пакети (Beta v0.60.0)'
                      : 'Official Packaged Release Binaries (Beta v0.60.0)'}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 font-mono break-words">
                  {isBg
                    ? 'Директно сваляне на Windows .EXE демон, Android .APK клиент и SHA-256 контролни суми'
                    : 'Direct download for Windows .EXE Host Daemon, Android .APK Mobile Controller, and SHA-256 checksums'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    useUIStore.getState().openModal('pcDaemonGui');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 text-xs font-mono font-semibold text-emerald-300 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Отвори PC Демон GUI' : 'Open PC Daemon GUI'}</span>
                </button>
                <a
                  href="/releases/v0.60.0/SHA256SUMS.txt"
                  download="SHA256SUMS.txt"
                  className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-mono text-cyan-300 flex items-center gap-1.5 transition"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>SHA256SUMS.txt</span>
                </a>
                <button
                  type="button"
                  onClick={handleRebuildBinaries}
                  disabled={isRebuilding}
                  className="px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-xs font-mono text-cyan-300 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
                  <span>{isRebuilding ? (isBg ? 'Компилиране...' : 'Rebuilding...') : isBg ? 'Прекомпилирай' : 'Rebuild Binaries'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {artifacts.map((art) => (
                <div
                  key={art.filename}
                  className="rounded-2xl bg-[#0b1324]/80 border border-white/12 p-4 flex flex-col justify-between space-y-3 hover:border-cyan-400/40 transition"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                          art.kind === 'exe'
                            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/30'
                            : art.kind === 'apk'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                            : 'bg-violet-500/15 text-violet-300 border-violet-400/30'
                        }`}
                      >
                        .{art.kind.toUpperCase()}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">{art.sizeFormatted}</span>
                    </div>
                    <div className="font-mono text-xs font-bold text-white break-all">{art.filename}</div>
                    <p className="text-[11px] text-slate-400">{art.platform}</p>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span className="truncate max-w-[180px]" title={art.sha256}>
                        SHA256: {art.sha256.slice(0, 14)}…
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          copyToClipboard(art.sha256);
                          setCopiedSha(art.filename);
                          scheduleTimer(() => setCopiedSha(null), 1800);
                        }}
                        className="text-cyan-400 hover:underline cursor-pointer"
                      >
                        {copiedSha === art.filename ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай SHA' : 'Copy SHA'}
                      </button>
                    </div>

                    <a
                      href={art.downloadUrl}
                      download={art.filename}
                      onClick={() => triggerHapticFeedback('medium')}
                      className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 hover:brightness-110 text-slate-950 font-mono text-xs font-bold flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(34,211,238,0.3)] transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{isBg ? `Свали .${art.kind.toUpperCase()}` : `Download .${art.kind.toUpperCase()}`}</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>

            {/* GitHub Release Automation & CLI Commands */}
            <div className="rounded-2xl bg-[#0b1324]/70 border border-white/10 p-4 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span className="text-xs font-mono font-bold text-white uppercase break-words">
                    {isBg
                      ? 'Публикуване в GitHub Releases (gh CLI / CI Pipeline)'
                      : 'Publish to GitHub Releases (gh CLI / CI Pipeline)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyGhCommands}
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-cyan-500/20 border border-white/15 text-xs font-mono text-white flex items-center gap-1.5 transition cursor-pointer shrink-0"
                >
                  {copiedGhCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
                  <span>{copiedGhCmd ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай команди' : 'Copy Commands'}</span>
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-black/60 border border-white/10 font-mono text-[11px] text-cyan-200 overflow-x-auto leading-relaxed">
                <code>{ghReleaseCommands}</code>
              </pre>
            </div>

            {/* Official Patch Notes Preview */}
            {patchNotes && (
              <div className="rounded-2xl bg-[#0b1324]/70 border border-white/10 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-emerald-300 uppercase">
                    PATCH_NOTES.md (Beta v0.60.0)
                  </span>
                </div>
                <pre className="p-3.5 rounded-xl bg-black/60 border border-white/10 font-mono text-[11px] text-slate-300 max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {patchNotes}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Sub-header File Selector Bar */}
            <div className="px-4 sm:px-6 py-2 bg-[#040812]/95 border-b border-white/10 flex items-center space-x-2 overflow-x-auto shrink-0 scrollbar-thin">
              {filteredSnippets.map((file) => (
                <button
                  key={file.filename}
                  type="button"
                  onClick={() => {
                    setActiveFilename(file.filename);
                  }}
                  className={`flex items-center space-x-2 px-3 py-1 rounded-[8px] text-xs font-mono transition whitespace-nowrap cursor-pointer ${
                    activeFilename === file.filename
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/40 font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>{file.filename}</span>
                </button>
              ))}
            </div>

            {/* File Metadata & Quick Actions */}
            <div className="px-4 sm:px-6 py-2.5 bg-[#081120]/95 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center space-x-2 text-xs min-w-0">
                <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-400/30 text-cyan-300 font-mono text-[10px] font-bold uppercase shrink-0">
                  {currentFile.language}
                </span>
                <span className="text-white font-medium break-words truncate">{currentFile.description}</span>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded-[8px] bg-white/10 hover:bg-cyan-500/20 border border-white/15 text-white text-xs font-mono transition cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-300" />}
                  <span>{copied ? (isBg ? 'Копирано!' : 'Copied!') : isBg ? 'Копирай' : 'Copy'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadFile}
                  className="flex items-center space-x-1.5 px-3 py-1 rounded-[8px] bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-mono font-bold transition shadow-[0_0_10px_rgba(34,211,238,0.3)] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isBg ? 'Свали файл' : 'Download File'}</span>
                </button>
              </div>
            </div>

            {/* Code Content Window */}
            <div className="flex-1 p-4 sm:p-6 bg-[#040812] overflow-y-auto overflow-x-auto font-mono text-xs text-slate-300 select-text scrollbar-thin">
              <pre className="leading-relaxed">
                <code>{currentFile.code}</code>
              </pre>
            </div>
          </>
        )}

        {/* Footer info bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-[#081120]/95 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>
              {isBg
                ? 'Beta v0.60.0 Бинарни пакети (.APK & .EXE) • UTF-8'
                : 'Beta v0.60.0 Release Pipeline (.APK & .EXE) • UTF-8'}
            </span>
          </div>
          <span>AI-NET/3.0-SECURE</span>
        </div>
      </div>
    </div>
  );
};
