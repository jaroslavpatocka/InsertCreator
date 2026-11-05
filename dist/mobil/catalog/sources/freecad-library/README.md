# FreeCAD Parts Library – Digital caliper (CC-BY 3.0)

- **Source:** https://github.com/FreeCAD/FreeCAD-library
- **File:** `Industrial Design/Hand tools/Measuring tools/Digital_caliper/Digital_caliper.stl`
  (https://github.com/FreeCAD/FreeCAD-library/tree/f5ca01cdcaa2f69b9295a6382719c2d90628780c/Industrial%20Design/Hand%20tools/Measuring%20tools/Digital_caliper)
- **Repository commit at download:** `f5ca01cdcaa2f69b9295a6382719c2d90628780c` (master);
  part added in commit `914025b77c5c5ea7b5f78b460c075a49ffad3260` ("Add digital caliper.", 2023-10-12)
- **Author:** hasecilu (per git history, as the library's asset licence instructs)
- **Downloaded:** 2026-11-03
- **License:** Creative Commons Attribution 3.0 Unported (CC-BY-3.0) – full text in `LICENSE-Assets.txt`
  (copied unmodified from the repository). Attribution required: "Digital caliper by hasecilu,
  FreeCAD-library, CC BY 3.0" – carried in the catalogue item's `source` field.

## Files

`Digital_caliper.stl.gz` – the unmodified binary STL (millimetres, MD5 of the uncompressed file
`9e40950d071c18e6fcf9c3dae411dc8f`), gzip-compressed for size (`gzip -d` restores it).

## Changes made for `../../imported.js` (CC-BY requires indicating changes)

The model is shown with the slider open. For a drawer pocket the caliper is stored closed, so the mesh was
split into connected components and every component except the beam (slider, jaws, depth rod, screws,
buttons) was moved 69.0 mm along the beam until the outside jaws touch. The closed caliper was then projected
to the top view (silhouette = union of projected triangles), aligned with the beam along X and simplified
(Douglas–Peucker 0.1 mm). Result: ≈ 236 × 77.5 mm, thickness 14.5 mm. Marked `accuracy:'typical'`.
