import { preferredRecordingType, storedFormatOf, toMono16 } from '../src/audioFormat';

// Every device plays what any other recorded (decisions.md 58): the stored label matches the bytes.

describe('recording formats', () => {
  it('a browser asks for MP4 when it can, and lets the browser choose otherwise', () => {
    expect(preferredRecordingType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(preferredRecordingType((t) => t.startsWith('audio/mp4;'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(preferredRecordingType(() => false)).toBeUndefined();
  });

  it('keeps MP4 and WAV as they are, and sends everything else to be converted', () => {
    expect(storedFormatOf('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(storedFormatOf('audio/MP4')).toBe('m4a');
    expect(storedFormatOf('audio/wav')).toBe('wav');
    expect(storedFormatOf('audio/webm;codecs=opus')).toBeNull();
    expect(storedFormatOf('audio/ogg')).toBeNull();
    expect(storedFormatOf('')).toBeNull();
  });

  it('mixes channels to one and clips to 16 bits', () => {
    expect([...toMono16([Float32Array.from([1, -1, 0.5]), Float32Array.from([1, -1, -0.5])])]).toEqual([32767, -32768, 0]);
    expect([...toMono16([Float32Array.from([2, -2])])]).toEqual([32767, -32768]);
  });
});
