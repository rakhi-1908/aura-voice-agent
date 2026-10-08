'use client';

import { useEffect, useRef } from 'react';

type AudioVisualizerState = 'idle' | 'listening' | 'thinking' | 'speaking';

type AudioVisualizerProps = {
  analyser: AnalyserNode | null;
  state: AudioVisualizerState;
};

const BAR_COUNT = 48;

const STATE_GRADIENTS: Record<AudioVisualizerState, [string, string, string]> = {
  speaking: ['#a7f3d0', '#10b981', '#047857'],
  listening: ['#bfdbfe', '#3b82f6', '#1d4ed8'],
  thinking: ['#e9d5ff', '#a855f7', '#7e22ce'],
  idle: ['#cbd5e1', '#94a3b8', '#64748b'],
};

export default function AudioVisualizer({ analyser, state }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let animationFrame = 0;
    let frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const barHeights = new Float32Array(BAR_COUNT).fill(0.06);
    const [topColor, middleColor, bottomColor] = STATE_GRADIENTS[state];

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(bounds.width * pixelRatio));
      const height = Math.max(1, Math.round(bounds.height * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      context.clearRect(0, 0, width, height);

      if (analyser && frequencyData) {
        if (frequencyData.length !== analyser.frequencyBinCount) {
          frequencyData = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(frequencyData);
      }

      const barCount = Math.max(1, Math.min(BAR_COUNT, Math.floor(width / (6 * pixelRatio))));
      const gap = Math.min(3 * pixelRatio, width / (barCount * 2));
      const barWidth = (width - gap * (barCount - 1)) / barCount;

      for (let index = 0; index < barCount; index++) {
        let targetHeight = 0.06;

        if (frequencyData?.length) {
          const start = Math.floor((index * frequencyData.length) / barCount);
          const end = Math.max(start + 1, Math.floor(((index + 1) * frequencyData.length) / barCount));
          let total = 0;
          for (let bin = start; bin < end && bin < frequencyData.length; bin++) {
            total += frequencyData[bin];
          }
          const average = total / Math.max(1, Math.min(end, frequencyData.length) - start);
          targetHeight = 0.06 + Math.sqrt(average / 255) * 0.82;
        }

        barHeights[index] += (targetHeight - barHeights[index]) * 0.22;
        const barHeight = Math.max(2 * pixelRatio, barHeights[index] * height);
        const x = index * (barWidth + gap);
        const y = (height - barHeight) / 2;
        const gradient = context.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, topColor);
        gradient.addColorStop(0.55, middleColor);
        gradient.addColorStop(1, bottomColor);

        context.fillStyle = gradient;
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        context.fill();
      }

      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [analyser, state]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-20 w-full"
      role="img"
      aria-label={`${state} audio frequency visualizer`}
    >
      Audio frequency visualizer
    </canvas>
  );
}
