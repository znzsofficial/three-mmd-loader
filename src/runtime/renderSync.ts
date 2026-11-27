import * as THREE from "three";

export function syncRuntimeMeshForRender(mesh: THREE.Object3D | undefined): void {
  if (!mesh) {
    return;
  }
  // Keep renderer-facing world and bone matrices in sync after runtime evaluation.
  mesh.updateMatrixWorld(true);
  updateSkinnedMeshSkeletons(mesh);
}

type SeenSkeletons = THREE.Skeleton | Set<THREE.Skeleton> | undefined;

// Body, material-order and outline meshes can share their CPU palette. Keep
// identity local to this walk: proxies can be rebound between ticks. The
// usual single-skeleton hierarchy doesn't need to allocate a Set.
function updateSkinnedMeshSkeletons(object: THREE.Object3D, seen?: SeenSkeletons): SeenSkeletons {
  if (isSkinnedMesh(object)) {
    const skeleton = object.skeleton;
    if (seen === undefined) {
      skeleton.update();
      seen = skeleton;
    } else if (seen !== skeleton) {
      if (!(seen instanceof Set)) seen = new Set([seen]);
      if (!seen.has(skeleton)) {
        skeleton.update();
        seen.add(skeleton);
      }
    }
  }
  const children = object.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child) {
      seen = updateSkinnedMeshSkeletons(child, seen);
    }
  }
  return seen;
}

export function isObject3D(value: unknown): value is THREE.Object3D {
  return value instanceof THREE.Object3D || hasBooleanFlag(value, "isObject3D");
}

export function isSkinnedMesh(value: THREE.Object3D): value is THREE.SkinnedMesh {
  return value instanceof THREE.SkinnedMesh || hasBooleanFlag(value, "isSkinnedMesh");
}

function hasBooleanFlag(value: unknown, key: "isObject3D" | "isSkinnedMesh"): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<typeof key, unknown>)[key] === true
  );
}
