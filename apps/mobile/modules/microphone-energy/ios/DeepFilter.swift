import Foundation

/**
 * Clean up's arithmetic (decision 177): a line-for-line port of
 * src/deepFilter.ts, which the web runs and the tests hold, as DeepFilter.kt
 * is. Keep the three in step. Everything around DeepFilterNet3 but the
 * network: the part at 48 kHz, its frames and the model's features, the
 * model a stretch at a time, and the frames put back, a run at a time so a
 * long part takes no more memory than a short one. The FFT works in buffers
 * of its own, as a part is thousands of frames.
 */
enum DeepFilter {
    static let rate = 48000
    static let tool = "deepfilternet3"
    static let n = 960
    static let hop = 480
    static let bins = 481
    static let erbBands = 32
    static let dfBins = 96
    static let order = 5
    static let lookahead = 2
    static let alpha = 0.99

    // ---- FFT ----

    /** A complex FFT of any length made of 2, 3, 4 and 5 (Stockham, self-sorting). Forward, unnormalised. */
    final class ComplexFft {
        let n: Int
        private struct Stage { let r: Int; let m: Int; let s: Int; let wr: [Double]; let wi: [Double] }
        private let stages: [Stage]
        private let ar: UnsafeMutablePointer<Double>
        private let ai: UnsafeMutablePointer<Double>
        private let br: UnsafeMutablePointer<Double>
        private let bi: UnsafeMutablePointer<Double>

        init(_ n: Int) {
            self.n = n
            var left = n
            var radices: [Int] = []
            for r in [4, 2, 3, 5] { while left % r == 0 { radices.append(r); left /= r } }
            precondition(left == 1 && n >= 1, "FFT length \(n) is not made of 2, 3 and 5")
            var built: [Stage] = []
            var len = n, s = 1
            for r in radices {
                let m = len / r
                var wr = [Double](repeating: 0, count: m * (r - 1)), wi = wr
                for p in 0..<m {
                    for k in 1..<r {
                        let a = -2 * Double.pi * Double(p * k) / Double(len)
                        wr[p * (r - 1) + k - 1] = cos(a)
                        wi[p * (r - 1) + k - 1] = sin(a)
                    }
                }
                built.append(Stage(r: r, m: m, s: s, wr: wr, wi: wi))
                len = m
                s *= r
            }
            stages = built
            ar = .allocate(capacity: n); ai = .allocate(capacity: n)
            br = .allocate(capacity: n); bi = .allocate(capacity: n)
        }

        deinit { ar.deallocate(); ai.deallocate(); br.deallocate(); bi.deallocate() }

