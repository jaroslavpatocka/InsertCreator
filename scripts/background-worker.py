"""One local nativeCPU job. stdin=RGBA, stdout=alpha8, stderr=aggregate JSON only.

Model: immutable HF converter commit de15b22ba131738a16dff04aab8bdf8dc32e3ac1,
onnx-community/BiRefNet_lite-ONNX/onnx/model.onnx, MIT. Model is never downloaded
by this worker. No image files, network request, training or annotation input.
"""
import sys, os, argparse, pathlib, hashlib, time, json

EXPECTED_SHA='5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333'
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--width',type=int,required=True);parser.add_argument('--height',type=int,required=True);parser.add_argument('--model',required=True);parser.add_argument('--deps',required=True);parser.add_argument('--threads',type=int,default=4);args=parser.parse_args()
 if args.width<1 or args.height<1 or args.width*args.height>4000000:raise ValueError('Invalid source dimensions')
 threads=max(1,min(8,args.threads));os.environ['ORT_DISABLE_TELEMETRY']='1';os.environ['OMP_NUM_THREADS']=str(threads)
 sys.path.insert(0,str(pathlib.Path(args.deps).resolve()))
 import numpy as np
 import onnxruntime as ort
 if ort.__version__!='1.20.1' or np.__version__!='1.26.4':raise RuntimeError('Unverified native dependency versions')
 ort.disable_telemetry_events();started=time.perf_counter();expected=args.width*args.height*4;raw=sys.stdin.buffer.read(expected+1)
 if len(raw)!=expected:raise ValueError('RGBA body length differs from dimensions')
 model=pathlib.Path(args.model);digest=hashlib.sha256()
 with model.open('rb')as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
 if model.stat().st_size!=224005088 or digest.hexdigest()!=EXPECTED_SHA:raise RuntimeError('Unverified model hash')
 width,height=args.width,args.height;rgba=np.frombuffer(raw,dtype=np.uint8).reshape(height,width,4);size=1024
 # Exact half-pixel bilinear source sampling; full source dimensions retained.
 xs=np.clip((np.arange(size,dtype=np.float64)+.5)*width/size-.5,0,width-1);ys=np.clip((np.arange(size,dtype=np.float64)+.5)*height/size-.5,0,height-1);x0=np.floor(xs).astype(np.int32);y0=np.floor(ys).astype(np.int32);x1=np.minimum(width-1,x0+1);y1=np.minimum(height-1,y0+1);fx=xs-x0;fy=ys-y0
 alpha=rgba[:,:,3:4].astype(np.float64)/255;rgb=rgba[:,:,:3]*alpha+255*(1-alpha)
 resized=(rgb[y0[:,None],x0[None,:]]*(1-fx[None,:,None])+rgb[y0[:,None],x1[None,:]]*fx[None,:,None])*(1-fy[:,None,None])+(rgb[y1[:,None],x0[None,:]]*(1-fx[None,:,None])+rgb[y1[:,None],x1[None,:]]*fx[None,:,None])*fy[:,None,None]
 data=np.ascontiguousarray(((resized/255-np.array([.485,.456,.406]))/np.array([.229,.224,.225])).transpose(2,0,1)[None,:,:,:],dtype=np.float32)
 del rgb,resized,alpha
 options=ort.SessionOptions();options.intra_op_num_threads=threads;options.inter_op_num_threads=1;options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL;options.enable_cpu_mem_arena=False;options.enable_mem_pattern=True
 load_started=time.perf_counter();session=ort.InferenceSession(str(model),sess_options=options,providers=['CPUExecutionProvider']);load_ms=(time.perf_counter()-load_started)*1000
 infer_started=time.perf_counter();outputs=session.run(None,{session.get_inputs()[0].name:data});infer_ms=(time.perf_counter()-infer_started)*1000;logits=np.asarray(outputs[0]);probability=1/(1+np.exp(-np.clip(logits[0,0].astype(np.float64),-88,88)));sh,sw=probability.shape
 xs=np.clip((np.arange(width,dtype=np.float64)+.5)*sw/width-.5,0,sw-1);ys=np.clip((np.arange(height,dtype=np.float64)+.5)*sh/height-.5,0,sh-1);x0=np.floor(xs).astype(np.int32);y0=np.floor(ys).astype(np.int32);x1=np.minimum(sw-1,x0+1);y1=np.minimum(sh-1,y0+1);fx=xs-x0;fy=ys-y0
 source_alpha=(probability[y0[:,None],x0[None,:]]*(1-fx[None,:])+probability[y0[:,None],x1[None,:]]*fx[None,:])*(1-fy[:,None])+(probability[y1[:,None],x0[None,:]]*(1-fx[None,:])+probability[y1[:,None],x1[None,:]]*fx[None,:])*fy[:,None]
 result=np.rint(source_alpha*255).clip(0,255).astype(np.uint8).tobytes();del session,outputs,data,logits,probability,source_alpha
 sys.stdout.buffer.write(result);sys.stdout.buffer.flush()
 print(json.dumps({'model':'birefnet-lite-1024','execution':'local-computer','runtime':ort.__version__,'threads':threads,'loadMs':load_ms,'inferenceMs':infer_ms,'totalMs':(time.perf_counter()-started)*1000}),file=sys.stderr,flush=True)

if __name__=='__main__':
 try:main()
 except Exception as error:
  print(json.dumps({'error':str(error),'execution':'local-computer'}),file=sys.stderr,flush=True);sys.exit(1)
