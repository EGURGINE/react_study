import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/** HDR light bloom, with alpha preserved for the page behind the island. */
export function createBloom(renderer, scene, camera) {
  if (!renderer.extensions.has("EXT_color_buffer_float")) {
    return {
      resize() {},
      setStrength() {},
      render: () => renderer.render(scene, camera),
      dispose() {},
    };
  }
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  const composer = new EffectComposer(renderer, target);
  const render = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.12, 0.55, 1.3);
  const output = new OutputPass();
  // Tiny moving lamps can cross the old near-binary threshold between pixels.
  // Extract each sample BEFORE averaging the downsampled footprint, so a lamp
  // keeps its energy as it moves instead of switching the whole glow on/off.
  bloom.highPassUniforms.smoothWidth.value = 0.6;
  bloom.highPassUniforms.sampleOffset = { value: new THREE.Vector2() };
  bloom.materialHighPassFilter.fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform float luminosityThreshold;
    uniform float smoothWidth;
    uniform vec2 sampleOffset;
    varying vec2 vUv;

    vec4 extractLight(vec2 uv) {
      vec4 texel = texture2D(tDiffuse, uv);
      // Never let non-finite HDR values spread through the blur chain.
      if (!(texel.r >= 0.0)) texel.r = 0.0;
      if (!(texel.g >= 0.0)) texel.g = 0.0;
      if (!(texel.b >= 0.0)) texel.b = 0.0;
      texel.rgb = min(texel.rgb, vec3(32.0));
      float light = luminance(texel.rgb);
      float contribution = smoothstep(
        luminosityThreshold - smoothWidth,
        luminosityThreshold + smoothWidth,
        light
      );
      return vec4(texel.rgb * contribution, 0.0);
    }

    void main() {
      gl_FragColor = 0.25 * (
        extractLight(vUv + vec2(-sampleOffset.x, -sampleOffset.y)) +
        extractLight(vUv + vec2( sampleOffset.x, -sampleOffset.y)) +
        extractLight(vUv + vec2(-sampleOffset.x,  sampleOffset.y)) +
        extractLight(vUv + vec2( sampleOffset.x,  sampleOffset.y))
      );
    }
  `;
  output.material.fragmentShader = output.material.fragmentShader.replace(
    "gl_FragColor = texture2D( tDiffuse, vUv );",
    `gl_FragColor = texture2D( tDiffuse, vUv );
     if (!(gl_FragColor.r >= 0.0)) gl_FragColor.r = 0.0;
     if (!(gl_FragColor.g >= 0.0)) gl_FragColor.g = 0.0;
     if (!(gl_FragColor.b >= 0.0)) gl_FragColor.b = 0.0;
     gl_FragColor = min(gl_FragColor, vec4(32.0, 32.0, 32.0, 1.0));`,
  );

  // UnrealBloomPass normally adds opaque alpha over the entire screen. Give
  // only the glow an alpha contribution, leaving the empty sky transparent.
  bloom.blendMaterial.fragmentShader =
    bloom.blendMaterial.fragmentShader.replace(
      "gl_FragColor = opacity * texel;",
      `gl_FragColor = opacity * texel;
     gl_FragColor.a = clamp(max(max(texel.r, texel.g), texel.b) * 0.35, 0.0, 1.0);`,
    );
  bloom.blendMaterial.blending = THREE.CustomBlending;
  bloom.blendMaterial.blendSrc = THREE.OneFactor;
  bloom.blendMaterial.blendDst = THREE.OneFactor;
  bloom.blendMaterial.blendEquation = THREE.AddEquation;
  bloom.blendMaterial.blendSrcAlpha = THREE.OneFactor;
  bloom.blendMaterial.blendDstAlpha = THREE.OneFactor;
  bloom.blendMaterial.blendEquationAlpha = THREE.AddEquation;
  composer.addPass(render);
  composer.addPass(bloom);
  composer.addPass(output);
  return {
    resize(width, height) {
      composer.setSize(Math.max(1, width), Math.max(1, height));
      // Blur at a bounded resolution; geometry retains the full canvas size.
      const pixelRatio = renderer.getPixelRatio();
      const scale = Math.min(1, 1600 / Math.max(width, height) / pixelRatio);
      bloom.setSize(
        Math.max(32, Math.round(width * pixelRatio * scale)),
        Math.max(32, Math.round(height * pixelRatio * scale)),
      );
      bloom.highPassUniforms.sampleOffset.value.set(
        0.25 / bloom.renderTargetBright.width,
        0.25 / bloom.renderTargetBright.height,
      );
    },
    setStrength(value) {
      bloom.strength = value;
    },
    render: (dt) => composer.render(dt),
    dispose() {
      bloom.materialHighPassFilter.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
    },
  };
}
