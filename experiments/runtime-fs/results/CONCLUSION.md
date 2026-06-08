# Runtime / Filesystem Experiment Conclusion

This document summarizes the current benchmark evidence for the ALS `Cmd_load`
runtime/filesystem comparison in `experiments/runtime-fs`.

## What We Measured

Compared two benchmarkable runtimes:

- `runno-proxy-current`
- `browser-wasi-shim-memfs`

Measured fixtures:

- `builtin-nat`
- `stdlib-nat`
- `cubical-prelude`

All runs use the same ALS 2.8.0 WASM and the same stdlib/Cubical assets.

## Main Results

### `runno-proxy-current`

Representative `cubical-prelude` result:

| Metric | Value |
| --- | ---: |
| setupMs | 632.495ms |
| firstLoadMs | 15597.248ms |
| secondLoadMs | 3963.452ms |
| first pathStatCount | 2106 |
| second pathStatCount | 1301 |
| first agdaiRead | 18 |
| second agdaiRead | 11 |

This is still the closest benchmark to the main app's current architecture
because it keeps the cross-worker drive proxy in place.

### `browser-wasi-shim-memfs`

Representative results:

| Fixture | First load | Second load | First pathStatCount | Second pathStatCount |
| --- | ---: | ---: | ---: | ---: |
| builtin-nat | 611.774ms | 54.298ms | 1490 | 1202 |
| stdlib-nat | 11693.622ms | 222.132ms | 19130 | 8848 |
| cubical-prelude | 7295.579ms | 116.794ms | 4212 | 2604 |

Additional observations:

- `browser_wasi_shim` completed first and second `Cmd_load` for all three
  fixtures.
- It reached `ResponseEnd` reliably enough to produce stable JSON output.
- The second load is dramatically faster than the first load on every fixture,
  which indicates that the session-level `.agdai` reuse path is working in this
  harness.
- The path-stat profile is much lower than the current `runno-proxy-current`
  cubical baseline, which makes this runtime/filesystem combination a useful
  comparison point rather than just a correctness fallback.

## Direct Comparison

`cubical-prelude` is the most useful comparison because it exercises the same
library-loading path that originally motivated this investigation.

| Runtime | First load | Second load | First pathStatCount | Second pathStatCount |
| --- | ---: | ---: | ---: | ---: |
| runno-proxy-current | 15597.248ms | 3963.452ms | 2106 | 1301 |
| browser-wasi-shim-memfs | 7295.579ms | 116.794ms | 4212 | 2604 |

Interpretation:

- `browser-wasi-shim-memfs` is materially faster on wall-clock time for
  `cubical-prelude`, especially on the second load.
- `runno-proxy-current` is still the only runtime that matches the main app's
  existing architecture, so it remains the baseline for browser-side behavior.
- `browser_wasi_shim` is now a valid second comparison runtime, not just a
  placeholder.

## Conclusions

1. `browser-wasi-shim-memfs` is benchmarkable in this project and should stay
   in the comparison set.
2. `runno-proxy-current` remains the architectural baseline for the main app.
3. `runno-direct-fs` is still an architecture-level blocker and should not be
   used as the main comparison target.
4. For load-time investigation, the next useful direction is to compare why
   `browser_wasi_shim` gets a much shorter second load while `runno-proxy-current`
   still spends significant time in `pathStat` and drive-proxy work.

## Practical Next Step

If we continue this line of work, the next useful experiment is to align the
result format across `runno-proxy-current` and `browser-wasi-shim-memfs` with a
small, explicit comparison report for:

- `firstLoadMs`
- `secondLoadMs`
- `pathStatCount`
- `methodDurationsMs.pathStat`
- `.agdaiRead` / `.agdaiWrite`

