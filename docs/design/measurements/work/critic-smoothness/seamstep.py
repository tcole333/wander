# Seam step between a node displaced from its own data and a neighbour displaced from a coarse ancestor.
# Proxy: ETOPO 2022 60s (1.85 km) box-averaged to ~2 km ("own data at mip 2 of L6" = 2.45 km) vs box-averaged to
# ~19 km and bilinearly upsampled ("L3 ancestor at mip 2" = 19.6 km). Displacement = max(h,0).
import sys, json, numpy as np, netCDF4
from scipy.ndimage import zoom
ds=netCDF4.Dataset('/Users/travcole/projects/wander-data/sources/noaa-etopo-2022-60s/ETOPO_2022_v1_60s_N90W180_surface.nc')
lat=ds['lat'][:]; lon=ds['lon'][:]; z=ds['z']
def win(la0,la1,lo0,lo1):
    i0,i1=np.searchsorted(lat,la0),np.searchsorted(lat,la1); j0,j1=np.searchsorted(lon,lo0),np.searchsorted(lon,lo1)
    return np.asarray(z[i0:i1,j0:j1],dtype=np.float32)
R={'Himalaya':(26,31,82,92),'Andes':(-22,-14,-72,-64),'Sumbawa':(-9.2,-7.8,116.5,119.5),'Alps':(44.5,47.5,5,12),'Sierra Nevada':(36,40,-122,-117)}
out={}
for name,(a,b,c,d) in R.items():
    h=np.maximum(win(a,b,c,d),0)
    n=int(sys.argv[1]) if len(sys.argv)>1 else 10; H,W=(h.shape[0]//n)*n,(h.shape[1]//n)*n; h=h[:H,:W]
    coarse=h.reshape(H//n,n,W//n,n).mean(axis=(1,3))
    up=zoom(coarse,n,order=1)[:H,:W]
    diff=np.abs(h-up)[h>0]
    out[name]=dict(p50=float(np.percentile(diff,50)),p95=float(np.percentile(diff,95)),p99=float(np.percentile(diff,99)),max=float(diff.max()))
    print(name,{k:round(v) for k,v in out[name].items()})
json.dump(out,open('/private/tmp/claude-501/-Users-travcole-projects-everywhen/da182fa2-f188-4058-a209-cf508d854cb3/scratchpad/design/work/critic-smoothness/seamstep_n%s.json','w'),indent=1) if False else json.dump(out,open("/private/tmp/claude-501/-Users-travcole-projects-everywhen/da182fa2-f188-4058-a209-cf508d854cb3/scratchpad/design/work/critic-smoothness/seamstep_n"+str(n)+".json","w"),indent=1)
