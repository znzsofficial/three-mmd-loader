import type { BufferAttribute, Material, SkinnedMesh } from "three";
import type { MaterialInfo, MorphData } from "../parser/model/modelTypes.js";
import { mmdMaterialSuppressesColorAtAlpha, mmdTransparencyModeAlphaTest } from "./material/material-metadata.js";
import { clampColor } from "./utils.js";

type ApplyWeights = (weights: readonly number[]) => void;
type AlphaOffset = { index: number; multiply: boolean; diffuse: number; edge: number };

// Material and UV targets are not native Three morph channels. Consume the
// evaluator's *expanded* weights; never expand groups again in the renderer.
export function createSurfaceMorphSync(
  mesh: SkinnedMesh, bodies: readonly SkinnedMesh[], proxies: readonly SkinnedMesh[],
  outlines: readonly SkinnedMesh[], materials: readonly MaterialInfo[], morphs: readonly MorphData[]
): (() => void) | undefined {
  const apply: ApplyWeights[] = [];
  const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const offsets = new Map<number, AlphaOffset[]>();
  for (const [index, morph] of morphs.entries()) {
    for (const offset of morph.materialOffsets) {
      const multiply = offset.operation === "multiply", neutral = multiply ? 1 : 0;
      const diffuse = offset.diffuse[3], edge = offset.edgeColor[3];
      if (diffuse === neutral && edge === neutral) continue;
      const op = { index, multiply, diffuse, edge };
      const first = offset.materialIndex === -1 ? 0 : offset.materialIndex;
      const end = offset.materialIndex === -1 ? materials.length : first + 1;
      for (let slot = first; slot < end; slot++) {
        if (!materials[slot]) continue;
        let list = offsets.get(slot);
        if (!list) offsets.set(slot, list = []);
        list.push(op);
      }
    }
  }
  for (const [slot, ops] of offsets) {
    const info = materials[slot], body = source[slot];
    const shadow = proxies.find(p => p.userData.mmdMaterialRenderProxy.materialIndex === slot)?.material;
    const edgeMaterial = outlines.find(p => p.userData.mmdOutlineProxy.sourceMaterialIndex === slot)?.material;
    const outline = Array.isArray(edgeMaterial) ? undefined : edgeMaterial;
    const restEdgeVisible = outline?.visible ?? false, restEdgeOpacity = outline?.opacity ?? 0;
    let lastDiffuse = info.diffuse[3], lastEdge = info.edgeColor[3];
    apply.push(weights => {
      let diffuseMul = 1, edgeMul = 1, diffuseAdd = 0, edgeAdd = 0;
      for (const op of ops) {
        const w = weights[op.index] ?? 0;
        if (op.multiply) {
          diffuseMul *= 1 + w * (op.diffuse - 1);
          edgeMul *= 1 + w * (op.edge - 1);
        } else { diffuseAdd += w * op.diffuse; edgeAdd += w * op.edge; }
      }
      const diffuse = clampColor(info.diffuse[3] * diffuseMul + diffuseAdd);
      const edge = clampColor(info.edgeColor[3] * edgeMul + edgeAdd);
      if (diffuse === lastDiffuse && edge === lastEdge) return;
      lastDiffuse = diffuse; lastEdge = edge;
      const suppress = mmdMaterialSuppressesColorAtAlpha(diffuse, info.flags);
      setBodyAlpha(body, diffuse, suppress);
      body.userData.mmdReferenceEdgeAlpha = edge;
      if (shadow && !Array.isArray(shadow) && shadow !== body) {
        setBodyAlpha(shadow, diffuse, suppress);
        shadow.userData.mmdReferenceEdgeAlpha = edge;
      }
      if (outline) {
        const atRest = diffuse === info.diffuse[3] && edge === info.edgeColor[3];
        outline.opacity = atRest ? restEdgeOpacity : edge;
        outline.visible = atRest ? restEdgeVisible : !suppress && edge > 0;
      }
    });
  }

  for (const body of bodies.length ? bodies : [mesh]) {
    const remap = body.userData.mmdMorphSplitBody?.morphTargetIndices;
    // Outline and render-order draws share these exact geometry objects.
    const targets = body.geometry.morphAttributes as Record<string, BufferAttribute[]>;
    for (const [name, attributes] of Object.entries(targets)) {
      if (!/^uv[1-4]?$/.test(name)) continue;
      const output = body.geometry.getAttribute(name) as BufferAttribute;
      const components = new Set<number>();
      const terms: { index: number; delta: BufferAttribute["array"]; previous: number }[] = [];
      for (const [local, attr] of attributes.entries()) {
        const index = remap?.[local] ?? local;
        if (morphs[index]?.type !== (name === "uv" ? "uv" : "additionalUv")) continue;
        let affectsChannel = false;
        for (let i = 0; i < attr.array.length; i++) {
          if (attr.array[i] !== 0) { components.add(i); affectsChannel = true; }
        }
        if (affectsChannel) terms.push({ index, delta: attr.array, previous: 0 });
      }
      if (!components.size) continue;
      const indices = Uint32Array.from(components);
      const rest = Float32Array.from(indices, i => output.array[i]);
      apply.push(weights => {
        let changed = false;
        for (const term of terms) {
          const w = weights[term.index] ?? 0;
          if (term.previous !== w) { changed = true; term.previous = w; }
        }
        if (!changed) return;
        for (let j = 0; j < indices.length; j++) {
          const i = indices[j];
          let value = rest[j];
          for (const term of terms) value += term.delta[i] * term.previous;
          output.array[i] = value;
        }
        output.needsUpdate = true;
      });
    }
  }
  if (!apply.length) return undefined;
  return () => {
    const weights = mesh.morphTargetInfluences;
    if (weights) for (const update of apply) update(weights);
  };
}

function setBodyAlpha(material: Material, alpha: number, suppress: boolean): void {
  const mode = material.userData.mmdMaterial.transparencyMode;
  const blend = mode === "alphaBlend" || alpha < 1;
  if (material.transparent !== blend) material.needsUpdate = true;
  material.opacity = alpha;
  material.transparent = blend;
  material.visible = alpha > 0 || suppress;
  material.colorWrite = !suppress && !material.userData.mmdShadowOnlyRenderProxy;
  material.alphaTest = suppress ? 0 : mmdTransparencyModeAlphaTest(mode === "opaque" && blend ? "alphaBlend" : mode);
}
