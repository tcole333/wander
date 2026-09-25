# Story-first footprint model: for drafted beats of the 5 v1 stories, compute the cube-tile set each
# beat view needs (visible + ancestors), the delta vs. what is already resident, the break-out
# neighbourhood, and the extra tiles a van Wijk-Nuij flight between beats touches.
# Tiles: 256 px, equal-angle cube, L0..L7; L>=5 stored only where land/shelf (else L4 ancestor is used).
import numpy as np, json, math
R=6371.0
MAXE=np.load('l7_maxelev.npy')                     # (6,128,128) max elevation per L7 tile
SHELF={7:MAXE>-200}
for L in (6,5):
    m=SHELF[L+1]; n=m.shape[1]//2
    SHELF[L]=m.reshape(6,n,2,n,2).any(axis=(2,4))
def stored(f,l,i,j):                                 # i=col(u) j=row(v)
    return l<=4 or bool(SHELF[l][f,j,i])
def to_face(p):
    x,y,z=p[...,0],p[...,1],p[...,2]; ax=np.abs(p).argmax(-1)
    f=np.empty(ax.shape,int); u=np.empty(ax.shape); v=np.empty(ax.shape)
    m=(ax==0)&(x>0); f[m]=0; u[m]=-z[m]/x[m]; v[m]=y[m]/x[m]
    m=(ax==0)&(x<=0); f[m]=1; u[m]=z[m]/-x[m]; v[m]=y[m]/-x[m]
    m=(ax==1)&(y>0); f[m]=2; u[m]=x[m]/y[m]; v[m]=-z[m]/y[m]
    m=(ax==1)&(y<=0); f[m]=3; u[m]=x[m]/-y[m]; v[m]=z[m]/-y[m]
    m=(ax==2)&(z>0); f[m]=4; u[m]=x[m]/z[m]; v[m]=y[m]/z[m]
    m=(ax==2)&(z<=0); f[m]=5; u[m]=-x[m]/-z[m]; v[m]=y[m]/-z[m]
    return f,np.arctan(u)/(np.pi/4),np.arctan(v)/(np.pi/4)
def unit(lat,lon):
    la,lo=math.radians(lat),math.radians(lon)
    return np.array([math.cos(la)*math.sin(lo),math.sin(la),math.cos(la)*math.cos(lo)])
def view_tiles(lat,lon,view_km,tilt=0.0,dpr=2,bias=1.0,T=256,Lmax=7,step=6):
    Wpx,Hpx=1440,900; fov=math.radians(30); hfov=2*math.atan(math.tan(fov/2)*Wpx/Hpx)
    alt=view_km/2/math.tan(hfov/2)
    nad=unit(lat,lon); lo=math.radians(lon); la=math.radians(lat)
    east=np.array([math.cos(lo),0,-math.sin(lo)]); north=np.array([-math.sin(la)*math.sin(lo),math.cos(la),-math.sin(la)*math.cos(lo)])
    t=math.radians(tilt); cam=nad*(R+alt)
    fwd=-math.cos(t)*nad+math.sin(t)*north; up=math.sin(t)*nad+math.cos(t)*north; right=np.cross(fwd,up)
    xs=(np.arange(0,Wpx,step)+0.5)/Wpx*2-1; ys=(np.arange(0,Hpx,step)+0.5)/Hpx*2-1
    X,Y=np.meshgrid(xs,ys)
    d=fwd+X[...,None]*math.tan(hfov/2)*right+(-Y[...,None])*math.tan(fov/2)*up
    d/=np.linalg.norm(d,axis=-1,keepdims=True)
    b=(d@cam); c=cam@cam-R*R; disc=b*b-c; hit=disc>0
    tt=-b-np.sqrt(np.where(hit,disc,0)); P=cam+tt[...,None]*d
    pixang=(fov/Hpx)/dpr; nrm=P/R; cosi=np.abs((nrm*d).sum(-1)); foot=tt*pixang/np.maximum(cosi,0.05)
    texel0=90/T*111.32
    Lv=np.clip(np.ceil(np.log2(texel0/np.maximum(foot*bias,1e-6))),0,Lmax).astype(int)
    P=P[hit]; Lv=Lv[hit]
    f,ua,va=to_face(P/R)
    tiles=set()
    for fi,a,bb,l in zip(f,ua,va,Lv):
        n=2**l; i=min(n-1,int((a+1)/2*n)); j=min(n-1,int((bb+1)/2*n))
        while not stored(fi,l,i,j): l-=1; i//=2; j//=2
        tiles.add((int(fi),l,i,j))
    full=set(tiles)
    for (fi,l,i,j) in tiles:
        while l>0: l-=1; i//=2; j//=2; full.add((fi,l,i,j))
    return tiles,full
