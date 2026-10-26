"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * The escrow lifecycle in one scene: a glass vault holds the MUSD core; four milestone rings lock
 * it. Rings unlock one after another (indigo → cyan) and each unlock sends a stream of tokens along
 * the arc to the freelancer node. After the last milestone the cycle resets.
 */

const HELD = new THREE.Color("#8b83ff");
const PAID = new THREE.Color("#2fc6f6");
const STEP_SECONDS = 2.6;
export const MILESTONES = [
  { label: "UI design", amount: "40" },
  { label: "Frontend", amount: "60" },
  { label: "Backend", amount: "60" },
  { label: "Final delivery", amount: "40" },
];

const VAULT = new THREE.Vector3(-0.6, 0, 0);
const FREELANCER = new THREE.Vector3(2.55, -0.55, 0.2);
const CURVE = new THREE.CubicBezierCurve3(
  new THREE.Vector3(-0.15, 0.15, 0),
  new THREE.Vector3(0.7, 1.55, 0.4),
  new THREE.Vector3(1.9, 1.0, 0.3),
  FREELANCER.clone().add(new THREE.Vector3(0, 0.35, 0)),
);
const COINS = 28;
const dummy = new THREE.Object3D();
const tmp = new THREE.Vector3();

function Rig({ onStep }: { onStep?: (i: number) => void }) {
  const group = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const core = useRef<THREE.Mesh>(null);
  const coins = useRef<THREE.InstancedMesh>(null);
  const freelancerGlow = useRef<THREE.Mesh>(null);
  const lastStep = useRef(-1);
  const coinState = useRef(Array.from({ length: COINS }, (_, i) => ({ t: -1, speed: 0.55 + ((i * 0.618) % 1) * 0.25, wobble: ((i * 0.377) % 1) * Math.PI * 2 })));
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const cycle = STEP_SECONDS * (MILESTONES.length + 1.4);
    const local = t % cycle;
    const step = Math.floor(local / STEP_SECONDS); // 0..4 (4 = all released, pause)
    const within = (local % STEP_SECONDS) / STEP_SECONDS;

    if (step !== lastStep.current) {
      lastStep.current = step;
      onStep?.(Math.min(step, MILESTONES.length));
      if (step < MILESTONES.length) {
        // launch a burst of tokens for this milestone
        let launched = 0;
        for (const c of coinState.current) {
          if (c.t < 0 && launched < 7) {
            c.t = -launched * 0.07;
            launched++;
          }
        }
      }
    }

    // rings: released ones are cyan, open wider and spin; the active one animates its unlock
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const mat = ring.material as THREE.MeshStandardMaterial;
      const released = i < step || (i === step && within > 0.35 && step < MILESTONES.length);
      const progress = i < step ? 1 : i === step ? THREE.MathUtils.smoothstep(within, 0.15, 0.5) : 0;
      mat.color.copy(HELD).lerp(PAID, progress);
      mat.emissive.copy(HELD).lerp(PAID, progress);
      mat.emissiveIntensity = 0.35 + progress * 0.9;
      const s = 1 + progress * 0.1;
      ring.scale.set(s, s, 1);
      ring.rotation.z += delta * (released ? 1.4 : 0.25) * (i % 2 ? -1 : 1);
      mat.opacity = 1 - progress * 0.35;
    });

    // core shrinks as funds leave the vault
    if (core.current) {
      const remaining = 1 - Math.min(step, MILESTONES.length) / MILESTONES.length;
      const target = 0.42 + remaining * 0.38;
      const cur = core.current.scale.x;
      const next = THREE.MathUtils.damp(cur, target, 3, delta);
      core.current.scale.setScalar(next + Math.sin(t * 2) * 0.012);
    }

    // tokens travel the arc to the freelancer
    if (coins.current) {
      coinState.current.forEach((c, i) => {
        if (c.t >= 0 || c.t > -1) c.t += delta * c.speed * (c.t < 0 ? 1 : 0.62);
        if (c.t > 1) c.t = -1;
        if (c.t >= 0 && c.t <= 1) {
          CURVE.getPoint(c.t, tmp);
          tmp.y += Math.sin(c.wobble + t * 3) * 0.04;
          dummy.position.copy(tmp);
          dummy.rotation.set(Math.PI / 2, t * 4 + c.wobble, 0);
          const sc = Math.sin(Math.PI * c.t) * 0.9 + 0.1;
          dummy.scale.setScalar(sc);
        } else {
          dummy.position.copy(VAULT);
          dummy.scale.setScalar(0);
        }
        dummy.updateMatrix();
        coins.current!.setMatrixAt(i, dummy.matrix);
      });
      coins.current.instanceMatrix.needsUpdate = true;
    }

    if (freelancerGlow.current) {
      const m = freelancerGlow.current.material as THREE.MeshStandardMaterial;
      const pulse = step < MILESTONES.length && within > 0.45 && within < 0.95 ? 1 : 0;
      m.emissiveIntensity = THREE.MathUtils.damp(m.emissiveIntensity, 0.4 + pulse * 1.2, 4, delta);
    }

    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, pointer.current.x * 0.08, 2, delta);
      group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, 0.08 + pointer.current.y * 0.04, 2, delta);
    }
  });

  return (
    <group ref={group}>
      {/* vault capsule */}
      <group position={VAULT.toArray()}>
        <mesh>
          <capsuleGeometry args={[0.92, 1.25, 12, 48]} />
          <meshPhysicalMaterial color="#9fb5ff" transparent opacity={0.16} roughness={0.08} metalness={0.1} clearcoat={1} clearcoatRoughness={0.1} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <mesh ref={core}>
          <icosahedronGeometry args={[1, 3]} />
          <meshStandardMaterial color="#8b83ff" emissive="#6f66f2" emissiveIntensity={0.9} roughness={0.25} metalness={0.4} />
        </mesh>
        {MILESTONES.map((_, i) => (
          <mesh key={i} ref={(el) => void (rings.current[i] = el)} position={[0, 0.84 - i * 0.56, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.08, 0.045, 16, 96, Math.PI * 1.82]} />
            <meshStandardMaterial color="#8b83ff" emissive="#8b83ff" emissiveIntensity={0.35} roughness={0.3} metalness={0.6} transparent />
          </mesh>
        ))}
      </group>
      {/* token stream */}
      <instancedMesh ref={coins} args={[undefined, undefined, COINS]}>
        <cylinderGeometry args={[0.09, 0.09, 0.025, 24]} />
        <meshStandardMaterial color="#2fc6f6" emissive="#16a6d6" emissiveIntensity={0.9} metalness={0.7} roughness={0.25} />
      </instancedMesh>
      {/* freelancer node */}
      <group position={FREELANCER.toArray()}>
        <mesh position={[0, -0.12, 0]}>
          <cylinderGeometry args={[0.42, 0.5, 0.16, 48]} />
          <meshStandardMaterial color="#34477a" emissive="#1b2950" emissiveIntensity={0.6} metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh ref={freelancerGlow} position={[0, 0.22, 0]}>
          <sphereGeometry args={[0.2, 32, 32]} />
          <meshStandardMaterial color="#2fc6f6" emissive="#2fc6f6" emissiveIntensity={0.4} roughness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

export default function VaultScene({ onStep }: { onStep?: (i: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const visible = useRef(true);
  const frameloop = useFrameloop(wrap, visible);
  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        frameloop={frameloop}
        dpr={[1, 1.75]}
        camera={{ position: [0.95, 0.5, 8.4], fov: 36 }}
        onCreated={({ camera }) => camera.lookAt(0.95, 0.05, 0)}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        aria-hidden
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 4, 5]} intensity={1.4} color="#cfe0ff" />
        <pointLight position={[-2.5, 1, 2]} intensity={14} color="#8b83ff" distance={8} />
        <pointLight position={[3, -1, 2]} intensity={10} color="#2fc6f6" distance={7} />
        <Rig onStep={onStep} />
      </Canvas>
    </div>
  );
}


/** Pause rendering when the hero is off-screen or the tab is hidden. */
function useFrameloop(ref: RefObject<HTMLDivElement | null>, visible: React.MutableRefObject<boolean>) {
  const [mode, setMode] = useState<"always" | "never">("always");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let onScreen = true;
    const update = () => setMode(onScreen && document.visibilityState === "visible" ? "always" : "never");
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      visible.current = onScreen;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref, visible]);
  return mode;
}
