"""Native source-grid tiles and weighted stitching. No image resampling here.

The standard-library path supports tests without model weights or NumPy.
Production uses NumPy to accumulate exactly the same source-coordinate weights.
"""
from array import array
MODEL_SIZE=1024
STRIDE=768
MAX_PIXELS=64000000

def validate_dimensions(width,height):
 if not isinstance(width,int) or not isinstance(height,int) or width<1 or height<1 or width*height>MAX_PIXELS:raise ValueError('Source must contain1..64000000 pixels; native resolution is never reduced')

def tile_starts(length):
 if length<1:raise ValueError('Invalid source dimension')
 if length<=MODEL_SIZE:return[0]
 last=length-MODEL_SIZE;positions=list(range(0,last+1,STRIDE))
 if positions[-1]!=last:positions.append(last)
 return positions

def tile_plan(width,height):
 validate_dimensions(width,height)
 return[(x,y,min(MODEL_SIZE,width-x),min(MODEL_SIZE,height-y))for y in tile_starts(height)for x in tile_starts(width)]

def extract_tile_rgba(rgba,width,height,tile):
 """Copy original bytes1:1; white padding only outside the source frame."""
 validate_dimensions(width,height)
 if len(rgba)!=width*height*4:raise ValueError('RGBA body length differs from dimensions')
 x,y,valid_width,valid_height=tile
 if x<0 or y<0 or valid_width<1 or valid_height<1 or valid_width>MODEL_SIZE or valid_height>MODEL_SIZE or x+valid_width>width or y+valid_height>height:raise ValueError('Invalid native tile')
 result=bytearray(b'\xff')*(MODEL_SIZE*MODEL_SIZE*4);source=memoryview(rgba);target=memoryview(result)
 for row in range(valid_height):
  start=((y+row)*width+x)*4;out=row*MODEL_SIZE*4;target[out:out+valid_width*4]=source[start:start+valid_width*4]
 return result

def tile_weights(width,height,tile):
 x,y,w,h=tile;overlap=MODEL_SIZE-STRIDE
 def axis(length,leading,trailing):
  return[min(1.0,(i+.5)/overlap if leading else 1.0,(length-i-.5)/overlap if trailing else 1.0)for i in range(length)]
 return axis(w,x>0,x+w<width),axis(h,y>0,y+h<height)

def prepare_native_input(tile_rgba,numpy):
 """Normalize channel intensity only; no pixel is interpolated or relocated."""
 np=numpy;rgb=np.frombuffer(tile_rgba,dtype=np.uint8).reshape(MODEL_SIZE,MODEL_SIZE,4)[:,:,:3]
 mean=np.asarray([.485,.456,.406],dtype=np.float32);std=np.asarray([.229,.224,.225],dtype=np.float32)
 return np.ascontiguousarray(((rgb.astype(np.float32)/255-mean)/std).transpose(2,0,1)[None,:,:,:],dtype=np.float32)

class NativeAlphaStitcher:
 def __init__(self,width,height,numpy=None):
  validate_dimensions(width,height);self.width=width;self.height=height;self.np=numpy
  if numpy is None:self.sums=array('f',[0])*(width*height);self.weights=array('f',[0])*(width*height)
  else:self.sums=numpy.zeros((height,width),dtype=numpy.float32);self.weights=numpy.zeros((height,width),dtype=numpy.float32)
 def add(self,tile,prediction):
  x,y,w,h=tile;wx,wy=tile_weights(self.width,self.height,tile)
  if self.np is not None:
   np=self.np;prediction=np.asarray(prediction,dtype=np.float32)
   if prediction.shape!=(MODEL_SIZE,MODEL_SIZE)or not np.all(np.isfinite(prediction))or np.any(prediction<0)or np.any(prediction>1):raise ValueError('Invalid native tile prediction')
   weights=np.outer(np.asarray(wy,dtype=np.float32),np.asarray(wx,dtype=np.float32));region=np.s_[y:y+h,x:x+w]
   self.sums[region]+=prediction[:h,:w]*weights;self.weights[region]+=weights
  else:
   if len(prediction)!=MODEL_SIZE*MODEL_SIZE:raise ValueError('Invalid native tile prediction')
   for row in range(h):
    for col in range(w):
     value=prediction[row*MODEL_SIZE+col]
     if not 0<=value<=1:raise ValueError('Invalid alpha probability')
     index=(y+row)*self.width+x+col;weight=wy[row]*wx[col];self.sums[index]+=value*weight;self.weights[index]+=weight
 def finish(self):
  if self.np is not None:
   if self.np.any(self.weights<=0):raise ValueError('Native tiles did not cover every source pixel')
   self.np.divide(self.sums,self.weights,out=self.sums);return self.sums
  for index,weight in enumerate(self.weights):
   if weight<=0:raise ValueError('Native tiles did not cover every source pixel')
   self.sums[index]/=weight
  return self.sums

def infer_native_rgba(rgba,width,height,predict,numpy,on_progress=None):
 """Actual worker input/stitch pipeline, with injectable prediction for tests."""
 plan=tile_plan(width,height);total=len(plan);stitch=NativeAlphaStitcher(width,height,numpy=numpy)
 def progress(completed):
  if on_progress:on_progress({'completed':completed,'total':total,'width':width,'height':height})
 progress(0)
 for index,tile in enumerate(plan):
  model_input=prepare_native_input(extract_tile_rgba(rgba,width,height,tile),numpy)
  stitch.add(tile,predict(model_input,index,total));progress(index+1)
 return stitch.finish()
