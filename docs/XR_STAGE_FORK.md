# XR Stage fork of 0.9.0

XR Stage uses the npm release of `@yohawing/three-mmd-loader` plus a patch derived from this fork's built `dist/`. The base is **npm `0.9.0` / upstream `v0.9.0` (`62ce047`)**. Keep the published entry points, dependency contract and mmd-anim/Bullet binaries; the extra stage APIs live in this source tree.

## Sync policy

- Start each update from the latest **published** upstream release that passes the stage's checks. Verify the npm version and corresponding tag/commit; an open release PR or a newer development branch is not a new baseline.
- Keep fork-specific changes in TypeScript here. An individually verified upstream fix can be backported with `git cherry-pick -x`; keep its tests and provenance. When the next release includes an equivalent fix, verify coverage before dropping the backport.
- Build here with `npm run build` and that release's matching artifacts. Generate the stage patch against a clean copy of the published package and compare the resulting **entire `dist/` tree** to the fork build, including added files. Normalize CRLF to LF for `.js` and `.d.ts` comparisons; compare binary assets byte for byte. Recheck the export map and run the fork and stage tests before adopting the update.

## Changes now supplied by upstream

The shared material/outline geometry fix [`3f3c82a`](https://github.com/yohawing/three-mmd-loader/commit/3f3c82a3fc881bd3803276ad3a2e1335e5dc5a33), rigid-body range queries and r186/r187 TSL self-shadow compatibility are in 0.9.0. Keep their upstream implementations. Outside draw callbacks, read the proxy's `start` and `count` from `userData.mmdMaterialRenderProxy` or `userData.mmdOutlineProxy`, not the shared geometry's `drawRange`.

The native source pin is `mmd-anim v0.5.5` (`3bbd5b0`). The parser WASM, Bullet classic and worker WASM and generated bindings come from the integrity-checked 0.9.0 package. SHA-256: parser `530f14f7b3df03fdeb9ed8e4b6130f5344fd2b6d2bbbfcb195a3a82be72e598c`; classic Bullet `b82107ac43d0ec79f9bc0a601ec6a773401e13d007bc4c9113e34f17e772b990`.

## Retained XR Stage extensions

- **Contact queries:** `debugPhysicsContactsForRigidBodyRange(first, count)` returns contacts involving either body in the half-open range. The native debug buffer is still collected in full. `readRigidBodyCenters(indices, out)` reads XYZ triples in the requested order. Only use `out` if the call returns `true`.
- **Switching physics:** `ThreeMmdLoader.createDetachedRuntime(context)` uses the loader's existing runtime selection. `model.exchangeRuntime(next)` changes the evaluator used by the loaded mesh's animation and update methods, returning the old evaluator. The caller manages animation rebinding and disposal of the old evaluator.
- **Animation and rendering:** CCD iterations compose the active chains and their ancestors. Both tick paths update shared skeleton palettes once per rendering hierarchy. On the JS runtime, `captureStageSnapshots: false` skips intermediate debug copies; `coalescePhysicsWorldUpdates: true` can also defer intermediate matrix propagation to the active external physics pass. Neither option changes the default debugging behaviour.
- **Timing:** `onPhysicsPoseWork` measures animation/IK, input preparation, backend, and writeback. Bullet's `onStepWork` breaks down successful calls into input, native world step, and output; a reset/seed has no world-step time. Loader `performance: { enabled: false, onMeasure }` reports timings without filename-bearing global User Timing marks.
- **Material alpha:** geometry-aware scans reuse alpha samples for shared decoded images while classifying each material's UVs separately. A caller can also supply `localPngAlphaTiles` for repeated loads of the same local PNG `File`. Default GPU textures remain model-owned, not shared between models.
- **Surface morphs:** after `model.update()` or `updateAsync()`, apply evaluated PMX diffuse/edge alpha to the affected draws and standard/additional UV offsets to their bound attributes, including split geometry. Held UV weights do not dirty the attribute again. The facade consumes expanded weights; supply direct manual input to the evaluator with `morphOverrides`. This change does not evaluate other PMX material morph components.
- **XR rendering policy:** the game disables the dedicated MMD self-shadow pass in XR and removes its shadow-only proxy. This is independent of 0.9.0's support for running the pass on r187.
