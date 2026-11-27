import * as THREE from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { createMmdTslSelfShadowPass } from "../../../src/webgpu/self-shadow-pass.js";
import { MMD_SELF_SHADOW_LAYER } from "../../../src/three/shadow.js";

describe("MMD reference shadow target", () => {
  it("compiles and renders the dedicated pass with the renderer's state restored after each call", async () => {
    const renderer = new THREE.WebGPURenderer({ canvas: { width: 1, height: 1, style: {} } as HTMLCanvasElement });
    renderer.shadowMap.enabled = true;
    const light = new THREE.DirectionalLight();
    const scene = new THREE.Scene();
    const pass = createMmdTslSelfShadowPass(renderer, light);
    const originalLayers = light.shadow.camera.layers.mask;
    const checkPassState = () => {
      expect(renderer.getRenderTarget()).toBe(pass.renderTarget);
      expect(light.shadow.camera.layers.mask).toBe(1 << MMD_SELF_SHADOW_LAYER);
      expect(scene.overrideMaterial).toBeInstanceOf(THREE.NodeMaterial);
      expect(renderer.shadowMap.enabled).toBe(false);
      expect(renderer.getRenderObjectFunction()).toBeTypeOf("function");
    };
    const checkRestoredState = () => {
      expect(renderer.getRenderTarget()).toBe(null);
      expect(light.shadow.camera.layers.mask).toBe(originalLayers);
      expect(scene.overrideMaterial).toBe(null);
      expect(renderer.shadowMap.enabled).toBe(true);
      expect(renderer.getRenderObjectFunction()).toBe(null);
    };
    const compile = vi.spyOn(renderer, "compileAsync").mockImplementation(async () => { checkPassState(); });
    const render = vi.spyOn(renderer, "render").mockImplementation(checkPassState);

    expect(pass.render(renderer, scene, light)).toBe(false);
    expect(render).not.toHaveBeenCalled();
    light.castShadow = true;
    expect(await pass.compileAsync(renderer, scene, light)).toBe(true);
    expect(compile).toHaveBeenCalledWith(scene, light.shadow.camera);
    checkRestoredState();
    expect(pass.render(renderer, scene, light)).toBe(true);
    expect(render).toHaveBeenCalledWith(scene, light.shadow.camera);
    checkRestoredState();
    pass.dispose();
    expect(pass.render(renderer, scene, light)).toBe(false);
    expect(light.userData.mmdShadowProjection).toBeUndefined();
  });

  it("keeps reference depth separate from raster depth and switches mode without rebuilding", () => {
    const light = new THREE.DirectionalLight();
    light.shadow.mapSize.set(2048,2048);
    const renderer = { reversedDepthBuffer: true, shadowMap: { type: THREE.BasicShadowMap } } as THREE.WebGPURenderer;
    const pass = createMmdTslSelfShadowPass(renderer,light);
    expect(pass.renderTarget.texture.type).toBe(THREE.FloatType);
    expect(pass.renderTarget.texture.format).toBe(THREE.RedFormat);
    expect(pass.renderTarget.texture).not.toBe(pass.depthTexture);
    const node = pass.visibilityNode;
    expect(pass.setMode(2)).toBe(true);
    expect(pass.setMode(2)).toBe(false);
    expect(pass.setMode(1)).toBe(true);
    expect(pass.visibilityNode).toBe(node);
    const dispose = vi.spyOn(pass.renderTarget,"dispose");
    pass.dispose(); pass.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the projection when a disposal listener throws", () => {
    const light = new THREE.DirectionalLight();
    const originalUpdate = light.shadow.updateMatrices;
    const renderer = { shadowMap: { type: THREE.BasicShadowMap } } as THREE.WebGPURenderer;
    const pass = createMmdTslSelfShadowPass(renderer, light);
    pass.renderTarget.addEventListener("dispose", () => { throw new Error("listener failed"); });

    expect(() => pass.dispose()).toThrow("listener failed");
    expect(light.shadow.updateMatrices).toBe(originalUpdate);
    expect(() => pass.dispose()).not.toThrow();
  });
});
