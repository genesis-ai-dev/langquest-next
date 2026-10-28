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

# Clean up's model

`deepfilter.onnx` is DeepFilterNet3 (https://github.com/Rikorose/DeepFilterNet,
by Hendrik Schröter, under the MIT license in `LICENSE-deepfilternet`; the
project is also offered under Apache 2.0) as one ONNX graph, opset 17, from
https://huggingface.co/soniqo/DeepFilterNet3-ONNX (`deepfilter.onnx`, sha256
e1157049059434ae0d5857e32c812abea227b975e946b2eb64d001abbce156d3). It is the
network alone: Clean up's arithmetic around it (src/deepFilter.ts and its
line-for-line ports DeepFilter.kt and DeepFilter.swift, decision 177) makes
its features from 48 kHz sound and applies its answer, as DeepFilterNet's
libDF does. The Android module ships it as an asset, the iPhone module as a
resource, and the web export copies it to `/models/`.

Inputs, for `n` frames of 10 ms: `feat_erb` float32 [1, 1, n, 32] (each
frame's loudness in 32 ERB bands against its running mean, over 40) and
`feat_spec` float32 [1, 2, n, 96] (the real, then the imaginary parts of each
frame's first 96 bins over their running size). Outputs: `erb_mask` float32
[1, 1, n, 32] (a gain from 0 to 1 per band) and `df_coefs` float32
[1, 5, n, 96, 2] (a filter over 5 frames, 2 of them ahead, for the first 96
bins). It keeps no state between calls: a long part is run 10 s at a time,
each run starting 3 s early (deepFilter.ts modelRuns).
