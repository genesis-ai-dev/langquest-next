// swift-tools-version:5.9
import PackageDescription

/**
 * The nearby module's pure parts (`Pure/`: bytes, Find's codec and matcher, frames and sealing,
 * streams, the part writer, tunables, codes, the link session and a hosted network) and their
 * XCTest cases, which read `../test-vectors.json` as the Kotlin's JUnit tests do. Only for tests:
 * the podspec leaves this file and `Tests/` out, and the app compiles `Pure/` with the radio files
 * beside it. Off Apple's systems there is no CryptoKit, so swift-crypto stands in, with the same
 * API; on a Mac nothing is fetched.
 *
 * On Linux, in Docker, from the repository's root (the build stays in a volume, off the repository):
 *   docker run --rm --memory=4g --user "$(id -u):$(id -g)" -e HOME=/build/home -v "$PWD":/repo -v nearby-swift-build:/build \
 *     -w /repo/apps/mobile/modules/nearby-link/ios swift:6.1.2-jammy swift test --scratch-path /build/scratch --cache-path /build/cache -j 2
 * (the volume's folders made once, owned by that user). On a Mac, `swift test` here.
 */
#if os(Linux)
let crypto: [Package.Dependency] = [.package(url: "https://github.com/apple/swift-crypto.git", exact: "3.15.1")]
let cryptoProducts: [Target.Dependency] = [.product(name: "Crypto", package: "swift-crypto")]
#else
let crypto: [Package.Dependency] = []
let cryptoProducts: [Target.Dependency] = []
#endif

let package = Package(
  name: "NearbyLink",
  platforms: [.iOS("15.1"), .macOS(.v12)],
  dependencies: crypto,
  targets: [
    .target(name: "NearbyLink", dependencies: cryptoProducts, path: "Pure"),
    .testTarget(name: "NearbyLinkTests", dependencies: ["NearbyLink"], path: "Tests/NearbyLinkTests"),
  ]
)