        func forward(_ re: UnsafeMutablePointer<Double>, _ im: UnsafeMutablePointer<Double>) {
            var xr = ar, xi = ai, yr = br, yi = bi
            xr.update(from: re, count: n); xi.update(from: im, count: n)
            for st in stages {
                let r = st.r, m = st.m, s = st.s
                let step = s * m
                st.wr.withUnsafeBufferPointer { wr in
                    st.wi.withUnsafeBufferPointer { wi in
                        switch r {
                        case 4:
                            for p in 0..<m {
                                let w = p * 3
                                let w1r = wr[w], w1i = wi[w], w2r = wr[w + 1], w2i = wi[w + 1], w3r = wr[w + 2], w3i = wi[w + 2]
                                for q in 0..<s {
                                    let at = q + s * p, out = q + 4 * s * p
                                    let a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step]
                                    let a2r = xr[at + 2 * step], a2i = xi[at + 2 * step], a3r = xr[at + 3 * step], a3i = xi[at + 3 * step]
                                    let t0r = a0r + a2r, t0i = a0i + a2i, t1r = a0r - a2r, t1i = a0i - a2i
                                    let t2r = a1r + a3r, t2i = a1i + a3i, t3r = a1r - a3r, t3i = a1i - a3i
                                    let v1r = t1r + t3i, v1i = t1i - t3r, v2r = t0r - t2r, v2i = t0i - t2i, v3r = t1r - t3i, v3i = t1i + t3r
                                    yr[out] = t0r + t2r; yi[out] = t0i + t2i
                                    yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r
                                    yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r
                                    yr[out + 3 * s] = v3r * w3r - v3i * w3i; yi[out + 3 * s] = v3r * w3i + v3i * w3r
                                }
                            }
                        case 2:
                            for p in 0..<m {
                                let w1r = wr[p], w1i = wi[p]
                                for q in 0..<s {
                                    let at = q + s * p, out = q + 2 * s * p
                                    let a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step]
                                    let vr = a0r - a1r, vi = a0i - a1i
                                    yr[out] = a0r + a1r; yi[out] = a0i + a1i
                                    yr[out + s] = vr * w1r - vi * w1i; yi[out + s] = vr * w1i + vi * w1r
                                }
                            }
                        case 3:
                            for p in 0..<m {
                                let w = p * 2
                                let w1r = wr[w], w1i = wi[w], w2r = wr[w + 1], w2i = wi[w + 1]
                                for q in 0..<s {
                                    let at = q + s * p, out = q + 3 * s * p
                                    let a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step], a2r = xr[at + 2 * step], a2i = xi[at + 2 * step]
                                    let tr = a1r + a2r, ti = a1i + a2i, dr = (a1r - a2r) * DeepFilter.s3, di = (a1i - a2i) * DeepFilter.s3
                                    let mr = a0r - 0.5 * tr, mi = a0i - 0.5 * ti
                                    let v1r = mr + di, v1i = mi - dr, v2r = mr - di, v2i = mi + dr
                                    yr[out] = a0r + tr; yi[out] = a0i + ti
                                    yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r
                                    yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r
                                }
                            }
                        default:
                            let c51 = DeepFilter.c51, c52 = DeepFilter.c52, s51 = DeepFilter.s51, s52 = DeepFilter.s52
                            for p in 0..<m {
                                let w = p * 4
                                let w1r = wr[w], w1i = wi[w], w2r = wr[w + 1], w2i = wi[w + 1]
                                let w3r = wr[w + 2], w3i = wi[w + 2], w4r = wr[w + 3], w4i = wi[w + 3]
                                for q in 0..<s {
                                    let at = q + s * p, out = q + 5 * s * p
                                    let a0r = xr[at], a0i = xi[at], a1r = xr[at + step], a1i = xi[at + step], a2r = xr[at + 2 * step], a2i = xi[at + 2 * step]
                                    let a3r = xr[at + 3 * step], a3i = xi[at + 3 * step], a4r = xr[at + 4 * step], a4i = xi[at + 4 * step]
                                    let b1r = a1r + a4r, b1i = a1i + a4i, b2r = a2r + a3r, b2i = a2i + a3i
                                    let d1r = a1r - a4r, d1i = a1i - a4i, d2r = a2r - a3r, d2i = a2i - a3i
                                    let r1r = a0r + c51 * b1r + c52 * b2r, r1i = a0i + c51 * b1i + c52 * b2i
                                    let r2r = a0r + c52 * b1r + c51 * b2r, r2i = a0i + c52 * b1i + c51 * b2i
                                    let i1r = s51 * d1r + s52 * d2r, i1i = s51 * d1i + s52 * d2i
                                    let i2r = s52 * d1r - s51 * d2r, i2i = s52 * d1i - s51 * d2i
                                    let v1r = r1r + i1i, v1i = r1i - i1r, v2r = r2r + i2i, v2i = r2i - i2r
                                    let v3r = r2r - i2i, v3i = r2i + i2r, v4r = r1r - i1i, v4i = r1i + i1r
                                    yr[out] = a0r + b1r + b2r; yi[out] = a0i + b1i + b2i
                                    yr[out + s] = v1r * w1r - v1i * w1i; yi[out + s] = v1r * w1i + v1i * w1r
                                    yr[out + 2 * s] = v2r * w2r - v2i * w2i; yi[out + 2 * s] = v2r * w2i + v2i * w2r
                                    yr[out + 3 * s] = v3r * w3r - v3i * w3i; yi[out + 3 * s] = v3r * w3i + v3i * w3r
                                    yr[out + 4 * s] = v4r * w4r - v4i * w4i; yi[out + 4 * s] = v4r * w4i + v4i * w4r
                                }
                            }
                        }
                    }
                }
                swap(&xr, &yr); swap(&xi, &yi)
            }
            re.update(from: xr, count: n); im.update(from: xi, count: n)
        }
    }

    static let s3 = 3.0.squareRoot() / 2
    static let c51 = cos(2 * Double.pi / 5), c52 = cos(4 * Double.pi / 5)
    static let s51 = sin(2 * Double.pi / 5), s52 = sin(4 * Double.pi / 5)

    /** A real FFT of an even length through a complex one of half its length; `inverse` is unnormalised (n times the frame). */
    final class RealFft {
        let n: Int
        private let h: Int
        private let half: ComplexFft
        private let wr: [Double]
        private let wi: [Double]
        private let zr: UnsafeMutablePointer<Double>
        private let zi: UnsafeMutablePointer<Double>

        init(_ n: Int) {
            precondition(n % 2 == 0, "A real FFT needs an even length")
            self.n = n
            h = n / 2
            half = ComplexFft(n / 2)
            wr = (0...(n / 2)).map { cos(2 * Double.pi * Double($0) / Double(n)) }
            wi = (0...(n / 2)).map { -sin(2 * Double.pi * Double($0) / Double(n)) }
            zr = .allocate(capacity: n / 2); zi = .allocate(capacity: n / 2)
        }

        deinit { zr.deallocate(); zi.deallocate() }

        func forward(_ x: UnsafePointer<Double>, _ re: UnsafeMutablePointer<Double>, _ im: UnsafeMutablePointer<Double>) {
            for j in 0..<h { zr[j] = x[2 * j]; zi[j] = x[2 * j + 1] }
            half.forward(zr, zi)
            for k in 0...h {
                let a = k % h, b = (h - k) % h
                let er = 0.5 * (zr[a] + zr[b]), ei = 0.5 * (zi[a] - zi[b])
                let or = 0.5 * (zi[a] + zi[b]), oi = -0.5 * (zr[a] - zr[b])
                re[k] = er + wr[k] * or - wi[k] * oi
                im[k] = ei + wr[k] * oi + wi[k] * or
            }
        }

        func inverse(_ re: UnsafePointer<Double>, _ im: UnsafePointer<Double>, _ out: UnsafeMutablePointer<Double>) {
            for k in 0..<h {
                let b = h - k
                let ik = k == 0 ? 0 : im[k], ib = k == 0 ? 0 : im[b]
                let er = 0.5 * (re[k] + re[b]), ei = 0.5 * (ik - ib)
                let dr = 0.5 * (re[k] - re[b]), di = 0.5 * (ik + ib)
                let cr = wr[k], ci = -wi[k]
                let or = dr * cr - di * ci, oi = dr * ci + di * cr
                zr[k] = er - oi
                zi[k] = -(ei + or)
            }
            half.forward(zr, zi)
            for j in 0..<h { out[2 * j] = 2 * zr[j]; out[2 * j + 1] = -2 * zi[j] }
        }
    }

    // ---- resampling ----

    private static let zeros = 16
    private static let kaiserBeta = 8.6

    fileprivate static func besselI0(_ x: Double) -> Double {
        var s = 1.0, t = 1.0
        for k in 1..<30 { t *= pow(x / Double(2 * k), 2); s += t }
        return s
    }
    private static func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? a : gcd(b, a % b) }

    /**
     * A part at rate `from` brought to rate `to` as it is read, a piece at a time, with a Kaiser-windowed sinc.
     * It holds only the inputs its next outputs need (deepFilter.ts Resampler).
     */
    final class Resampler {
        let from: Int
        let to: Int
        private let up: Int
        private let down: Int
        private let span: Int
        private let taps: Int
        private let cutoff: Double
        private let i0: Double
        private let table: [Double]?
        private var buf: [Float] = []
        private var base = 0
        private var have = 0
        private var next = 0

        init(from: Int, to: Int) {
            let g = DeepFilter.gcd(from, to), up = to / g, down = from / g
            let scale = min(1, Double(to) / Double(from)), cutoff = 0.97 * scale
            let span = Int(ceil(Double(DeepFilter.zeros) / scale)), taps = 2 * span, i0 = DeepFilter.besselI0(DeepFilter.kaiserBeta)
            var table: [Double]? = nil
            if up <= 4096 {
                var t = [Double](repeating: 0, count: up * taps)
                for f in 0..<up {
                    var sum = 0.0
                    for j in 0..<taps { let v = Resampler.h(Double(f) / Double(up) - Double(j - span + 1), span: span, cutoff: cutoff, i0: i0); t[f * taps + j] = v; sum += v }
                    for j in 0..<taps { t[f * taps + j] /= sum }
                }
                table = t
            }
            self.from = from; self.to = to; self.up = up; self.down = down
            self.span = span; self.taps = taps; self.cutoff = cutoff; self.i0 = i0; self.table = table
        }

        private static func h(_ d: Double, span: Int, cutoff: Double, i0: Double) -> Double {
            let u = abs(d) / Double(span)
            if u >= 1 { return 0 }
            let w = DeepFilter.besselI0(DeepFilter.kaiserBeta * (1 - u * u).squareRoot()) / i0
            let a = Double.pi * d * cutoff
            return (a == 0 ? 1 : sin(a) / a) * w
        }

        private func centre(_ i: Int) -> Int { table != nil ? i * down / up : Int((Double(i) * Double(from) / Double(to)).rounded(.down)) }

        /** More of the part; the outputs it completes. */
        func push(_ x: [Float]) -> [Float] {
            if from == to { have += x.count; return x }
            let keepFrom = max(base, min(have, centre(next) - span + 1))
            buf = Array(buf[(keepFrom - base)..<(have - base)]) + x
            base = keepFrom; have += x.count
            var last = next
            while centre(last) + span < have { last += 1 }
            return outputs(last)
        }

        /** The part has ended: the outputs left, up to its length at the new rate. */
        func end() -> [Float] { from == to ? [] : outputs(have * up / down) }

        private func outputs(_ until: Int) -> [Float] {
            var out = [Float](repeating: 0, count: max(0, until - next))
            let base = self.base, have = self.have, span = self.span, taps = self.taps, start = next
            buf.withUnsafeBufferPointer { b in
                if let table {
                    table.withUnsafeBufferPointer { tb in
                        for i in start..<max(start, until) {
                            let at = i * down, c = at / up, f = at - c * up, first = c - span + 1, row = f * taps
                            var acc = 0.0
                            if first >= 0 && first + taps <= have {
                                let o = first - base
                                for j in 0..<taps { acc += Double(b[o + j]) * tb[row + j] }
                            } else {
                                for j in 0..<taps { let k = first + j; if k >= 0 && k < have { acc += Double(b[k - base]) * tb[row + j] } }
                            }
                            out[i - start] = Float(acc)
                        }
                    }
                } else {
                    for i in start..<max(start, until) {
                        let t = Double(i) * Double(from) / Double(to), c = Int(t.rounded(.down))
                        var acc = 0.0, sum = 0.0
                        let lo = max(0, c - span + 1), hi = min(have - 1, c + span)
                        if lo <= hi { for k in lo...hi { let v = Resampler.h(t - Double(k), span: span, cutoff: cutoff, i0: i0); acc += Double(b[k - base]) * v; sum += v } }
                        out[i - start] = sum == 0 ? 0 : Float(acc / sum)
                    }
                }
            }
            next = max(next, until)
            return out
        }
    }

    /** A whole part at rate `from` brought to rate `to`. */
    static func resample(_ x: [Float], from: Int, to: Int) -> [Float] {
        let r = Resampler(from: from, to: to)
        return r.push(x) + r.end()
    }

    // ---- frames and features ----

    /** How many bins each ERB band holds, lowest first (libDF erb_fb with min_nb_freqs 2): they add up to 481. */
    static let erbWidths: [Int] = {
        func toErb(_ f: Double) -> Double { 9.265 * log1p(f / (24.7 * 9.265)) }
        func fromErb(_ e: Double) -> Double { 24.7 * 9.265 * (exp(e / 9.265) - 1) }
        let lo = toErb(0), hi = toErb(Double(rate) / 2), step = (hi - lo) / Double(erbBands), binHz = Double(rate) / Double(n)
        var widths: [Int] = []
        var prev = 0, over = 0
        for i in 1...erbBands {
            // libDF rounds an f32: Math.fround in the TypeScript, halves up as Math.round does.
            let bin = Int((Double(Float(fromErb(lo + Double(i) * step) / binHz)) + 0.5).rounded(.down))
            var w = bin - prev - over
            if w < 2 { over = 2 - w; w = 2 } else { over = 0 }
            widths.append(w)
            prev = bin
        }
        widths[erbBands - 1] += 1
        let extra = widths.reduce(0, +) - bins
        if extra > 0 { widths[erbBands - 1] -= extra }
        return widths
    }()
    private static let edges: [Int] = erbWidths.reduce(into: [0]) { $0.append($0[$0.count - 1] + $1) }
    private static let window: [Double] = (0..<n).map { i in
        let s = sin(0.5 * Double.pi * (Double(i) + 0.5) / Double(n / 2))
        return sin(0.5 * Double.pi * s * s)
    }
    private static let wnorm = 1 / (Double(n * n) / Double(2 * hop))

    // ---- the model, a stretch at a time ----

    static let runFrames = 1000, runSettle = 300, runCross = 100

    struct ModelRun { let from: Int; let to: Int; let keep: Int; let cross: Int }

    static func modelRuns(_ frames: Int) -> [ModelRun] {
        var out: [ModelRun] = []
        var s = 0
        while s < frames {
            let e = min(frames, s + runFrames)
            out.append(ModelRun(from: max(0, s - runSettle), to: e < frames ? min(frames, e + runCross) : frames, keep: s, cross: s > 0 ? runCross : 0))
            s = e
        }
        return out
    }

    /** What the model says for `n` frames: a gain per band, [1, 1, n, 32], and the filter, [1, 5, n, 96, 2]. */
    struct ModelAnswer { var mask: [Float]; var coefs: [Float] }

    // ---- the whole part ----

    /** How many frames cover a part of `length` samples with the half frame it lags by. */
    static func frameCount(_ length: Int) -> Int { (length + n) / hop }

    /**
     * A part at 48 kHz cleaned at full strength, read and written a run at a time (deepFilter.ts deepFilter).
     * `read` fills `into` with the part's samples from `at` on (zeros past its end); `net` runs the network on
     * one run's features; `write` takes the cleaned sound in order, `length` samples in all.
     */
    static func clean(
        length: Int,
        read: (_ at: Int, _ into: inout [Float]) throws -> Void,
        net: (_ erb: [Float], _ spec: [Float], _ frames: Int) throws -> ModelAnswer,
        write: (_ y: ArraySlice<Float>) throws -> Void,
        progress: (Double) -> Void
    ) throws {
        let N = n, H = hop, F = bins, NE = erbBands, NDF = dfBins
        let frames = frameCount(length)
        let runs = modelRuns(frames)
        let held = min(frames, runFrames + runSettle + runCross)
        var re = [Float](repeating: 0, count: held * F), im = re
        var erb = [Float](repeating: 0, count: held * NE), specRe = [Float](repeating: 0, count: held * NDF), specIm = specRe
        var lo = 0, analysed = 0
        let fft = RealFft(N)
        let buf = UnsafeMutablePointer<Double>.allocate(capacity: N), xr = UnsafeMutablePointer<Double>.allocate(capacity: F), xi = UnsafeMutablePointer<Double>.allocate(capacity: F)
        let er = UnsafeMutablePointer<Double>.allocate(capacity: F), ei = UnsafeMutablePointer<Double>.allocate(capacity: F), frame = UnsafeMutablePointer<Double>.allocate(capacity: N)
        defer { buf.deallocate(); xr.deallocate(); xi.deallocate(); er.deallocate(); ei.deallocate(); frame.deallocate() }
        var mem = [Double](repeating: 0, count: N - H), out = mem
        var meanErb = (0..<NE).map { -60.0 + Double($0) * -30.0 / Double(NE - 1) }
        var unit = (0..<NDF).map { 0.001 + Double($0) * (0.0001 - 0.001) / Double(NDF - 1) }
        var mask = [Float](repeating: 0, count: NE), coefs = [Float](repeating: 0, count: order * NDF * 2)
        var tailMask = [Float](repeating: 0, count: runCross * NE), tailCoefs = [Float](repeating: 0, count: order * runCross * NDF * 2)
        var tailFrom = 0
        var skip = N - H, left = length
        let win = window, widths = erbWidths, edge = edges, wn = wnorm, al = alpha

        for (r, run) in runs.enumerated() {
            let shift = run.from - lo
            if shift > 0 {
                let kept = analysed - run.from
                re.replaceSubrange(0..<(kept * F), with: re[(shift * F)..<((shift + kept) * F)])
                im.replaceSubrange(0..<(kept * F), with: im[(shift * F)..<((shift + kept) * F)])
                erb.replaceSubrange(0..<(kept * NE), with: erb[(shift * NE)..<((shift + kept) * NE)])
                specRe.replaceSubrange(0..<(kept * NDF), with: specRe[(shift * NDF)..<((shift + kept) * NDF)])
                specIm.replaceSubrange(0..<(kept * NDF), with: specIm[(shift * NDF)..<((shift + kept) * NDF)])
                lo = run.from
            }
            var x = [Float](repeating: 0, count: (run.to - analysed) * H)
            try read(analysed * H, &x)
            for t in analysed..<run.to {
                for i in 0..<(N - H) { buf[i] = mem[i] * win[i] }
                let at = (t - analysed) * H
                for i in 0..<H {
                    let v = Double(x[at + i])
                    buf[N - H + i] = v * win[N - H + i]
                    mem[i] = v
                }
                fft.forward(buf, xr, xi)
                let row = (t - lo) * F
                for k in 0..<F { re[row + k] = Float(xr[k] * wn); im[row + k] = Float(xi[k] * wn) }
                for b in 0..<NE {
                    var e = 0.0
                    for k in edge[b]..<edge[b + 1] { let a = Double(re[row + k]), c = Double(im[row + k]); e += a * a + c * c }
                    let db = 10 * log10(e / Double(widths[b]) + 1e-10)
                    meanErb[b] = db * (1 - al) + meanErb[b] * al
                    erb[(t - lo) * NE + b] = Float((db - meanErb[b]) / 40)
                }
                for k in 0..<NDF {
                    let a = Double(re[row + k]), c = Double(im[row + k])
                    unit[k] = hypot(a, c) * (1 - al) + unit[k] * al
                    let d = unit[k].squareRoot()
                    specRe[(t - lo) * NDF + k] = Float(a / d)
                    specIm[(t - lo) * NDF + k] = Float(c / d)
                }
            }
            analysed = run.to

            let nf = run.to - run.from
            let answer = try net(Array(erb[0..<(nf * NE)]), Array(specRe[0..<(nf * NDF)]) + Array(specIm[0..<(nf * NDF)]), nf)

            let end = min(frames, run.keep + runFrames)
            var y = [Float](repeating: 0, count: (end - run.keep) * H)
            for t in run.keep..<end {
                let u = t - run.from
                let w = t < run.keep + run.cross ? (Double(t - run.keep) + 0.5) / Double(run.cross) : 1
                let v = t - tailFrom
                for b in 0..<NE { mask[b] = w == 1 ? answer.mask[u * NE + b] : Float((1 - w) * Double(tailMask[v * NE + b]) + w * Double(answer.mask[u * NE + b])) }
                for o in 0..<order {
                    let into = o * NDF * 2, from = ((o * nf + u) * NDF) * 2, tail = ((o * runCross + v) * NDF) * 2
                    for k in 0..<(NDF * 2) { coefs[into + k] = w == 1 ? answer.coefs[from + k] : Float((1 - w) * Double(tailCoefs[tail + k]) + w * Double(answer.coefs[from + k])) }
                }
                let row = (t - lo) * F
                for b in 0..<NE {
                    let g = Double(mask[b])
                    for k in edge[b]..<edge[b + 1] { er[k] = Double(re[row + k]) * g; ei[k] = Double(im[row + k]) * g }
                }
                for k in 0..<NDF {
                    var sr = 0.0, si = 0.0
                    for o in 0..<order {
                        let tt = t - (order - 1 - lookahead) + o
                        if tt < 0 || tt >= frames { continue }
                        let c = (o * NDF + k) * 2
                        let cr = Double(coefs[c]), ci = Double(coefs[c + 1])
                        let a = Double(re[(tt - lo) * F + k]), b = Double(im[(tt - lo) * F + k])
                        sr += a * cr - b * ci
                        si += a * ci + b * cr
                    }
                    er[k] = sr; ei[k] = si
                }
                fft.inverse(er, ei, frame)
                let at = (t - run.keep) * H
                for i in 0..<H { y[at + i] = Float(frame[i] * win[i] + out[i]) }
                for i in 0..<(N - H) { out[i] = frame[H + i] * win[H + i] }
            }
            let from = min(skip, y.count), count = min(left, y.count - from)
            skip -= from
            if count > 0 { try write(y[from..<(from + count)]); left -= count }

            tailFrom = end
            for v in 0..<(run.to - end) {
                let u = end + v - run.from
                tailMask.replaceSubrange((v * NE)..<((v + 1) * NE), with: answer.mask[(u * NE)..<((u + 1) * NE)])
                for o in 0..<order {
                    let src = ((o * nf + u) * NDF) * 2, dst = ((o * runCross + v) * NDF) * 2
                    tailCoefs.replaceSubrange(dst..<(dst + NDF * 2), with: answer.coefs[src..<(src + NDF * 2)])
                }
            }
            progress(Double(r + 1) / Double(runs.count))
        }
    }

    static func mixGain(_ limitDb: Double?) -> Double { limitDb.map { pow(10, -abs($0) / 20) } ?? 0 }

    static func mix(_ x: ArraySlice<Float>, _ y: ArraySlice<Float>, gain: Double) -> [Float] {
        zip(x, y).map { Float(gain * Double($0) + (1 - gain) * Double($1)) }
    }

    /** Per slice of even slices: how many samples, and the sums of x*x, x*y and y*y (deepFilter.ts SliceSums). */
    struct SliceSums {
        var n: [Double], xx: [Double], xy: [Double], yy: [Double]

        init(count: Int) { n = [Double](repeating: 0, count: count); xx = n; xy = n; yy = n }

        /** Adds a stretch of both sounds, from sample `at` of a part `total` samples long. */
        mutating func add(_ x: ArraySlice<Float>, _ y: ArraySlice<Float>, at: Int, total: Int) {
            let count = n.count, per = max(1, Double(total) / Double(count))
            for (i, (p, q)) in zip(x, y).enumerated() {
                let k = min(count - 1, Int((Double(at + i) / per).rounded(.down))), a = Double(p), b = Double(q)
                n[k] += 1; xx[k] += a * a; xy[k] += a * b; yy[k] += b * b
            }
        }
    }

    /** Samples from -1 to 1 as 16-bit PCM, as the recorder writes them (halves up, as JavaScript's Math.round). */
    static func pcm16<S: Sequence>(_ x: S) -> [Int16] where S.Element == Float {
        x.map { Int16((max(-1, min(1, Double($0))) * 32767 + 0.5).rounded(.down)) }
    }
}
