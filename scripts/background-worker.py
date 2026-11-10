"""One local nativeCPU job. stdin=sourceRGBA, stdout=sourceAlpha8.

Every original pixel enters overlapping1024px model inputs1:1. No global
downsampling, stretching, image files, remote image upload or training.
stderr contains aggregate JSON progress/statistics only. One model session.
Model: immutable HF commit de15b22ba131738a16dff04aab8bdf8dc32e3ac1,
onnx-community/BiRefNet_lite-ONNX/onnx/model.onnx, MIT; never downloaded here.
"""
import sys,os,argparse,pathlib,hashlib,time,json,threading
from background_tiles import MODEL_SIZE,validate_dimensions,tile_plan,infer_native_rgba
EXPECTED_SHA='5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333'
def event(value):print(json.dumps(value),file=sys.stderr,flush=True)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--width',type=int,required=True);parser.add_argument('--height',type=int,required=True);parser.add_argument('--model',required=True);parser.add_argument('--deps',required=True);parser.add_argument('--threads',type=int,default=4);args=parser.parse_args()
 validate_dimensions(args.width,args.height);threads=max(1,min(8,args.threads));os.environ['ORT_DISABLE_TELEMETRY']='1';os.environ['OMP_NUM_THREADS']=str(threads);sys.path.insert(0,str(pathlib.Path(args.deps).resolve()))
 import numpy as np
 import onnxruntime as ort
 if ort.__version__!='1.20.1' or np.__version__!='1.26.4':raise RuntimeError('Unverified native dependency versions')
 ort.disable_telemetry_events();started=time.perf_counter();width,height=args.width,args.height;expected=width*height*4;raw=sys.stdin.buffer.read(expected+1)
 if len(raw)!=expected:raise ValueError('RGBA body length differs from dimensions')
 model=pathlib.Path(args.model);digest=hashlib.sha256()
 with model.open('rb')as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
 if model.stat().st_size!=224005088 or digest.hexdigest()!=EXPECTED_SHA:raise RuntimeError('Unverified model hash')
 plan=tile_plan(width,height);total=len(plan);event({'event':'progress','completed':0,'total':total,'width':width,'height':height})
 options=ort.SessionOptions();options.intra_op_num_threads=threads;options.inter_op_num_threads=1;options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL;options.enable_cpu_mem_arena=False;options.enable_mem_pattern=True
 load_started=time.perf_counter();session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider']);load_ms=(time.perf_counter()-load_started)*1000;inference_ms=0
 def predict(data,index,total):
  nonlocal inference_ms
  def tile_timeout():
   event({'event':'error','error':'One native tile exceeded180seconds; source resolution was not reduced','completed':index,'total':total});os._exit(124)
  timer=threading.Timer(180,tile_timeout);timer.daemon=True;timer.start();infer_started=time.perf_counter()
  try:outputs=session.run(None,{session.get_inputs()[0].name:data})
  finally:timer.cancel()
  inference_ms+=(time.perf_counter()-infer_started)*1000;logits=np.asarray(outputs[0])
  if logits.shape!=(1,1,MODEL_SIZE,MODEL_SIZE):raise ValueError('Model returned unexpected native tile dimensions')
  return 1/(1+np.exp(-np.clip(logits[0,0].astype(np.float32),-88,88)))
 alpha=infer_native_rgba(raw,width,height,predict,np,on_progress=lambda value:event({'event':'progress',**value}))
 result=np.rint(np.clip(alpha,0,1)*255).astype(np.uint8).tobytes();del session,alpha,raw
 sys.stdout.buffer.write(result);sys.stdout.buffer.flush()
 event({'event':'statistics','model':'birefnet-lite-1024','method':'native-tiles','execution':'local-computer','runtime':ort.__version__,'threads':threads,'tiles':total,'loadMs':load_ms,'inferenceMs':inference_ms,'totalMs':(time.perf_counter()-started)*1000})
if __name__=='__main__':
 try:main()
 except Exception as error:event({'event':'error','error':str(error),'execution':'local-computer'});sys.exit(1)
