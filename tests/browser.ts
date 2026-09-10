import type { LaunchOptions } from 'playwright';

// ANGLE (WebGL/compositor) and Dawn (WebGPU) select their adapters separately.
// On Linux, implicit WebGPU fallback with SwANGLE can create a device but fail
// when presenting the canvas SharedImage. Explicitly select Dawn's CPU path too.
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
    ],
  };
}
