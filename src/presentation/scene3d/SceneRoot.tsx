import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, Lightformer, type CameraControls } from '@react-three/drei';
import { palette } from '@/design-system/tokens/palette';
import { LAYOUT } from '@/domain/graph/layout';
import type { LabelDensity } from '@/presentation/state/uiStore';
import { Brain } from './brain/Brain';
import { CameraRig, type ViewProfile } from './camera/CameraRig';
import { AdaptiveResolution } from './AdaptiveResolution';
import { ViewOffset } from './camera/ViewOffset';
import { Connections } from './connections/Connections';
import { Halo } from './nodes/Halo';
import { LabelLayer } from './nodes/LabelLayer';
import { NodeField } from './nodes/NodeField';
import { Dust } from './orbit/Dust';
import { OrbitShells } from './orbit/OrbitShells';
import { recordFrame } from './runtime';
import type { Emphasis, SceneGraph } from './sceneModel';
import { useFrame } from '@react-three/fiber';

/** The scene's entire contract with the rest of the app. */
export interface SceneProps {
  graph: SceneGraph;
  emphasis: Emphasis;
  selectedIndex: number;
  hoveredIndex: number;
  linkSourceIndex: number;
  labelDensity: LabelDensity;
  reducedMotion: boolean;
  ambient: boolean;
  quality: 'high' | 'low';
  /** Horizontal projection shift (px) to keep the scene centred beside open panels. */
  viewOffsetPx: number;
  /** Camera composition profile (desktop / phone / 16:9 television). */
  viewProfile: ViewProfile;
  /** Label size multiplier (larger on TV for viewing distance). */
  labelScale: number;
  onHover(index: number | null): void;
  onSelect(index: number, opts: { double: boolean }): void;
  onBackground(): void;
  onReposition(index: number, position: [number, number, number]): void;
  onContextLost(): void;
}

function FrameMeter() {
  useFrame((_, delta) => recordFrame(delta));
  return null;
}

/** Drives demand-mode rendering for the optional ambient pulse, and pauses when hidden. */
function AmbientTicker({ enabled }: { enabled: boolean }) {
  const { invalidate, setFrameloop } = useThree();
  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? 'never' : 'demand');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [setFrameloop]);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (!document.hidden) invalidate();
    }, 1000 / 30);
    return () => window.clearInterval(id);
  }, [enabled, invalidate]);
  return null;
}

export default function SceneRoot(props: SceneProps) {
  const { graph, emphasis, selectedIndex, hoveredIndex, linkSourceIndex, reducedMotion, ambient, quality } = props;
  const controls = useRef<CameraControls | null>(null);
  const [ready, setReady] = useState(false);
  const animateBrain = ambient && !reducedMotion;
  const focusDim = emphasis.focusActive ? 1 : 0;

  return (
    <Canvas
      frameloop="demand"
      dpr={
        props.viewProfile === 'tv'
          ? Math.min(1.5, typeof window !== 'undefined' ? window.devicePixelRatio : 1)
          : quality === 'low'
            ? 1
            : [1, Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1)]
      }
      gl={{ antialias: quality === 'high', alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 42, near: 0.1, far: 320, position: [0, 11, 52] }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          props.onContextLost();
        });
        setReady(true);
      }}
      onPointerMissed={(e) => {
        if (e.button === 0) props.onBackground();
      }}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden="true"
      data-ready={ready ? 'true' : 'false'}
    >
      <fog attach="fog" args={[palette.obsidian, 60, 175]} />
      {/* Neutral, low-key studio light: soft top key, cool-grey rim, no warm or coloured fills. */}
      <ambientLight intensity={0.14} />
      <directionalLight position={[6, 9, 8]} intensity={1.25} color="#e9e7e3" />
      <directionalLight position={[-8, 3, -10]} intensity={1.3} color="#a3a9b0" />
      {/* Crisp, neutral "studio window" strips: they are what the brain's clear coat reflects, giving it a polished-glass read. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.6} color="#e6e8ea" position={[0, 7, 3]} scale={[12, 1.1, 1]} rotation={[Math.PI / 2.3, 0, 0]} />
        <Lightformer form="rect" intensity={1.6} color="#d2d5d8" position={[8, 1.5, 2]} scale={[0.6, 7, 1]} rotation={[0, -Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={1.1} color="#c8cbce" position={[8, 1.5, -1.2]} scale={[0.25, 7, 1]} rotation={[0, -Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={1.3} color="#9aa1a8" position={[-8, 2, -3]} scale={[1.2, 9, 1]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={0.35} color="#8e9399" position={[0, 0, 10]} scale={[16, 9, 1]} />
      </Environment>

      <Brain animate={animateBrain} dim={focusDim} quality={quality} />
      <OrbitShells radius={LAYOUT.primaryRadius} dim={focusDim} />
      <Dust count={quality === 'high' ? 700 : 300} />

      <Connections graph={graph} emphasis={emphasis} selectedIndex={selectedIndex} reducedMotion={reducedMotion} />
      <NodeField
        graph={graph}
        emphasis={emphasis}
        hoveredIndex={hoveredIndex}
        reducedMotion={reducedMotion}
        quality={quality}
        onHover={props.onHover}
        onSelect={props.onSelect}
        onDragEnd={props.onReposition}
        setControlsEnabled={(enabled) => {
          if (controls.current) controls.current.enabled = enabled;
        }}
      />
      {selectedIndex >= 0 ? <Halo graph={graph} index={selectedIndex} color={palette.emphasisBright} /> : null}
      {hoveredIndex >= 0 && hoveredIndex !== selectedIndex ? <Halo graph={graph} index={hoveredIndex} color={palette.steelBright} opacity={0.7} scale={1.6} /> : null}
      {linkSourceIndex >= 0 && linkSourceIndex !== selectedIndex ? <Halo graph={graph} index={linkSourceIndex} color={palette.emphasis} opacity={0.55} scale={2.1} /> : null}
      <LabelLayer graph={graph} emphasis={emphasis} selectedIndex={selectedIndex} hoveredIndex={hoveredIndex} density={props.labelDensity} labelScale={props.labelScale} />

      <CameraRig graph={graph} reducedMotion={reducedMotion} controlsRef={controls} profile={props.viewProfile} />
      {props.viewProfile === 'tv' ? <AdaptiveResolution max={Math.min(1.5, typeof window !== 'undefined' ? window.devicePixelRatio : 1)} /> : null}
      <ViewOffset px={props.viewOffsetPx} reducedMotion={reducedMotion} />
      <AmbientTicker enabled={animateBrain} />
      <FrameMeter />
    </Canvas>
  );
}
