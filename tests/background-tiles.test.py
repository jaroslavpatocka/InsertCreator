"""Fake predictors verify native geometry/stitching, not neural quality."""
import sys,pathlib,unittest
from array import array
ROOT=pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
sys.path.insert(0,str(ROOT.parent/'artifacts/background-model-bench/native-deps'))
from background_tiles import MODEL_SIZE,MAX_PIXELS,tile_starts,tile_plan,extract_tile_rgba,NativeAlphaStitcher,infer_native_rgba
try:import numpy as np
except ImportError:np=None

def source_rgba(width,height):
 result=bytearray(width*height*4)
 for y in range(height):
  for x in range(width):
   p=(y*width+x)*4;result[p:p+4]=bytes([x%256,y%256,((x//256)+16*(y//256))%256,(x*17+y*31)%256])
 return result

class NativeTileTests(unittest.TestCase):
 def test_last_tile_inside_and_no_gaps_for_odd_dimensions(self):
  for length in [1,37,1023,1024,1025,1291,1792,1793,4097,8000]:
   starts=tile_starts(length);self.assertEqual(starts[0],0);self.assertEqual(starts[-1],max(0,length-1024));self.assertEqual(starts,sorted(set(starts)))
   self.assertTrue(all(b-a<=768 for a,b in zip(starts,starts[1:])));self.assertTrue(all(x+1024<=length for x in starts)if length>=1024 else starts==[0])
 def test_every_source_rgba_byte_reaches_native_tile_without_resampling(self):
  for width,height in [(1291,37),(37,1291),(1031,1033)]:
   source=source_rgba(width,height);before=bytes(source);covered=bytearray(width*height)
   for tile in tile_plan(width,height):
    x,y,w,h=tile;pixels=extract_tile_rgba(source,width,height,tile);self.assertEqual(len(pixels),1024*1024*4)
    for row in range(h):
     a=((y+row)*width+x)*4;b=row*1024*4
     self.assertEqual(pixels[b:b+w*4],source[a:a+w*4]);covered[(y+row)*width+x:(y+row)*width+x+w]=b'\1'*w
   self.assertEqual(covered.count(0),0);self.assertEqual(bytes(source),before)
 def test_small_image_padding_is_outside_source_only(self):
  source=source_rgba(7,5);pixels=extract_tile_rgba(source,7,5,tile_plan(7,5)[0])
  for row in range(5):self.assertEqual(pixels[row*4096:row*4096+28],source[row*28:(row+1)*28]);self.assertEqual(pixels[row*4096+28:(row+1)*4096],b'\xff'*(4096-28))
  self.assertEqual(pixels[5*4096:],b'\xff'*(len(pixels)-5*4096))
 def test_standard_library_blend_has_no_hard_seam_and_keeps_boundaries(self):
  width,height=1792,3;stitch=NativeAlphaStitcher(width,height)
  for index,tile in enumerate(tile_plan(width,height)):stitch.add(tile,array('f',[float(index)])*(1024*1024))
  alpha=stitch.finish();self.assertEqual(len(alpha),width*height)
  for row in range(height):
   line=alpha[row*width:(row+1)*width];self.assertEqual(line[0],0);self.assertEqual(line[-1],1);self.assertLessEqual(max(abs(b-a)for a,b in zip(line,line[1:])),1/256+.000001)
   self.assertAlmostEqual(line[768],.5/256,places=6);self.assertAlmostEqual(line[1023],255.5/256,places=6)
 def test_missing_coverage_fails_instead_of_fabricating_alpha(self):
  stitch=NativeAlphaStitcher(1500,2);stitch.add((0,0,1024,2),array('f',[.5])*(1024*1024))
  with self.assertRaisesRegex(ValueError,'every source pixel'):stitch.finish()
 def test_explicit_limit_does_not_silently_resize(self):
  self.assertTrue(tile_plan(8000,8000));self.assertEqual(8000*8000,MAX_PIXELS)
  for width,height in [(8001,8000),(0,4),(-1,4)]:
   with self.assertRaises(ValueError):tile_plan(width,height)
 @unittest.skipIf(np is None,'NumPy unavailable; pure source/geometry controls still run')
 def test_actual_pipeline_input_contains_all_source_rgb_and_exact_alpha_coordinates(self):
  for width,height in [(1291,37),(37,1291),(1031,1033)]:
   source=source_rgba(width,height);before=bytes(source);plan=tile_plan(width,height);seen=bytearray(width*height);progress=[];calls=[]
   mean=np.asarray([.485,.456,.406],dtype=np.float32);std=np.asarray([.229,.224,.225],dtype=np.float32)
   def fake_predict(model_input,index,total):
    self.assertEqual(model_input.shape,(1,3,1024,1024));self.assertEqual(total,len(plan));calls.append(index)
    rgb=np.rint((model_input[0].transpose(1,2,0)*std+mean)*255).clip(0,255).astype(np.uint8);x,y,w,h=plan[index]
    expected=np.frombuffer(source,dtype=np.uint8).reshape(height,width,4)[y:y+h,x:x+w,:3];np.testing.assert_array_equal(rgb[:h,:w],expected)
    for row in range(h):seen[(y+row)*width+x:(y+row)*width+x+w]=b'\1'*w
    # Decode unique absolute(x,y) from sourceRGB; alpha identifies each source
    # pixel, so a misplaced last tile or swapped axes cannot accidentally pass.
    absolute_x=rgb[:,:,0].astype(np.int32)+256*(rgb[:,:,2].astype(np.int32)%16);absolute_y=rgb[:,:,1].astype(np.int32)+256*(rgb[:,:,2].astype(np.int32)//16)
    return np.clip((absolute_y*width+absolute_x)/(width*height-1),0,1).astype(np.float32)
   alpha=infer_native_rgba(source,width,height,fake_predict,np,on_progress=progress.append)
   expected=np.arange(width*height,dtype=np.float32).reshape(height,width)/(width*height-1)
   np.testing.assert_allclose(alpha,expected,atol=.000001,rtol=0);self.assertEqual(alpha.shape,(height,width));self.assertEqual(seen.count(0),0);self.assertEqual(bytes(source),before);self.assertEqual(calls,list(range(len(plan))))
   self.assertEqual([p['completed']for p in progress],list(range(len(plan)+1)));self.assertTrue(all(p['width']==width and p['height']==height and p['total']==len(plan)for p in progress))
 @unittest.skipIf(np is None,'NumPy unavailable; standard-library seam control still runs')
 def test_production_numpy_stitcher_matches_source_coordinate_seam_contract(self):
  width,height=1792,7;stitch=NativeAlphaStitcher(width,height,numpy=np)
  for index,tile in enumerate(tile_plan(width,height)):stitch.add(tile,np.full((1024,1024),index,dtype=np.float32))
  result=stitch.finish();self.assertEqual(result.shape,(height,width));self.assertEqual(float(result[0,0]),0);self.assertEqual(float(result[-1,-1]),1);self.assertLessEqual(float(np.max(np.abs(np.diff(result,axis=1)))),1/256+.000001)
 @unittest.skipIf(np is None,'NumPy unavailable')
 def test_native_padding_is_not_stretched_in_actual_model_input(self):
  source=source_rgba(7,5)
  def fake(model_input,index,total):
   mean=np.asarray([.485,.456,.406],dtype=np.float32);std=np.asarray([.229,.224,.225],dtype=np.float32);rgb=np.rint((model_input[0].transpose(1,2,0)*std+mean)*255).clip(0,255).astype(np.uint8)
   np.testing.assert_array_equal(rgb[:5,:7],np.frombuffer(source,dtype=np.uint8).reshape(5,7,4)[:,:,:3]);self.assertTrue(np.all(rgb[5:]==255));self.assertTrue(np.all(rgb[:5,7:]==255));return np.full((1024,1024),.375,dtype=np.float32)
  result=infer_native_rgba(source,7,5,fake,np);self.assertEqual(result.shape,(5,7));self.assertTrue(np.all(result==.375))

if __name__=='__main__':unittest.main(verbosity=2)
