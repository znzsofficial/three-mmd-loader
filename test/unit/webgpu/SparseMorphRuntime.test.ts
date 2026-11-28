import { describe, expect, it, vi } from "vitest";
import * as THREE from "three/webgpu";

import { createThreeBufferGeometry } from "../../../src/three/geometry.js";
import {
  computeMmdTslSparsePositionMorphs,
  disposeMmdTslSparsePositionMorphs,
  enableMmdTslSparsePositionMorphs,
  invalidateMmdTslSparseMorphOutputs
} from "../../../src/webgpu/sparse-morph-runtime.js";

describe("sparse position morph runtime", () => {
  it("replaces dense position morph attributes with compute storage output", () => {
    const mesh = createMesh();
    const densePositionMorphs = mesh.geometry.morphAttributes.position;

    expect(densePositionMorphs).toHaveLength(3);
    expect(enableMmdTslSparsePositionMorphs(mesh)).toBe(true);
    expect(enableMmdTslSparsePositionMorphs(mesh)).toBe(true);
    expect(mesh.geometry.morphAttributes.position).toEqual([]);
    expect(mesh.geometry.getAttribute("position")).toMatchObject({
      isStorageBufferAttribute: true,
      count: 3,
      itemSize: 3
    });
    expect(mesh.geometry.getAttribute("uv")).toHaveProperty("isStorageBufferAttribute", true);
    expect(mesh.geometry.getAttribute("uv1")).toHaveProperty("isStorageBufferAttribute", true);
    expect(mesh.geometry.morphAttributes.uv).toEqual([]);
    expect(mesh.geometry.morphAttributes.uv1).toEqual([]);
  });

  it("syncs weights and submits compute only to a native WebGPU renderer", () => {
    const mesh = createMesh();
    expect(enableMmdTslSparsePositionMorphs(mesh)).toBe(true);
    mesh.morphTargetInfluences = [0.25, 0.75];
    const compute = vi.fn();

    expect(
      computeMmdTslSparsePositionMorphs(
        { backend: { isWebGPUBackend: true }, compute },
        mesh
      )
    ).toBe(true);
    expect(compute).toHaveBeenCalledOnce();
    expect(compute.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ isComputeNode: true, count: 3 }),
      expect.objectContaining({ isComputeNode: true, count: 3 }),
      expect.objectContaining({ isComputeNode: true, count: 3 })
    ]);
    expect(() =>
      computeMmdTslSparsePositionMorphs(
        { backend: { isWebGPUBackend: false }, compute },
        mesh
      )
    ).toThrow("MMD_TSL_SPARSE_POSITION_MORPH_REQUIRES_WEBGPU");
  });

  it("retains a complete group per mesh only on opt-in and compares the weights as Float32", () => {
    const render = recordingRenderer();
    const a = createMesh(), b = createMesh();
    enableMmdTslSparsePositionMorphs(a);
    enableMmdTslSparsePositionMorphs(b);
    for (let frame = 0; frame < 240; frame++) {
      computeMmdTslSparsePositionMorphs(render, a);
      computeMmdTslSparsePositionMorphs(render, b, true);
    }
    expect(render.compute).toHaveBeenCalledTimes(241);
    for (const weight of [0.5, 1, 0]) {
      b.morphTargetInfluences = [0, weight];
      expect(computeMmdTslSparsePositionMorphs(render, b, true)).toBe(true);
      b.morphTargetInfluences = [0, weight + (weight === 0 ? 0 : 1e-12)];
      expect(computeMmdTslSparsePositionMorphs(render, b, true)).toBe(false);
    }
    // An independent UV-only morph still rebuilds every channel together.
    b.morphTargetInfluences = [0, 0, 1];
    expect(computeMmdTslSparsePositionMorphs(render, b, true)).toBe(true);
    expect(render.compute.mock.lastCall?.[0]).toHaveLength(3);
    expect(computeMmdTslSparsePositionMorphs(render, a, true)).toBe(true);
    for (let write = 0; write < 4; write++) {
      invalidateMmdTslSparseMorphOutputs(b);
      expect(computeMmdTslSparsePositionMorphs(render, b, true)).toBe(true);
      expect(computeMmdTslSparsePositionMorphs(render, a, true)).toBe(false);
    }
    expect(computeMmdTslSparsePositionMorphs(render, b, true)).toBe(false);
    disposeMmdTslSparsePositionMorphs(b);
    enableMmdTslSparsePositionMorphs(b);
    expect(computeMmdTslSparsePositionMorphs(render, b, true)).toBe(true);
  });

  it("rebuilds on renderer, device, GPU allocation, attribute upload or geometry binding changes", () => {
    const mesh = createMesh();
    enableMmdTslSparsePositionMorphs(mesh);
    const renderer = recordingRenderer();
    const compute = () => computeMmdTslSparsePositionMorphs(renderer, mesh, true);
    const uv = mesh.geometry.getAttribute("uv") as THREE.BufferAttribute;
    expect(compute()).toBe(true);
    expect(compute()).toBe(false);
    expect(computeMmdTslSparsePositionMorphs({ ...renderer }, mesh, true)).toBe(true);
    expect(compute()).toBe(true);
    renderer.backend.device = {};
    expect(compute()).toBe(true);
    renderer.backend.get(uv).buffer = {};
    expect(compute()).toBe(true);
    uv.needsUpdate = true;
    expect(compute()).toBe(true);
    mesh.geometry.setAttribute("uv", uv.clone());
    expect(compute()).toBe(true);
    expect(compute()).toBe(true);
    mesh.geometry.setAttribute("uv", uv);
    expect(compute()).toBe(true);
    expect(compute()).toBe(false);
    const unknown = { ...renderer, backend: { isWebGPUBackend: true } };
    expect(computeMmdTslSparsePositionMorphs(unknown, mesh, true)).toBe(true);
    expect(computeMmdTslSparsePositionMorphs(unknown, mesh, true)).toBe(true);
  });

  it("retries the full group after a failed or asynchronous submission", () => {
    const mesh = createMesh(), renderer = recordingRenderer();
    enableMmdTslSparsePositionMorphs(mesh);
    const compute = () => computeMmdTslSparsePositionMorphs(renderer, mesh, true);
    expect(compute()).toBe(true);
    mesh.morphTargetInfluences = [0.5, 0, 0];
    renderer.compute.mockImplementationOnce(() => { throw Error("submit"); });
    expect(compute).toThrow("submit");
    renderer.compute.mockReturnValueOnce(Promise.resolve());
    expect(compute()).toBe(true);
    expect(compute()).toBe(true);
    expect(compute()).toBe(false);
  });

  it("restores original attributes and morph attributes through idempotent cleanup", () => {
    const mesh = createMesh();
    const position = mesh.geometry.getAttribute("position");
    const uv = mesh.geometry.getAttribute("uv");
    const uv1 = mesh.geometry.getAttribute("uv1");
    const positionMorphs = mesh.geometry.morphAttributes.position;
    const uvMorphs = mesh.geometry.morphAttributes.uv;
    const uv1Morphs = mesh.geometry.morphAttributes.uv1;

    expect(enableMmdTslSparsePositionMorphs(mesh)).toBe(true);
    const compute = vi.fn();
    computeMmdTslSparsePositionMorphs({ backend: { isWebGPUBackend: true }, compute }, mesh);
    const submittedNodes = compute.mock.calls[0]?.[0];
    const computeNodes = Array.isArray(submittedNodes) ? submittedNodes : [submittedNodes];
    const nodeDisposeSpies = computeNodes
      .filter((node): node is THREE.Node => node != null)
      .map((node) => vi.spyOn(node, "dispose"));
    const outputAttributeDisposeSpies = ["position", "uv", "uv1"]
      .map((name) => mesh.geometry.getAttribute(name))
      .filter((attribute): attribute is THREE.BufferAttribute => attribute != null)
      .map((attribute) => vi.spyOn(attribute, "dispose"));

    expect(disposeMmdTslSparsePositionMorphs(mesh)).toBe(true);
    expect(mesh.geometry.getAttribute("position")).toBe(position);
    expect(mesh.geometry.getAttribute("uv")).toBe(uv);
    expect(mesh.geometry.getAttribute("uv1")).toBe(uv1);
    expect(mesh.geometry.morphAttributes.position).toBe(positionMorphs);
    expect(mesh.geometry.morphAttributes.uv).toBe(uvMorphs);
    expect(mesh.geometry.morphAttributes.uv1).toBe(uv1Morphs);
    for (const disposeSpy of nodeDisposeSpies) {
      expect(disposeSpy).toHaveBeenCalledOnce();
    }
    for (const disposeSpy of outputAttributeDisposeSpies) {
      expect(disposeSpy).toHaveBeenCalledOnce();
    }
    expect(disposeMmdTslSparsePositionMorphs(mesh)).toBe(false);
    expect(
      computeMmdTslSparsePositionMorphs(
        { backend: { isWebGPUBackend: true }, compute: vi.fn() },
        mesh
      )
    ).toBe(false);
  });

  it("leaves meshes without position morph entries unchanged", () => {
    const geometry = createThreeBufferGeometry(createBuffers());
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicNodeMaterial());

    expect(enableMmdTslSparsePositionMorphs(mesh)).toBe(false);
    expect(
      computeMmdTslSparsePositionMorphs(
        { backend: { isWebGPUBackend: true }, compute: vi.fn() },
        mesh
      )
    ).toBe(false);
    expect(geometry.getAttribute("position")).not.toHaveProperty("isStorageBufferAttribute", true);
  });

  it("enables and disposes sparse morph compute from geometry loaded without dense attributes", () => {
    const geometry = createThreeBufferGeometry(createBuffers(), [], [
      { vertexOffsets: [{ vertexIndex: 0, position: [0.5, 0, 0] }] }
    ], { morphAttributes: false });
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicNodeMaterial());
    mesh.morphTargetInfluences = [0];

    expect(geometry.morphAttributes.position).toBeUndefined();
    expect(enableMmdTslSparsePositionMorphs(mesh)).toBe(true);
    expect(geometry.morphAttributes.position).toEqual([]);
    expect(disposeMmdTslSparsePositionMorphs(mesh)).toBe(true);
    expect(geometry.morphAttributes.position).toBeUndefined();
  });
});