def gc_interp(p0,p1,frac):
    om=math.acos(max(-1,min(1,float(p0@p1))))
    if om<1e-9: return p0
    return (math.sin((1-frac)*om)*p0+math.sin(frac*om)*p1)/math.sin(om)
def latlon(p): return math.degrees(math.asin(p[1])), math.degrees(math.atan2(p[0],p[2]))
def flight(b0,b1,rho=1.42,samples=24):
    p0,p1=unit(b0['lat'],b0['lon']),unit(b1['lat'],b1['lon'])
    u1=R*math.acos(max(-1,min(1,float(p0@p1)))); w0,w1=b0['w'],b1['w']
    if u1<1: # pure zoom
        S=abs(math.log(w1/w0))/rho; path=[(0,p0,w0)]
        for k in range(1,samples+1):
            s=k/samples; path.append((s,p0,w0*(w1/w0)**s))
        return S,path
    def bb(i):
        wi=(w0,w1)[i]; return (w1*w1-w0*w0+(-1)**i*rho**4*u1*u1)/(2*wi*rho*rho*u1)
    r0=math.log(-bb(0)+math.sqrt(bb(0)**2+1)); r1=math.log(-bb(1)+math.sqrt(bb(1)**2+1))
    S=(r1-r0)/rho; path=[]
    for k in range(samples+1):
        s=S*k/samples
        us=w0/rho**2*math.cosh(r0)*math.tanh(rho*s+r0)-w0/rho**2*math.sinh(r0)
        ws=w0*math.cosh(r0)/math.cosh(rho*s+r0)
        path.append((k/samples,gc_interp(p0,p1,us/u1),min(ws,14000)))
    return S,path
