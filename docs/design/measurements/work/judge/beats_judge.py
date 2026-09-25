# Re-run the story-first beat footprint model (beats.py, unchanged) for this synthesis:
# surface data tiles (height int16 + coast SDF u8), Lmax 6 vs 7, three quality tiers.
# Planning bytes per stored tile by level (gzip), from hlevels.json (height) + coastfield2.json (coast): [E]
import sys, json, math
sys.path.insert(0,'.')
import beats as B
KB={0:45,1:45,2:45,3:45,4:45,5:40,6:50,7:55}
TIERS={'High (DPR2, texel<=1.25 dev px)':(2,1.25),'Medium (DPR2 @1.5 scale, texel<=1.67 dev px)':(2,1.67),'Low (DPR1, texel<=1.5 px)':(1,1.5)}
def mb(ts): return sum(KB[t[1]] for t in ts)/1000
out={}
for Lmax in (6,7):
  for tname,(dpr,bias) in TIERS.items():
    base=set((f,l,i,j) for f in range(6) for l in range(2) for i in range(2**l) for j in range(2**l))  # pinned L0-L1
    per_beat=[]; crit=[]; views=[]; stories={}
    for sid,beats in B.STORIES.items():
        res=set(base); smb=0
        for k,(name,lat,lon,w,tilt) in enumerate(beats):
            _,full=B.view_tiles(lat,lon,w,tilt,dpr,bias,Lmax=Lmax)
            _,cr=B.view_tiles(lat,lon,w,tilt,dpr,2*bias,Lmax=Lmax)
            new=full-res; cn=cr-res
            per_beat.append((len(new),mb(new))); crit.append((len(cn),mb(cn))); views.append(len(full))
            smb+=mb(new); res|=full
        stories[sid]=round(smb,1)
    def stat(v,i):
        s=sorted(x[i] for x in v); return dict(median=round(s[len(s)//2],2),p90=round(s[int(len(s)*0.9)],2),max=round(s[-1],2))
    r=dict(new_tiles=stat(per_beat,0),new_MB=stat(per_beat,1),crit_tiles=stat(crit,0),crit_MB=stat(crit,1),
           view_tiles_with_anc=dict(median=sorted(views)[len(views)//2],max=max(views)),story_MB=stories)
    out[f'Lmax{Lmax} | {tname}']=r
    print(f'Lmax{Lmax} | {tname}\n  ',json.dumps(r),flush=True)
json.dump(out,open('../judge/beats_judge.json','w'),indent=1)
