import { Canvas, useFrame, type RootState } from '@react-three/fiber';
import { useRef } from 'react';
import { PMREMGenerator, type Group } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BRASS = '#b58a4c';
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Metals need something to reflect; a procedural room keeps this free of network fetches.
function lightMuseum({ gl, scene }: RootState) {
  const pmrem = new PMREMGenerator(gl);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.6;
  room.dispose();
  pmrem.dispose();
}

function Orrery() {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.15;
  });
  return (
    <group ref={group} rotation={[0.35, 0, 0]}>
      <mesh>
        <sphereGeometry args={[1, 96, 48]} />
        <meshStandardMaterial color={BRASS} metalness={0.9} roughness={0.35} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.35, 0.025, 16, 160]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
      </mesh>
      <mesh rotation={[0, 0, 0.41]}>
        <torusGeometry args={[1.5, 0.02, 16, 160]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
      </mesh>
    </group>
  );
}

export function App() {
  return (
    <>
      <Canvas
        gl={{ antialias: false }}
        camera={{ position: [0, 0.4, 4.8], fov: 40 }}
        frameloop={prefersReducedMotion ? 'demand' : 'always'}
        onCreated={lightMuseum}
      >
        <color attach="background" args={['#0d0b09']} />
        <hemisphereLight args={['#fff4e0', '#1a120a', 0.6]} />
        <directionalLight position={[3, 4, 5]} intensity={2.4} color="#ffe2b0" />
        <Orrery />
      </Canvas>
      <h1 className="wordmark">Wander</h1>
    </>
  );
}
