---
license: apache-2.0
library_name: onnx
tags:
  - fastsam
  - yolov8-seg
  - segmentation
base_model: CASIA-IVA-Lab/FastSAM
---

# FastSAM-s ONNX (fp32)

ONNX export of **FastSAM-s** (YOLOv8s-seg, ~11.8M params) for click-to-select
segmentation on CPU. Used by MicrostockEngine to mask a watermark from a single
click before inpainting.

## Provenance

- Source weights: ultralytics `FastSAM-s.pt`, assets release `v8.4.0`.
- Export: `ultralytics` 8.4.107, `imgsz=1024`, `opset=17`, simplified with `onnxslim`.
- No quantization — full fp32.

## I/O contract

- **input** `images`: `[1, 3, 1024, 1024]` float32, values `0..1`, letterboxed
  top-left with pad value `114/255`.
- **output0**: `[1, 37, 21504]` — per anchor: 4 box (xywh, in 1024-space) + 1
  class score (sigmoid already applied; FastSAM is class-agnostic) + 32 mask
  coefficients.
- **output1**: `[1, 32, 256, 256]` — 32 mask prototypes at a quarter of input
  resolution. An instance mask is `sigmoid(sum(coeff_i * proto_i))`, cropped to
  its own box.

## Licence

Apache-2.0 (CASIA-IVA-Lab/FastSAM). The weights were trained with Ultralytics
code (AGPL-3.0); noted here so the provenance is not lost.