KB=34.0     # stored tile set (albedo+ORM+normal ETC1S q128 w/ mips, runtime detail noise) + 33x33 height grid
GPU_KIB=175 # BC1 albedo+ORM + BC7 normal, with mips (all-BC7 worst case = 262)
G=14000
STORIES={
 'tambora':[('world Apr 1815',-8.25,118.0,G,0),('Sunda region',-8.25,118.0,1500,20),('Sumbawa close',-8.25,118.0,300,45),
            ('ash over Java/Bali',-8.0,114.5,1500,30),('global veil',-5,100,G,0),('Europe 1816',50,10,5000,15),('New England 1816',43,-72,1500,20),('Yunnan/Bengal 1817',24,95,5000,15)],
 'oil':[('Abadan 1933',30.34,48.3,600,30),('Gulf region',29,50,1500,20),('Tampico 1938',22.2,-97.9,600,30),('Mexico',21,-99,1500,20),
        ('Abadan 1951',30.34,48.3,300,45),('Tehran 1953',35.7,51.4,600,30),('1973 embargo world',30,20,G,0),('tanker routes',25,20,5000,15)],
 'magellan':[('Sanlucar 1519',36.8,-6.35,600,30),('Atlantic crossing',0,-30,G,0),('Rio 1519',-22.9,-43.2,1500,20),('San Julian 1520',-49.3,-67.7,600,30),
             ('Strait 1520',-53.5,-71,300,45),('Pacific crossing',-10,-140,G,0),('Mactan 1521',10.3,124.0,300,45),('Tidore 1521',0.7,127.4,600,30),
             ('Cape route home',-20,40,G,0),('Sanlucar 1522',36.8,-6.35,600,30)],
 'plague':[('Caffa 1346',45.0,35.4,600,30),('Black Sea 1347',42,32,1500,20),('Messina 1347',38.2,15.55,600,30),('Mediterranean 1348',42,12,5000,15),
           ('Florence 1348',43.77,11.25,300,45),('Paris/England 1348',49,0,1500,20),('Baltic 1349',58,15,1500,20),('Europe 1351',50,20,5000,15)],
 'goldrush':[('Sutters Mill 1848',38.8,-120.9,300,45),('San Francisco',37.8,-122.4,600,30),('routes to CA',10,-90,G,0),('Panama',9,-79.5,600,30),
             ('overland trails',40,-100,5000,15),('Guangdong 1852',23,113,1500,20),('Sierra camps',39,-121,600,30)],
}
def run(dpr,bias,label):
    base=set()
    for fi in range(6):
        for l in range(3):
            for i in range(2**l):
                for j in range(2**l): base.add((fi,l,i,j))
    out={'config':label,'base_tiles':len(base),'stories':{}}
    for sid,beats in STORIES.items():
        res=set(base); rows=[]; story_new=0
        for k,(name,lat,lon,w,tilt) in enumerate(beats):
            vis,full=view_tiles(lat,lon,w,tilt,dpr,bias)
            new=full-res
            # flight from previous beat
            fl_extra=0; S=0; first_fine=None
            if k>0:
                pb=dict(lat=beats[k-1][1],lon=beats[k-1][2],w=beats[k-1][3]); cb=dict(lat=lat,lon=lon,w=w)
                S,path=flight(pb,cb)
                fl=set()
                for s,p,ws in path[1:-1]:
                    la,lo=latlon(p); tv,tf=view_tiles(la,lo,ws,0,dpr,bias,step=12)
                    fl|=tf
                    if first_fine is None and any(t in new for t in tf): first_fine=s
                fl_extra=len(fl-res-full)
            # break-out neighbourhood: zoom out x2, zoom in x0.5, pan +-0.5 view E/W/N/S
            nb=set()
            dlat=(w*0.5)/111.32; dlon=dlat/max(0.2,math.cos(math.radians(lat)))
            for (la,lo,ww) in ((lat,lon,min(G,w*2)),(lat,lon,max(150,w/2)),(lat+dlat,lon,w),(lat-dlat,lon,w),(lat,lon+dlon,w),(lat,lon-dlon,w)):
                la=max(-85,min(85,la)); _,f2=view_tiles(la,lo,ww,tilt,dpr,bias,step=10); nb|=f2
            nb_new=nb-res-full
            rows.append(dict(beat=k+1,name=name,view_km=w,tilt=tilt,visible=len(vis),with_anc=len(full),
                             new_tiles=len(new),new_MB=round(len(new)*KB/1000,2),
                             flight_S=round(S,2),flight_s_at_speed1_2=round(S/1.2,2) if S else 0,
                             flight_extra_tiles=fl_extra,first_fine_at=first_fine,
                             breakout_new_tiles=len(nb_new),breakout_MB=round(len(nb_new)*KB/1000,2),
                             gpu_MiB_view=round(len(full)*GPU_KIB/1024,1)))
            res|=full; story_new+=len(new)
        out['stories'][sid]=dict(beats=rows,story_unique_tiles=len(res)-len(base),story_MB=round((len(res)-len(base))*KB/1000,1))
    return out
if __name__=='__main__':
    allr=[]
    for dpr,bias,label in ((2,1.0,'DPR2 sharp (texel<=1 device px)'),(2,1.5,'DPR2 bias 1.5 (texel<=1.5 device px)'),(1,1.0,'DPR1 sharp')):
        r=run(dpr,bias,label); allr.append(r)
        print('=== ',label,' base tiles',r['base_tiles'],' base MB',round(r['base_tiles']*KB/1000,1))
        for sid,s in r['stories'].items():
            print(f"  {sid}: unique story tiles {s['story_unique_tiles']}  ~{s['story_MB']} MB")
            for b in s['beats']:
                print(f"    {b['beat']:2d} {b['name']:<20} w={b['view_km']:>5} vis={b['visible']:>3} anc={b['with_anc']:>3} new={b['new_tiles']:>3} ({b['new_MB']:>5} MB) flightS={b['flight_S']:>5} extra={b['flight_extra_tiles']:>3} fineAt={b['first_fine_at']} breakout+={b['breakout_new_tiles']:>3} ({b['breakout_MB']} MB) gpu={b['gpu_MiB_view']} MiB")
    json.dump(allr,open('beats.json','w'),indent=1)
