# 🌿 Aura Skincare — AI Voice CX Agent (Aria)

A real-time, browser-based AI Voice Customer Support Agent built for **Aura Skincare** using Next.js, WebAudio API (`AudioWorklet`), and a custom Node.js WebSocket proxy relay for the **Gemini 2.0 Live API** (`BidiGenerateContent`). Aria handles live order lookups, answers brand policy questions, manages user interruptions with sub-second latency, and generates structured post-call summaries.

---

## Section 9: System Design & Reflection

### 1. Why did you choose your particular architecture and technology stack?
I selected Next.js (App Router), Tailwind CSS, and a custom Node.js WebSocket relay (`server.mjs`) integrating the Gemini 2.0 Live API (`BidiGenerateContent`). Gemini 2.0 Live offers native multimodal speech-to-speech capabilities, delivering sub-second latency without needing separate STT and TTS models. The custom Node.js server on Render acts as a secure same-origin WebSocket proxy, keeping the API key server-side while maintaining a persistent bi-directional audio pipeline using WebAudio `AudioWorklet`.

### 2. What was the most difficult part of the assignment, and how did you solve it?
Handling bi-directional audio streaming with low latency while managing barge-in (user interruption) and browser audio context constraints. I resolved this by building a custom `AudioWorklet` processor for non-blocking 16kHz PCM audio capturing and downsampling, alongside client-side buffer flushing whenever the user interrupts the agent during playback.

### 3. If you had one more week to work on this, what would you improve first and why?
I would implement server-side session persistence and state synchronization with a database (e.g., PostgreSQL/Supabase) so that call history, live metrics, and post-call analytics persist across user sessions and can be analyzed by brand managers.

### 4. Imagine this agent is handling 1,000 customer conversations a day. What do you think would need to change or improve?
1. **Infrastructure**: Migrate from a single Node.js process to auto-scaling container instances (e.g., AWS ECS, Fly.io, or Railway cluster) with horizontal WebSocket load balancing.
2. **Rate Limiting & Security**: Add IP rate limiting, token-based session auth, and strict origin validation to protect the backend.
3. **Observability**: Implement structured logging, fallback TTS/LLM routing if Gemini endpoints throttle, and real-time latency monitoring for audio dropouts.
