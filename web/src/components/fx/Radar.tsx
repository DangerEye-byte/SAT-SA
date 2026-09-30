// Adapted from React Bits (https://reactbits.dev), MIT + Commons Clause, (c) 2026 David Haz. See NOTICE.md.
// Changes for SAT-SA: renders only while on screen (IntersectionObserver), caps the pixel ratio, draws a
// single still frame under reduced motion, and fails silently (CSS backdrop remains) without WebGL.
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

interface RadarProps {
  speed?: number; scale?: number; ringCount?: number; spokeCount?: number; ringThickness?: number; spokeThickness?: number;
  sweepSpeed?: number; sweepWidth?: number; sweepLobes?: number; color?: string; backgroundColor?: string; falloff?: number;
  brightness?: number; enableMouseInteraction?: boolean; mouseInfluence?: number; lightMode?: boolean; still?: boolean; className?: string;
}

function hexToVec3(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 0, 1); }
`;

const fragmentShader = `
precision highp float;
uniform float uTime; uniform vec3 uResolution; uniform float uSpeed; uniform float uScale; uniform float uRingCount;
uniform float uSpokeCount; uniform float uRingThickness; uniform float uSpokeThickness; uniform float uSweepSpeed;
uniform float uSweepWidth; uniform float uSweepLobes; uniform vec3 uColor; uniform vec3 uBgColor; uniform bool uLightMode;
uniform float uFalloff; uniform float uBrightness; uniform vec2 uMouse; uniform float uMouseInfluence; uniform bool uEnableMouse;
#define TAU 6.28318530718
void main() {
  vec2 st = gl_FragCoord.xy / uResolution.xy;
  st = st * 2.0 - 1.0;
  st.x *= uResolution.x / uResolution.y;
  if (uEnableMouse) { vec2 mShift = (uMouse * 2.0 - 1.0); mShift.x *= uResolution.x / uResolution.y; st -= mShift * uMouseInfluence; }
  st *= uScale;
  float dist = length(st);
  float theta = atan(st.y, st.x);
  float t = uTime * uSpeed;
  float ringPhase = dist * uRingCount - t;
  float ringDist = abs(fract(ringPhase) - 0.5);
  float ringGlow = 1.0 - smoothstep(0.0, uRingThickness, ringDist);
  float spokeAngle = abs(fract(theta * uSpokeCount / TAU + 0.5) - 0.5) * TAU / uSpokeCount;
  float arcDist = spokeAngle * dist;
  float spokeGlow = (1.0 - smoothstep(0.0, uSpokeThickness, arcDist)) * smoothstep(0.0, 0.1, dist);
  float sweepPhase = t * uSweepSpeed;
  float sweepBeam = pow(max(0.5 * sin(uSweepLobes * theta + sweepPhase) + 0.5, 0.0), uSweepWidth);
  float fade = smoothstep(1.05, 0.85, dist) * pow(max(1.0 - dist, 0.0), uFalloff);
  float intensity = max((ringGlow + spokeGlow + sweepBeam) * fade * uBrightness, 0.0);
  vec3 signal = uColor * intensity;
  vec3 col;
  if (uLightMode) {
    vec3 mapped = vec3(1.0) - exp(-max(signal, vec3(0.0)) * 1.45);
    float energy = clamp(max(mapped.r, max(mapped.g, mapped.b)), 0.0, 1.0);
    vec3 hue = mapped / max(energy, 0.0001);
    hue = pow(clamp(hue, 0.0, 1.0), vec3(1.2));
    col = mix(uBgColor, hue, smoothstep(0.015, 0.8, energy) * 0.96);
    gl_FragColor = vec4(col, 1.0);
  } else {
    col = signal + uBgColor;
    float alpha = clamp(length(col), 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
}
`;

export default function Radar({
  speed = 1.0, scale = 0.5, ringCount = 10.0, spokeCount = 10.0, ringThickness = 0.05, spokeThickness = 0.01,
  sweepSpeed = 1.0, sweepWidth = 2.0, sweepLobes = 1.0, color = "#5b96ff", backgroundColor = "#070b14", falloff = 2.0,
  brightness = 1.0, enableMouseInteraction = true, mouseInfluence = 0.1, lightMode = false, still = false, className = "",
}: RadarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: Renderer;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: false, dpr: Math.min(window.devicePixelRatio || 1, 1.5) });
    } catch { return; }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const currentMouse = [0.5, 0.5];
    let targetMouse = [0.5, 0.5];
    const program = new Program(gl, {
      vertex: vertexShader, fragment: fragmentShader,
      uniforms: {
        uTime: { value: 4.2 }, uResolution: { value: [1, 1, 1] }, uSpeed: { value: speed }, uScale: { value: scale },
        uRingCount: { value: ringCount }, uSpokeCount: { value: spokeCount }, uRingThickness: { value: ringThickness },
        uSpokeThickness: { value: spokeThickness }, uSweepSpeed: { value: sweepSpeed }, uSweepWidth: { value: sweepWidth },
        uSweepLobes: { value: sweepLobes }, uColor: { value: hexToVec3(color) }, uBgColor: { value: hexToVec3(backgroundColor) },
        uLightMode: { value: lightMode }, uFalloff: { value: falloff }, uBrightness: { value: brightness },
        uMouse: { value: new Float32Array([0.5, 0.5]) }, uMouseInfluence: { value: mouseInfluence }, uEnableMouse: { value: enableMouseInteraction },
      },
    });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    const resize = () => {
      renderer.setSize(container.offsetWidth, container.offsetHeight);
      program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height];
      if (still || !running) renderer.render({ scene: mesh });
    };
    container.appendChild(gl.canvas);
    const onMove = (e: MouseEvent) => {
      const r = gl.canvas.getBoundingClientRect();
      targetMouse = [(e.clientX - r.left) / r.width, 1.0 - (e.clientY - r.top) / r.height];
    };
    const onLeave = () => { targetMouse = [0.5, 0.5]; };
    if (enableMouseInteraction && !still) { window.addEventListener("mousemove", onMove); container.addEventListener("mouseleave", onLeave); }

    let raf = 0, running = false, t0 = performance.now() - 4200;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      program.uniforms.uTime.value = (now - t0) * 0.001;
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
      program.uniforms.uMouse.value[0] = currentMouse[0];
      program.uniforms.uMouse.value[1] = currentMouse[1];
      renderer.render({ scene: mesh });
    };
    const start = () => { if (!running && !still) { running = true; raf = requestAnimationFrame(frame); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    renderer.render({ scene: mesh });
    const io = new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? start() : stop()));
    io.observe(container);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop(); io.disconnect(); ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      t0 = 0;
    };
  }, [speed, scale, ringCount, spokeCount, ringThickness, spokeThickness, sweepSpeed, sweepWidth, sweepLobes, color, backgroundColor, falloff, brightness, enableMouseInteraction, mouseInfluence, lightMode, still]);

  return <div ref={containerRef} className={`sa-radar ${className}`} aria-hidden="true" />;
}
