FastSAM-s - local physical-object proposals

Authors: FastSAM contributors, CASIA-LMC-Lab / CASIA-IVA-Lab.
Exporter: anakhiu/fastsam-onnx. Exact revisions, download and checksum:
FASTSAM-PROVENANCE.json. Model is bundled unchanged (47,637,745 bytes).

The exporter model card and upstream README claim Apache-2.0, while
the pinned upstream LICENSE contains AGPL-3.0. Both statements and the
actual license text are retained in FASTSAM-MODEL-CARD.md,
FASTSAM-UPSTREAM-README.md and FASTSAM-UPSTREAM-LICENSE.txt.
The discrepancy must be clarified before production publication.
This notice does not change or determine the application's license.

Input: RGB/255, pure bilinear top-left letterbox, 1024x1024, pad114.
One inference; base confidence0.25/NMS0.7, weak confidence0.05/NMS0.7.
Instance logits are upsampled before source-box clipping. Compact source
ROIs and shared prototypes feed source-RGB physical assembly; model masks
alone are not manufacturing outlines. Coordinates remain source pixels.
The existing downstream calibration and 2% pocket fit are applied once.

The model and WASM are fetched from this app's origin when first used,
then cached by its scoped service worker. No photograph is uploaded.
Recognition worker and model heap are released before geometry/export.
