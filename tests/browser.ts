import type { LaunchOptions } from 'playwright';

// ANGLE (WebGL), Dawn (WebGPU), and Skia (compositor) select backends separately.
// Linux's GaneshGL + SwANGLE cannot back the WebGPU canvas SharedImage even if
// requestDevice succeeds. Graphite/Dawn supports that software presentation path.
// https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md
// https://dawn.googlesource.com/dawn/+/HEAD/webgpu-cts/README.md
export function softwareGPUOptions(): LaunchOptions {
  return {
    executablePath: process.env.JASON_TEST_CHROMIUM || undefined,
    timeout: 20_000,
    args: [
      '--enable-unsafe-swiftshader',
      '--enable-unsafe-webgpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--use-webgpu-adapter=swiftshader',
      '--enable-skia-graphite',
      '--skia-graphite-dawn-backend=swiftshader',
    ],
  };
}
