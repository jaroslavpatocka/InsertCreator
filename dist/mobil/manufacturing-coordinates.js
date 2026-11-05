// The editor uses X right / Y down. A physical top view uses X right / Y up.
// Convert the entire body once; reflecting just lettering leaves pockets mirrored.
import {weldPrintVertices,finalizePrintTriangles} from './print-geometry.js';

/** Finalize direct exports by default. A batch may request a pure affine with
 * finalize:false after welding the raw source, then finalize once after its last
 * translation/print rotation. Never prune fans in an intermediate Float32 frame.
 */
export function layoutMeshToPhysical(triangles,yAnchor=0,{finalize=true}={}){
  const point=([x,y,z])=>[x,yAnchor-y,z];
  // The layout mesher has already discarded fans that coincide in its binary
  // Float32 frame. Preserve exactly that vertex equivalence before an affine can
  // separate the original double-precision fan centre from its boundary vertex.
  const source=finalize?weldPrintVertices(triangles):triangles;
  // A reflection reverses handedness. Reverse every facet to retain outward
  // winding, positive volume and correct normals when the STL is encoded.
  const physical=source.map(([a,b,c])=>[point(a),point(c),point(b)]);
  return finalize?finalizePrintTriangles(physical):physical;
}
