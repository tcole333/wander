// What the look's vertex stage adds after the merged surface vertex chunk has run: the varyings the
// fragment reads. `wv` and `wanderDecode` come from the chunk (globe/surfaceVertex.glsl.ts).

/** Global declarations, after the chunk's pars. */
export const LOOK_VERTEX_PARS = /* glsl */ `
flat out int vLookSlot;
flat out int vLookSrc;
flat out int vLookFace;
flat out float vLookMid;
out vec2 vLookUv;
out vec2 vLookSt;
out vec3 vLookDir;
out float vLookH;
out vec3 vLookTs;
out vec3 vLookTt;
`;

/** Statements right after the chunk's mainStart, at the top of main (normalMatrix is a uniform). */
export const LOOK_VERTEX_MAIN = /* glsl */ `
  {
    WanderNode lookNode = wanderDecode(wanderNode);
    vLookSlot = lookNode.srcSlot;
    vLookSrc = lookNode.src;
    vLookFace = lookNode.face;
    vLookMid = lookNode.srcMid;
    vLookUv = wv.uv;
    vLookH = wv.last.h;
    vLookDir = wv.normal;
    // The face coordinates (s, t) of the lattice point, affine in (k, l) like the uv.
    ivec2 lookG = lookNode.xy * WANDER_G + ivec2(position.xy);
    vec2 st = vec2(lookG * 2) * wanderPow2(-(WANDER_LOG2G + lookNode.level)) - 1.0;
    vLookSt = st;
    // d(direction)/ds and d/dt in radians per unit s, t, turned into view space for the fragment.
    mat3 F = WANDER_FACE[lookNode.face];
    float a = tan(WANDER_QUARTER_PI * st.x);
    float b = tan(WANDER_QUARTER_PI * st.y);
    vec3 q = F * vec3(a, b, 1.0);
    float ql = length(q);
    vec3 dir = q / ql;
    vec3 dqs = F[0] * (WANDER_QUARTER_PI * (1.0 + a * a));
    vec3 dqt = F[1] * (WANDER_QUARTER_PI * (1.0 + b * b));
    vLookTs = normalMatrix * ((dqs - dir * dot(dir, dqs)) / ql);
    vLookTt = normalMatrix * ((dqt - dir * dot(dir, dqt)) / ql);
  }
`;
