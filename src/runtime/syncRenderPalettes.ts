import type { Object3D, Skeleton, SkinnedMesh } from "three";

/** A material split or outline proxy can share its neighbour's Skeleton.
 * Revisit the hierarchy each tick: both reparenting and rebinding are legal. */
export function syncRenderPalettes(root: Object3D | undefined): void {
  if (!root) return;
  root.updateMatrixWorld(true);
  let first: Skeleton | undefined, others: Set<Skeleton> | undefined;
  function visit(object: Object3D): void {
    const mesh = object as SkinnedMesh;
    if (mesh.isSkinnedMesh === true) {
      const skeleton = mesh.skeleton;
      if (first === undefined) {
        first = skeleton;
        skeleton.update();
      } else if (skeleton !== first && !others?.has(skeleton)) {
        (others ??= new Set()).add(skeleton);
        skeleton.update();
      }
    }
    for (const child of object.children) visit(child);
  }
  visit(root);
}
