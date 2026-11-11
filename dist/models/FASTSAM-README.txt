FastSAM-s — local physical-object proposals

The unchanged model is provided under GNU AGPL version3. Full licence:
FASTSAM-UPSTREAM-LICENSE.txt. Complete Corresponding Source, rights/no-warranty
notice and generation directions: FASTSAM-SOURCE.txt and fastsam-source.zip
in this same directory. Exact runtime/source hashes: FASTSAM-PROVENANCE.json.

Authors: FastSAM contributors, CASIA-LMC-Lab/CASIA-IVA-Lab; Ultralytics and
contributors. Received ONNX conversion: anakhiu/fastsam-onnx. Original notices
and contradictory Apache statements are preserved unchanged as provenance.
This model notice does not change other independent application licences.

Input: RGB/255, pure bilinear top-left letterbox, 1024x1024, pad114.
One inference; base confidence0.25/NMS0.7, weak confidence0.05/NMS0.7.
Instance logits are upsampled before source-box clipping. Compact source
ROIs and shared prototypes feed source-RGB physical assembly; model masks
alone are not manufacturing outlines. Coordinates remain source pixels.
The existing downstream calibration and 2% pocket fit are applied once.

The model and WASM are fetched from this app's origin when first used,
then cached by its scoped service worker. This inference worker does not upload photographs; see the privacy notice for the separate optional background-removal service.
Recognition worker and model heap are released before geometry/export.
