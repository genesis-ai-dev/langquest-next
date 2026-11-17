# 13. Two recorders, on purpose

Date: 2026-09-14 · By: Ryder Wishart · Status: partly superseded by 106

Reason: expo-audio allows one recording at a time and exposes no PCM. v2
solved this with a custom Expo module (`microphone-energy`) that taps raw
PCM for energy and voice-activity segmentation and writes one WAV per card,
while expo-audio writes hold-to-record takes. Both sessions are open during
manual recording. We reuse that module unchanged rather than re-solving the
cold-start and segmentation problems it already solved. Cost: no Expo Go;
a dev client build is required.
