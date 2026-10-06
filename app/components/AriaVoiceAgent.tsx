'use client';

import { useEffect, useRef, useState } from 'react';

type CallStatus = 'Disconnected' | 'Connecting' | 'Reconnecting' | 'Listening' | 'Thinking' | 'Speaking';
type TranscriptSpeaker = 'You' | 'Aria';
type TranscriptLine = { id: number; speaker: TranscriptSpeaker; text: string; partial: boolean };
type LiveMessage = {
  setupComplete?: boolean;
  error?: { message?: string };
  toolCall?: { functionCalls?: Array<{ id: string; name: string; args: { order_id?: string; query?: string } }> };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
  };
};

const PLAYBACK_BUFFER_SAMPLES = 4800;
const PLAYBACK_FLUSH_DELAY_MS = 70;
const MAX_RECONNECT_ATTEMPTS = 5;

export default function AriaVoiceAgent() {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<CallStatus>('Disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const microphoneAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const queuedSamplesRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isPlayingRef = useRef(false);
  const nextPlaybackTimeRef = useRef(0);
  const playbackFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const shouldReconnectRef = useRef(false);
  const manualStopRef = useRef(false);
  const transcriptIdRef = useRef(0);

  const createAudioContext = (sampleRate: number) => {
    const browserWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextConstructor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
    if (!AudioContextConstructor) throw new Error('Web Audio is not supported in this browser.');
    return new AudioContextConstructor({ sampleRate });
  };

  const float32ToInt16PcmBase64 = (float32Array: Float32Array): string => {
    const int16Array = new Int16Array(float32Array.length);
    for (let index = 0; index < float32Array.length; index++) {
      const sample = Math.max(-1, Math.min(1, float32Array[index]));
      int16Array[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  };

  const appendTranscript = (speaker: TranscriptSpeaker, text: string) => {
    if (!text.trim()) return;
    setTranscript((previous) => {
      const lines = [...previous];
      const lastLine = lines[lines.length - 1];
      if (lastLine?.speaker === speaker && lastLine.partial) {
        lines[lines.length - 1] = { ...lastLine, text: `${lastLine.text}${text}` };
      } else {
        lines.push({ id: transcriptIdRef.current++, speaker, text, partial: true });
      }
      return lines.slice(-80);
    });
  };

  const finalizeTranscript = () => {
    setTranscript((previous) => previous.map((line) => line.partial ? { ...line, partial: false } : line));
  };

  const stopAudioPlayback = () => {
    if (playbackFlushTimerRef.current) clearTimeout(playbackFlushTimerRef.current);
    playbackFlushTimerRef.current = null;
    audioQueueRef.current = [];
    queuedSamplesRef.current = 0;
    nextPlaybackTimeRef.current = audioContextRef.current?.currentTime ?? 0;
    for (const source of activeSourcesRef.current) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        continue;
      }
    }
    activeSourcesRef.current.clear();
    isPlayingRef.current = false;
  };

  const cleanupAudio = () => {
    stopAudioPlayback();
    if (workletRef.current) {
      workletRef.current.port.onmessage = null;
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    microphoneSourceRef.current?.disconnect();
    microphoneSourceRef.current = null;
    microphoneAnalyserRef.current?.disconnect();
    microphoneAnalyserRef.current = null;
    outputAnalyserRef.current?.disconnect();
    outputAnalyserRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(() => undefined);
  };

  const sendMicrophoneChunk = (float32Data: Float32Array) => {
    const ws = wsRef.current;
    if (!ws || !sessionReadyRef.current || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1_000_000) return;

    let sumSquares = 0;
    for (const sample of float32Data) sumSquares += sample * sample;
    const rms = Math.sqrt(sumSquares / float32Data.length);
    if (activeSourcesRef.current.size > 0 && rms > 0.045) {
      stopAudioPlayback();
      setStatus('Listening');
    }

    ws.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: float32ToInt16PcmBase64(float32Data),
        },
      },
    }));
  };

  const startMicrophoneStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is unavailable. Use a supported browser over HTTPS or localhost.');
    }

    const audioContext = createAudioContext(16000);
    audioContextRef.current = audioContext;
    if (!audioContext.audioWorklet) throw new Error('AudioWorklet is not supported in this browser.');
    await audioContext.resume();
    await audioContext.audioWorklet.addModule('/pcm-processor.js');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    mediaStreamRef.current = stream;

    const microphoneSource = audioContext.createMediaStreamSource(stream);
    const microphoneAnalyser = audioContext.createAnalyser();
    microphoneAnalyser.fftSize = 256;
    const worklet = new AudioWorkletNode(audioContext, 'pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => sendMicrophoneChunk(event.data);

    const outputAnalyser = audioContext.createAnalyser();
    outputAnalyser.fftSize = 256;
    outputAnalyser.connect(audioContext.destination);

    microphoneSource.connect(microphoneAnalyser);
    microphoneAnalyser.connect(worklet);
    worklet.connect(audioContext.destination);
    microphoneSourceRef.current = microphoneSource;
    microphoneAnalyserRef.current = microphoneAnalyser;
    outputAnalyserRef.current = outputAnalyser;
    workletRef.current = worklet;
  };

  const sendToolResponse = async (ws: WebSocket, call: { id: string; name: string; args: { order_id?: string; query?: string } }) => {
    let output: unknown;

    const isProductSearch = call.name === 'search_products';
    const query = call.args.query?.trim();
    const orderId = call.args.order_id?.trim();
    if (isProductSearch && !query) {
      output = { products: [], message: 'No product search terms were provided.' };
    } else if (!isProductSearch && !orderId) {
      output = { found: false, message: 'The customer did not provide an order ID.' };
    } else {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const endpoint = isProductSearch
          ? `/api/products?query=${encodeURIComponent(query!)}`
          : `/api/order?order_id=${encodeURIComponent(orderId!)}`;
        const response = await fetch(endpoint, { signal: controller.signal });
        if (response.status === 404) {
          output = { found: false, message: 'The requested search is temporarily unavailable. Please tell the customer and invite them to try again shortly.' };
        } else if (!response.ok) {
          output = { found: false, message: 'The requested search failed. Please tell the customer and invite them to try again shortly.' };
        } else {
          const result = await response.json();
          output = isProductSearch ? { products: result } : result;
        }
      } catch (error) {
        output = {
          found: false,
          message: controller.signal.aborted
            ? 'The requested search timed out. Please tell the customer and invite them to try again shortly.'
            : 'The requested search failed. Please tell the customer and invite them to try again shortly.',
        };
        console.error('Order lookup failed:', error);
      } finally {
        clearTimeout(timeout);
      }
    }

    if (ws === wsRef.current && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        toolResponse: {
          functionResponses: [{ name: call.name, id: call.id, response: { output } }],
        },
      }));
    }
  };

  const connectWebSocket = () => {
    if (!shouldReconnectRef.current) return;

    sessionReadyRef.current = false;
    const wsUrl = new URL('/api/ws', window.location.href);
    wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    let failureMessage: string | null = null;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.8-live',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: `You are Aria, a friendly, professional, and concise customer support specialist for Aura Skincare, an organic Indian D2C skincare brand.

BRAND POLICIES:
- Free shipping on orders above ₹499.
- Returns accepted strictly within 7 days for unopened items.
- Cancellations allowed only for 'Processing' orders.
- COD available up to ₹2,500.

When the customer mentions an order ID, invoke get_order_details. When they ask about products or recommendations, invoke search_products using relevant product, category, or skin type terms. If a tool returns an error message, explain the problem briefly and conversationally without inventing details.` }],
          },
          tools: [{
            functionDeclarations: [
              {
                name: 'get_order_details',
                description: 'Retrieves live order information for a given order ID.',
                parameters: {
                  type: 'OBJECT',
                  properties: { order_id: { type: 'STRING', description: 'Order ID e.g. ORD-101' } },
                  required: ['order_id'],
                },
              },
              {
                name: 'search_products',
                description: 'Searches Aura Skincare catalog for products based on category, concern, or skin type.',
                parameters: {
                  type: 'OBJECT',
                  properties: { query: { type: 'STRING', description: 'Search query e.g. sunscreen, dry skin, serum.' } },
                  required: ['query'],
                },
              },
            ],
          }],
        },
      }));
    };

    ws.onmessage = async (event) => {
      if (ws !== wsRef.current) return;
      try {
        const messageText = typeof event.data === 'string'
          ? event.data
          : event.data instanceof Blob
            ? await event.data.text()
            : new TextDecoder().decode(event.data);
        const response = JSON.parse(messageText) as LiveMessage;

        if (response.error) {
          failureMessage = response.error.message ?? 'The voice service rejected the session setup.';
          ws.close();
          return;
        }
        if (response.setupComplete) {
          sessionReadyRef.current = true;
          hasConnectedRef.current = true;
          setIsConnected(true);
          setStatus('Listening');
          return;
        }

        const serverContent = response.serverContent;
        if (serverContent?.interrupted) {
          stopAudioPlayback();
          finalizeTranscript();
          setStatus('Listening');
        }
        if (serverContent?.inputTranscription?.text) appendTranscript('You', serverContent.inputTranscription.text);
        if (serverContent?.outputTranscription?.text) appendTranscript('Aria', serverContent.outputTranscription.text);
        if (serverContent?.turnComplete) finalizeTranscript();

        if (response.toolCall?.functionCalls?.length) {
          setStatus('Thinking');
          await Promise.all(response.toolCall.functionCalls.map((call) => sendToolResponse(ws, call)));
        }

        const parts = serverContent?.modelTurn?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) {
            playBase64Audio(part.inlineData.data);
          } else if (part.text && !serverContent?.outputTranscription?.text) {
            appendTranscript('Aria', part.text);
          }
        }
      } catch (error) {
        console.error('Unable to process voice response:', error);
        setConnectionError('A voice response could not be processed. The call is still active.');
      }
    };

    ws.onerror = (event) => {
      console.error('Voice WebSocket error:', event);
      failureMessage = 'Unable to connect to Gemini Live through the server. Check GEMINI_API_KEY and the server logs.';
    };

    ws.onclose = (event) => {
      if (ws !== wsRef.current) return;
      wsRef.current = null;
      sessionReadyRef.current = false;
      if (!shouldReconnectRef.current || manualStopRef.current) {
        cleanupAudio();
        setIsConnected(false);
        setStatus('Disconnected');
        return;
      }

      if (hasConnectedRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 16000);
        reconnectAttemptsRef.current += 1;
        setStatus('Reconnecting');
        reconnectTimerRef.current = setTimeout(connectWebSocket, delay);
        return;
      }

      setConnectionError(failureMessage ?? event.reason ?? 'The voice proxy disconnected. Check GEMINI_API_KEY on the server and start a new call.');
      shouldReconnectRef.current = false;
      cleanupAudio();
      setIsConnected(false);
      setStatus('Disconnected');
    };
  };

  const startCall = async () => {
    setConnectionError(null);
    setTranscript([]);
    transcriptIdRef.current = 0;
    setStatus('Connecting');
    manualStopRef.current = false;
    shouldReconnectRef.current = true;
    hasConnectedRef.current = false;
    reconnectAttemptsRef.current = 0;

    try {
      await startMicrophoneStream();
      connectWebSocket();
    } catch (error) {
      console.error('Unable to start microphone:', error);
      const name = error instanceof DOMException ? error.name : '';
      const message = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access was blocked. Allow microphone access in your browser settings and try again.'
        : name === 'NotFoundError'
          ? 'No microphone was found. Connect a microphone and try again.'
          : error instanceof Error
            ? error.message
            : 'Unable to access the microphone.';
      setConnectionError(message);
      shouldReconnectRef.current = false;
      cleanupAudio();
      setStatus('Disconnected');
    }
  };

  const playBase64Audio = (base64Data: string) => {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const float32 = new Float32Array(int16.length);
    for (let index = 0; index < int16.length; index++) {
      float32[index] = int16[index] / (int16[index] < 0 ? 0x8000 : 0x7fff);
    }

    audioQueueRef.current.push(float32);
    queuedSamplesRef.current += float32.length;
    isPlayingRef.current = true;
    setStatus('Speaking');
    schedulePlayback();
  };

  const schedulePlayback = (flushPartial = false) => {
    const audioContext = audioContextRef.current;
    const outputAnalyser = outputAnalyserRef.current;
    if (!audioContext || !outputAnalyser) return;

    while (queuedSamplesRef.current >= PLAYBACK_BUFFER_SAMPLES || (flushPartial && queuedSamplesRef.current > 0)) {
      const sampleCount = Math.min(PLAYBACK_BUFFER_SAMPLES, queuedSamplesRef.current);
      const audioData = new Float32Array(sampleCount);
      let writeOffset = 0;
      while (writeOffset < sampleCount) {
        const firstChunk = audioQueueRef.current[0];
        const copyLength = Math.min(firstChunk.length, sampleCount - writeOffset);
        audioData.set(firstChunk.subarray(0, copyLength), writeOffset);
        writeOffset += copyLength;
        queuedSamplesRef.current -= copyLength;
        if (copyLength === firstChunk.length) audioQueueRef.current.shift();
        else audioQueueRef.current[0] = firstChunk.subarray(copyLength);
      }

      const buffer = audioContext.createBuffer(1, audioData.length, 24000);
      buffer.copyToChannel(audioData, 0);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(outputAnalyser);
      const startAt = Math.max(audioContext.currentTime + 0.025, nextPlaybackTimeRef.current);
      nextPlaybackTimeRef.current = startAt + buffer.duration;
      activeSourcesRef.current.add(source);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (activeSourcesRef.current.size === 0 && queuedSamplesRef.current === 0) {
          isPlayingRef.current = false;
          setStatus('Listening');
        }
      };
      source.start(startAt);
    }

    if (queuedSamplesRef.current > 0 && !playbackFlushTimerRef.current) {
      playbackFlushTimerRef.current = setTimeout(() => {
        playbackFlushTimerRef.current = null;
        schedulePlayback(true);
      }, PLAYBACK_FLUSH_DELAY_MS);
    }
  };

  const stopCall = () => {
    manualStopRef.current = true;
    shouldReconnectRef.current = false;
    sessionReadyRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onclose = null;
      ws.close();
    }
    cleanupAudio();
    setIsConnected(false);
    setStatus('Disconnected');
  };

  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [transcript]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let frame = 0;
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
      const analyser = status === 'Speaking' ? outputAnalyserRef.current : microphoneAnalyserRef.current;
      if (analyser) {
        const values = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(values);
        const barCount = 48;
        const gap = 3 * pixelRatio;
        const barWidth = Math.max(1, (width - gap * (barCount - 1)) / barCount);
        const step = Math.max(1, Math.floor(values.length / barCount));
        for (let index = 0; index < barCount; index++) {
          const magnitude = values[index * step] / 255;
          const barHeight = Math.max(3 * pixelRatio, magnitude * height * 0.82);
          const x = index * (barWidth + gap);
          const y = (height - barHeight) / 2;
          context.fillStyle = status === 'Speaking' ? '#167d73' : '#3978a8';
          context.beginPath();
          context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
          context.fill();
        }
      } else {
        context.fillStyle = '#d7dfdc';
        context.fillRect(0, Math.floor(height / 2), width, Math.max(1, pixelRatio));
      }

      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frame);
  }, [status]);

  const isStarting = status === 'Connecting' || status === 'Reconnecting';
  const statusTone = status === 'Listening' ? 'bg-emerald-100 text-emerald-800'
    : status === 'Speaking' ? 'bg-sky-100 text-sky-800'
      : status === 'Thinking' ? 'bg-amber-100 text-amber-800'
        : isStarting ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-600';

  return (
    <section className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Aura Skincare</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Voice support</h1>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`} aria-live="polite">
          {status}
        </span>
      </header>

      <div className="mt-5 rounded-lg bg-slate-50 px-3 py-2" aria-label="Live audio visualizer">
        <canvas ref={canvasRef} className="h-20 w-full" />
      </div>

      {connectionError && <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{connectionError}</p>}

      <div className="mt-5 border-t border-slate-200 pt-4">
        <h2 className="text-sm font-semibold text-slate-800">Transcript</h2>
        <div ref={transcriptContainerRef} className="mt-2 max-h-64 min-h-24 space-y-3 overflow-y-auto pr-1" role="log" aria-live="polite" aria-relevant="additions text">
          {transcript.length === 0 ? (
            <p className="py-5 text-center text-sm text-slate-500">No transcript yet</p>
          ) : transcript.map((line) => (
            <p key={line.id} className="text-sm leading-6 text-slate-700">
              <span className={`mr-2 font-semibold ${line.speaker === 'You' ? 'text-sky-700' : 'text-emerald-700'}`}>{line.speaker}</span>
              {line.text}{line.partial && <span className="sr-only"> (in progress)</span>}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        {isConnected ? (
          <button onClick={stopCall} className="w-full rounded-md bg-rose-700 px-4 py-3 font-medium text-white transition hover:bg-rose-800">
            End call
          </button>
        ) : (
          <button
            onClick={startCall}
            disabled={isStarting}
            className="w-full rounded-md bg-emerald-700 px-4 py-3 font-medium text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
          >
            {status === 'Reconnecting' ? 'Reconnecting...' : status === 'Connecting' ? 'Connecting...' : 'Start voice call'}
          </button>
        )}
      </div>
    </section>
  );
}