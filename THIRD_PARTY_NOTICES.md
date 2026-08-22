# Third-party notices

## Maia-3

Outprep includes the `maia3_simplified.onnx` model and interoperating browser/harness code for human-like chess move prediction.

- Upstream: [CSSLab/maia3](https://github.com/CSSLab/maia3)
- Upstream revision reviewed: `1e13597c42d4858b7cfd7cfdae01e297263364b2`
- Model file: `public/models/maia3-simplified.onnx`
- Model SHA-256: `405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856`
- License: GNU Affero General Public License v3.0; see [`licenses/MAIA3-AGPL-3.0.txt`](licenses/MAIA3-AGPL-3.0.txt)

The corresponding Outprep source is available in this repository, particularly under `packages/engine/src/maia-tensor.ts`, `src/lib/maia/`, `public/maia-worker.js`, and `packages/harness/src/node-maia-policy.ts`.

## Maia platform frontend reference implementation

The Maia worker protocol and browser inference implementation were informed by the Maia platform frontend.

- Upstream: [CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend)
- Upstream revision reviewed: `a6e52f5c811ee18863cb2f0e81f2433a5b9905de`
- License: GNU General Public License v3.0; see [`licenses/MAIA-PLATFORM-FRONTEND-GPL-3.0.txt`](licenses/MAIA-PLATFORM-FRONTEND-GPL-3.0.txt)
- Modifications: adapted the worker lifecycle, cache keying, integrity verification, legal-move representation, policy interface, error fallback, and application integration for Outprep.

## ONNX Runtime Web

Outprep distributes ONNX Runtime Web browser artifacts in `public/ort/` and uses the `onnxruntime-web` package in the benchmark harness.

- Upstream: [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime)
- Version: 1.23.0
- License: MIT; see [`licenses/ONNXRUNTIME-MIT.txt`](licenses/ONNXRUNTIME-MIT.txt)
