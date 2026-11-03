// Reduced from a user-provided outline, not image pixels. Preserves the observed
// near-collinear Boolean/stitching failure of the public manufacturing export.
export const stitchContour = {
  "points": [[180,6.4],[151.6,32.4],[32,45.6],[40.8,43.2],
    [40.8,42.8],[42.8,42.8],[47.2,41.6],[47.2,41.2],
    [49.2,41.2],[50.4,40.8],[50.4,40.4],[52,40.4],
    [52,40],[53.6,40],[53.6,39.6],[55.6,39.6]].map(([x,y])=>({x,y})),
  "tool": {
    "id": "stitch-tool",
    "name": "Near-collinear stitch regression",
    "x": 119.52535,
    "y": 48.485850000000006,
    "rotation": 104.492267,
    "depth": 10,
    "fingerGrips": [
      {
        "id": "photo-3-finger-1",
        "x": 141.7934418834906,
        "y": 6.907044922576603,
        "radius": 9
      },
      {
        "id": "photo-3-finger-2",
        "x": 148.14825052577052,
        "y": 31.492955077423403,
        "radius": 9
      }
    ]
  },
  "module": {
    "id": "stitch-module",
    "name": "Source-sized module",
    "x": 0,
    "y": 0,
    "width": 168,
    "height": 546
  },
  "settings": {
    "width": 1100,
    "height": 700,
    "clearance": 0.8,
    "wall": 2.4,
    "base": 2.4,
    "insertHeight": 20
  }
};

// A separately reduced aligned contour exercises float32-collapsed stitch fans.
export const alignedStitchContour = {
  "points": [[142.4,6.4],[134.4,20.8],[134.4,21.2],[133.6,21.2],
    [133.6,21.6],[132.8,21.6],[132.8,22],[132,22],
    [131.2,22.4],[131.2,22.8],[130.4,22.8],[130.4,23.2],
    [0,46.8]].map(([x,y])=>({x,y})),
  "tool": {
    "id": "aligned-stitch-tool",
    "name": "Aligned float32 stitch regression",
    "x": 121.90205,
    "y": 384.2693,
    "rotation": 105.09875,
    "depth": 13,
    "fingerGrips": [
      {
        "id": "photo-6-finger-1",
        "x": 111.55209588381672,
        "y": 5.703395725612889,
        "radius": 9
      },
      {
        "id": "photo-6-finger-2",
        "x": 116.89225006302404,
        "y": 25.496604274387114,
        "radius": 9
      }
    ]
  },
  "module": {
    "id": "aligned-stitch-module",
    "name": "Source-sized aligned module",
    "x": 0,
    "y": 0,
    "width": 168,
    "height": 546
  },
  "settings": {
    "width": 1100,
    "height": 700,
    "clearance": 0.8,
    "wall": 2.4,
    "base": 2.4,
    "insertHeight": 20
  }
};

// Nearby but distinct quantized edges must not become stitching T-junctions.
export const strictStitchContour = {
  "points": [[156.8,31.2],[154.8,31.2],[2.8,58],[0.8,58],
    [0.8,57.6],[0,57.6],[0,55.2],[25.6,47.2],
    [25.6,46.8],[125.2,13.6],[125.2,13.2],[126,13.2],
    [126,12.8],[126.8,12.8],[126.8,12.4],[127.6,12.4],
    [127.6,12],[128.4,12],[128.4,11.6],[129.2,11.6],
    [129.2,11.2],[130,11.2],[130,10.8],[130.8,10.8],
    [130.8,10.4],[131.6,10.4],[131.6,10],[132.4,10],
    [132.4,9.6],[133.2,9.6],[133.2,9.2],[134,9.2]].map(([x,y])=>({x,y})),
  "tool": {
    "id": "strict-stitch-tool",
    "name": "Nearby distinct stitch edges",
    "x": 195.35095,
    "y": 103.08989999999996,
    "rotation": 104.49226699999997,
    "depth": 10
  },
  "module": {
    "id": "strict-stitch-module",
    "name": "Uniform source-sized module",
    "x": 168,
    "y": 0,
    "width": 84,
    "height": 294
  },
  "settings": {
    "width": 1100,
    "height": 700,
    "clearance": 0.8,
    "wall": 2.4,
    "base": 2.4,
    "insertHeight": 20
  }
};
