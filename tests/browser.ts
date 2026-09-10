import type { LaunchOptions } from 'playwright';

// ANGLE (WebGL), Dawn (WebGPU), and Skia (compositor) select backends separately.
// Linux's GaneshGL + SwANGLE cannot back the WebGPU canvas SharedImage even if
// requestDevice succeeds. Graphite/Dawn supports that software presentation path.
// https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md
// https://dawn.googlesource.com/dawn/+/HEAD/webgpu-cts/README.md
// https://chromium.googlesource.com/chromium/src/+/HEAD/gpu/command_buffer/service/shared_image/wrapped_sk_image_backing_factory.cc
export function softwareGPUOptions(renderer: 'webgpu' | 'webgl' = 'webgpu'): LaunchOptions {
  return {
    executablePath: process.env.JASON_TEST_CHROMIUM || undefined,
    timeout: 20_000,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      // Only WebGPU canvas tests need Graphite's CPU texture copies. Ordinary
      // interaction/MapLibre tests retain the faster GL compositor and WebGL.
      ...(renderer === 'webgpu' ? [
        '--enable-unsafe-webgpu',
        '--use-webgpu-adapter=swiftshader',
        '--enable-skia-graphite',
        '--skia-graphite-dawn-backend=swiftshader',
      ] : []),
    ],
  };
}