function recordingRenderer() {
  const buffers = new WeakMap<THREE.BufferAttribute, {buffer: object}>();
  return {
    backend: {
      isWebGPUBackend: true, device: {},
      get(attribute: THREE.BufferAttribute) {
        const found = buffers.get(attribute);
        if (found) return found;
        const allocation = {buffer: {}};
        buffers.set(attribute, allocation);
        return allocation;
      }
    },
    compute: vi.fn<(node: THREE.Node | THREE.Node[]) => Promise<void> | undefined>()
  };
}

function createMesh(): THREE.SkinnedMesh {
  const geometry = createThreeBufferGeometry(createBuffers(), [], [
    {
      vertexOffsets: [{ vertexIndex: 0, position: [0.5, 0, 0] }],
      uvOffsets: [{ vertexIndex: 0, uv: [0.1, 0.2] }],
      additionalUvOffsets: [{ vertexIndex: 0, uvIndex: 0, uv: [0.1, 0.2, 0.3, 0.4] }]
    },
    { vertexOffsets: [{ vertexIndex: 2, position: [0, 0.25, 0] }] },
    { uvOffsets: [{ vertexIndex: 2, uv: [0.25, 0.5] }] }
  ]);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicNodeMaterial());
  mesh.morphTargetInfluences = [0, 0, 0];
  return mesh;
}

function createBuffers() {
  return {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]),
    additionalUvs: [new Float32Array(12)],
    indices: new Uint16Array([0, 1, 2]),
    skinIndices: new Uint16Array(12),
    skinWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])
  };
}
