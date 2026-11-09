/** Structurally valid empty inference for editor-only deterministic fixtures.
 * Actual neural accuracy is covered separately by real worker tests. */
export function instanceWorkerReply(message){
  const {id,width,height}=message;
  return{type:'result',id,width,height,model:'fastsam-s',instances:[],weakProposals:[],prototypes:new Float32Array(32*256*256),transform:{width,height,size:1024,resizedWidth:1024,resizedHeight:1024,scaleX:1024/width,scaleY:1024/height}};
}
