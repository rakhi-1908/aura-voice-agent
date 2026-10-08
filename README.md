# 🌿 Aura Skincare — AI Voice CX Agent (Aria)

A real-time, browser-based AI Voice Customer Support Agent built for **Aura Skincare** using Next.js (App Router), Tailwind CSS, WebAudio API (`AudioWorklet`), and a custom Node.js WebSocket proxy relay for the **Gemini 2.0 Live API** (`BidiGenerateContent`). Aria handles live order lookups, serviceability checks, promo code validations, answers brand policy questions, manages user interruptions with sub-second latency, and generates structured post-call summaries.

---

## ✨ Features & Architecture Highlights

* **Native Multimodal Speech-to-Speech**: Built on Gemini 2.0 Live API over WebSockets, bypassing traditional STT/TTS pipeline delays for sub-second responses.
* **Dynamic Canvas Audio Visualizer**: Real-time frequency spectrum display powered by Web Audio `AnalyserNode` with state-based color transitions.
* **Modern Glassmorphic UI**: Sleek dark-mode aesthetic with live connection latency indicators, status rings, and responsive controls.
* **Integrated Function Calling (Tools)**:
  * `get_order_details`: Real-time order status, tracking numbers, and delivery ETAs.
  * `check_serviceability`: Pincode serviceability, estimated delivery timeline, and Cash on Delivery (COD) eligibility.
  * `validate_discount`: Promo code verification and discount calculation in INR.
* **Dynamic Barge-In (Interruption Handling)**: Non-blocking client-side audio buffer flushing using `AudioWorklet` for instant audio cutoff when the user speaks.
* **Post-Call Structured Summary**: Automatic generation of chronological transcripts and JSON call summaries capturing intent, order IDs, and resolution status upon call end.
* **Secure Backend Relay**: Same-origin Node.js proxy server (`server.mjs`) deployed on Render ensuring API key isolation and environment port binding.

---

## 🛠️ Tech Stack

* **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS, HTML5 Canvas
* **Audio Engineering**: WebAudio API (`AudioContext`, `AudioWorklet`, `AnalyserNode`), 16kHz PCM audio streaming
* **Backend Proxy**: Node.js (`ws` library, HTTP server binding)
* **AI Engine**: Google Gemini 2.0 Live API (`BidiGenerateContent`)
* **Hosting & Deployment**: Render

---

## 🚀 Getting Started

### Prerequisites
* Node.js v18+
* Gemini API Key

### Local Setup

1. **Clone the repository**:
   ```bash
   git clone [https://github.com/rakhi-1908/aura-voice-agent.git](https://github.com/rakhi-1908/aura-voice-agent.git)
   cd aura-voice-agent