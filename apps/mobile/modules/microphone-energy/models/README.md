# Speech model

`silero_vad_16k_op15.onnx` is Silero VAD v6.2.3's 16 kHz model, opset 15
(https://github.com/snakers4/silero-vad, tag v6.2.3,
`src/silero_vad/data/silero_vad_16k_op15.onnx`, sha256
7ed98ddbad84ccac4cd0aeb3099049280713df825c610a8ed34543318f1b2c49), under the
MIT license in `LICENSE-silero-vad`. It scores how much each 32 ms of 16 kHz
sound is like speech (src/speech.ts, decision 135). The Android module ships
it as an asset, the iPhone module as a resource, and the web export copies it
to `/models/`.

Inputs: `input` float32 [1, 576] (the 64 samples before the chunk, then its
512), `state` float32 [2, 1, 128] (zeros to start, then the last `stateN`),
`sr` int64 scalar 16000. Outputs: `output` float32 [1, 1] (the score),
`stateN` float32 [2, 1, 128].
