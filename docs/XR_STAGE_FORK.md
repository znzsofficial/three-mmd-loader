# XR Stage fork of 0.8.6

XR Stage uses the npm release of `@yohawing/three-mmd-loader` plus a patch derived from this fork's built `dist/`. The current base is **npm `0.8.6` / upstream `v0.8.6` (`9c47b94`)**. The fork retains that release's ESM entry points, declarations and pinned mmd-anim/Bullet binaries.

## Sync policy

- Start each update from the latest **published** upstream release that passes the stage's checks. Verify the npm version and corresponding tag/commit; an open release PR or a newer development branch is not a new baseline.
- Keep fork-specific changes in TypeScript here. An individually verified upstream fix can be backported with `git cherry-pick -x`; keep its tests and provenance. When the next release includes an equivalent fix, verify coverage before dropping the backport.
- Build here with `npm run build` and that release's matching artifacts. Generate the stage patch against a clean copy of the published package and compare the resulting **entire `dist/` tree** to the fork build, including added files. Normalize CRLF to LF for `.js` and `.d.ts` comparisons; compare binary assets byte for byte. Recheck the export map and run the fork and stage tests before adopting the update.

## Morph atlas backport

Upstream [`3f3c82a`](https://github.com/yohawing/three-mmd-loader/commit/3f3c82a3fc881bd3803276ad3a2e1335e5dc5a33) was picked individually from `release/v0.9.0` onto the existing XR Stage `0.8.6` extensions (`82147af`). Material and outline proxies share the source geometry, so Three.js allocates the morph atlas once per source geometry. Each proxy narrows the draw range during its own color draw, shadow draw or raycast and restores the prior range afterward. Outside those callbacks, read `start` and `count` from `userData.mmdMaterialRenderProxy` or `userData.mmdOutlineProxy`, not from the shared geometry's `drawRange`.

The backport does not require a native rebuild. The mmd-anim source pin remains `v0.5.4` (`f4f68d7`). The packed parser WASM, Bullet classic and worker WASM, and their generated bindings match the published `0.8.6` package byte for byte. SHA-256: parser `b764d802403f042e38ee83d3c34abab468c064dd5e98ab4d49cc8ea2ca9dbce6`; Bullet (both variants) `02e32a4c9ec3b16d166feec06edc20cf689be9a60e3286f2048c3c02392bebc9`.

## Retained XR Stage extensions

- **Contact queries:** `debugPhysicsContactsForRigidBodyRange(first, count)` returns contacts involving either body in the half-open range. The native debug buffer is still collected in full. `readRigidBodyCenters(indices, out)` reads XYZ triples in the requested order. Only use `out` if the call returns `true`.
- **Switching physics:** `ThreeMmdLoader.createDetachedRuntime(context)` uses the loader's existing runtime selection. `model.exchangeRuntime(next)` changes the evaluator used by the loaded mesh's animation and update methods, returning the old evaluator. The caller manages animation rebinding and disposal of the old evaluator.
- **Animation and rendering:** CCD iterations compose the active chains and their ancestors. Both tick paths update shared skeleton palettes once per rendering hierarchy. On the JS runtime, `captureStageSnapshots: false` skips intermediate debug copies; `coalescePhysicsWorldUpdates: true` can also defer intermediate matrix propagation to the active external physics pass. Neither option changes the default debugging behaviour.
- **Timing:** `onPhysicsPoseWork` measures animation/IK, input preparation, backend, and writeback. Bullet's `onStepWork` breaks down successful calls into input, native world step, and output; a reset/seed has no world-step time. Loader `performance: { enabled: false, onMeasure }` reports timings without filename-bearing global User Timing marks.
- **Material alpha:** geometry-aware scans reuse alpha samples for shared decoded images while classifying each material's UVs separately. A caller can also supply `localPngAlphaTiles` for repeated loads of the same local PNG `File`. Default GPU textures remain model-owned, not shared between models.
- **Surface morphs:** after `model.update()` or `updateAsync()`, apply evaluated PMX diffuse/edge alpha to the affected draws and standard/additional UV offsets to their bound attributes, including split geometry. Held UV weights do not dirty the attribute again. The facade consumes expanded weights; supply direct manual input to the evaluator with `morphOverrides`. This change does not evaluate other PMX material morph components.
- **Three.js compatibility:** the experimental TSL self-shadow pass uses the public shadow helpers when available (including r184). If they are absent (including r187) its render/compile steps return `false`; mode selection and resource disposal still work. This does not disable WebGL shadows.
