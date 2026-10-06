class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 2048;
    this.chunk = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      let inputOffset = 0;
      while (inputOffset < input.length) {
        const length = Math.min(input.length - inputOffset, this.chunkSize - this.offset);
        this.chunk.set(input.subarray(inputOffset, inputOffset + length), this.offset);
        this.offset += length;
        inputOffset += length;

        if (this.offset === this.chunkSize) {
          const completedChunk = this.chunk;
          this.chunk = new Float32Array(this.chunkSize);
          this.offset = 0;
          this.port.postMessage(completedChunk, [completedChunk.buffer]);
        }
      }
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);