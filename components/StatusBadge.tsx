'use client';

type StatusBadgeState = 'idle' | 'listening' | 'thinking' | 'speaking';

type StatusBadgeProps = {
  state: StatusBadgeState;
  latency: number | null;
};

const STATE_STYLES: Record<StatusBadgeState, { label: string; color: string; glow: string }> = {
  speaking: {
    label: 'Speaking',
    color: 'bg-emerald-400',
    glow: 'shadow-emerald-400/70',
  },
  listening: {
    label: 'Listening',
    color: 'bg-blue-400',
    glow: 'shadow-blue-400/70',
  },
  thinking: {
    label: 'Thinking',
    color: 'bg-purple-400',
    glow: 'shadow-purple-400/70',
  },
  idle: {
    label: 'Idle',
    color: 'bg-gray-400',
    glow: 'shadow-gray-400/60',
  },
};

export default function StatusBadge({ state, latency }: StatusBadgeProps) {
  const styles = STATE_STYLES[state];

  return (
    <div className="inline-flex items-center gap-4 rounded-full border border-slate-700/50 bg-slate-800/40 px-4 py-2 backdrop-blur-lg">
      <div className="flex items-center gap-2" aria-label={`Status: ${styles.label}`}>
        <span className="relative flex h-3 w-3 items-center justify-center">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${styles.color} opacity-50`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${styles.color} shadow-lg ${styles.glow}`} />
        </span>
        <span className="text-sm font-medium text-slate-100">{styles.label}</span>
      </div>

      <span className="h-4 w-px bg-slate-600/70" aria-hidden="true" />

      <div
        className="flex items-center gap-2 whitespace-nowrap font-mono text-xs text-slate-300"
        aria-live="polite"
        aria-label={`System latency ${latency === null ? 'unavailable' : `${latency} milliseconds`}, 16 kilohertz PCM`}
      >
        <span aria-hidden="true">⚡</span>
        <span>{latency === null ? '--' : latency}ms | 16kHz PCM</span>
        <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${styles.color}`} aria-hidden="true" />
      </div>
    </div>
  );
}
