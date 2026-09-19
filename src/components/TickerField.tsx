"use client";

/*
  MOTION REASON: a parsec is a parallax measurement, so the background is what parallax
  looks like. Three depth layers of ticker labels shift with the pointer at different rates.
  Far and mid carry the company tickers, near carries that company's on-chain wrappers, so
  depth reads as "company, then its wrappers up close". Scroll pulls the camera forward and
  at the end the field fades out into the footer.
*/

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { companies, wrappers } from "@/lib/registry";

const COMPANIES = companies.map((c) => c.ticker ?? c.id.toUpperCase());
const WRAPPERS = wrappers.map((w) => w.symbol);

interface Atlas {
  tex: THREE.CanvasTexture;
  map: Record<string, { rect: [number, number, number, number]; aspect: number }>;
}

interface LayerConfig {
  labels: string[];
  count: number;
  near: number;
  far: number;
  letter: number;
  alpha: number;
  color: THREE.Color;
  drift: number;
  amber: number;
  order: number;
}

export default function TickerField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const heroCopy = document.querySelector<HTMLElement>(".landing-hero-in")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "low-power" });
    } catch {
      setWebgl(false);
      return;
    }

    const PR = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1.5 : 2);
    renderer.setPixelRatio(PR);
    renderer.setClearColor(0xf7f6f1, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
    const TAN = Math.tan((60 * Math.PI) / 360); // half height per unit of depth

    /* ---------- one canvas atlas, every label drawn once ---------- */
    // draw the atlas at the near layer's device pixel size, so the largest labels sample 1:1
    // (no minification, no per-glyph coverage loss); mid and far layers minify with mipmaps.
    const FS = Math.round((coarsePointer ? 14 : 16.5) * PR);
    const CELL = Math.round(FS * 1.4);
    const PADX = Math.max(3, Math.round(FS / 6));
    const ATLAS_W = 1024;

    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono").trim();

    function buildAtlas(labels: string[]): Atlas {
      const c = document.createElement("canvas");
      let ctx = c.getContext("2d")!;
      const face = `500 ${FS}px ${mono}, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      const dress = (g: CanvasRenderingContext2D) => {
        g.font = face;
        g.letterSpacing = `${Math.max(1, Math.round(FS * 0.055))}px`;
        g.textBaseline = "middle";
        g.textAlign = "left";
        g.fillStyle = "#ffffff";
      };
      dress(ctx);
      const items = labels.map((t) => ({ t, w: Math.ceil(ctx.measureText(t).width) + PADX * 2, x: 0, y: 0 }));
      let x = 0, y = 0, rows = 1;
      for (const it of items) {
        if (x + it.w > ATLAS_W) { x = 0; y += CELL; rows++; }
        it.x = x; it.y = y; x += it.w;
      }
      c.width = ATLAS_W;
      c.height = rows * CELL;
      ctx = c.getContext("2d")!;
      dress(ctx);
      for (const it of items) ctx.fillText(it.t, it.x + PADX, it.y + CELL / 2);

      const map: Atlas["map"] = {};
      for (const it of items) {
        map[it.t] = {
          // flipY is on, so v runs from the bottom of the canvas
          rect: [it.x / ATLAS_W, 1 - (it.y + CELL) / c.height, it.w / ATLAS_W, CELL / c.height],
          aspect: it.w / CELL,
        };
      }
      const tex = new THREE.CanvasTexture(c);
      // near labels are downsampled 3x+ from the atlas cell; without mipmaps that minification
      // aliases per glyph stroke and reads as blotchy, uneven-weight text (seen in review)
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      return { tex, map };
    }

    /* ---------- instanced quads, screen space sized so letters stay legible ---------- */
    const VERT = `
      uniform float uZ;
      uniform float uNear;
      uniform float uFar;
      uniform float uFade;
      uniform vec2 uShift;
      uniform vec2 uViewport;
      attribute vec3 aPos;
      attribute vec4 aRect;
      attribute vec2 aPx;
      attribute float aAlpha;
      attribute vec3 aColor;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vC;
      void main(){
        float span = uFar - uNear;
        float d = uNear + mod(-aPos.z - uZ - uNear, span);
        vec4 mv = modelViewMatrix * vec4(aPos.x + uShift.x, aPos.y + uShift.y, -d, 1.0);
        vec4 clip = projectionMatrix * mv;
        clip.xy += position.xy * aPx / uViewport * 2.0 * clip.w;
        float inFar = 1.0 - smoothstep(uFar - span * 0.34, uFar, d);
        float inNear = smoothstep(uNear, uNear + span * 0.22, d);
        vUv = aRect.xy + uv * aRect.zw;
        vA = uFade * aAlpha * inNear * inFar;
        vC = aColor;
        gl_Position = clip;
      }
    `;

    const FRAG = `
      precision highp float;
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying float vA;
      varying vec3 vC;
      void main(){
        // the atlas is drawn at the near layer's device size, so coverage is honest
        float cover = texture2D(uAtlas, vUv).a;
        float a = cover * vA;
        if (a < 0.015) discard;
        gl_FragColor = vec4(vC, a);
      }
    `;

    const INK = new THREE.Color(0x15181b);
    const MID = new THREE.Color(0x3a4046);
    const FAINT = new THREE.Color(0x6b7078);
    const AMBER = new THREE.Color(0x8f5306);

    const state = { w: 0, h: 0, px: 0, py: 0, tx: 0, ty: 0, z: 0, zTarget: 0, drift: 0, t: 0, progress: 0 };
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    const aspect = state.w / state.h;
    const boxAspect = Math.max(aspect, 0.62);

    // clear ground behind the hero copy: instances whose rest position lands on it are dropped
    let clearZone: { x0: number; x1: number; y0: number; y1: number } | null = null;
    {
      const r = heroCopy.getBoundingClientRect();
      if (r.width > 0) {
        const m = 0.05;
        clearZone = {
          x0: (r.left / state.w) * 2 - 1 - m,
          x1: (r.right / state.w) * 2 - 1 + m,
          y0: -((r.bottom / state.h) * 2 - 1) - m,
          y1: -((r.top / state.h) * 2 - 1) + m,
        };
      }
    }

    // letter size is the on screen cap size; quad height is the atlas cell at that scale
    const LAYERS: LayerConfig[] = coarsePointer ? [
      { labels: COMPANIES, count: 64,  near: 210, far: 440, letter: 8.5, alpha: 0.28, color: FAINT, drift: 0.11, amber: 0, order: 0 },
      { labels: COMPANIES, count: 36,  near: 110, far: 210, letter: 11,  alpha: 0.45, color: MID,   drift: 0.42, amber: 0, order: 1 },
      { labels: WRAPPERS,  count: 26,  near: 36,  far: 110, letter: 14,  alpha: 0.80, color: INK,   drift: 1.00, amber: 2, order: 2 },
    ] : [
      { labels: COMPANIES, count: 76,  near: 210, far: 440, letter: 9.5,  alpha: 0.28, color: FAINT, drift: 0.11, amber: 0, order: 0 },
      { labels: COMPANIES, count: 44,  near: 110, far: 210, letter: 12.5, alpha: 0.45, color: MID,   drift: 0.42, amber: 0, order: 1 },
      { labels: WRAPPERS,  count: 34,  near: 36,  far: 110, letter: 16.5, alpha: 0.80, color: INK,   drift: 1.00, amber: 3, order: 2 },
    ];

    // seeded so the composition is the same on every load: what is verified is what ships
    let seed = 0x9e3779b9;
    function rnd() {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    const quad = new THREE.PlaneGeometry(1, 1);
    // every label already standing on screen, so the next one is not dropped on top of it
    const placed: { x: number; y: number; hw: number; hh: number }[] = [];

    function free(nx: number, ny: number, hw: number, hh: number) {
      for (const p of placed) {
        if (Math.abs(nx - p.x) < hw + p.hw + 0.020 && Math.abs(ny - p.y) < hh + p.hh + 0.024) return false;
      }
      return true;
    }

    function makeLayer(cfg: LayerConfig, atlas: Atlas) {
      const cols = Math.max(3, Math.round(Math.sqrt(cfg.count * boxAspect)));
      const rows = Math.max(3, Math.ceil(cfg.count / cols));
      const halfY = TAN * cfg.far * 1.26;
      const halfX = halfY * boxAspect;
      const span = cfg.far - cfg.near;
      const cap = cols * rows;

      const pos = new Float32Array(cap * 3);
      const rect = new Float32Array(cap * 4);
      const px = new Float32Array(cap * 2);
      const alpha = new Float32Array(cap);
      const col = new Float32Array(cap * 3);

      const mine: { i: number; lit: boolean; nx: number; ny: number; rad: number }[] = [];
      let n = 0, li = Math.floor(rnd() * cfg.labels.length);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const label = cfg.labels[li % cfg.labels.length];
          li += 1 + Math.floor(rnd() * 3);
          const cell = atlas.map[label];
          const h = cfg.letter * (CELL / FS);
          const pw = h * cell.aspect;
          const hw = pw / state.w;
          const hh = (h * 0.8) / state.h;

          let x = 0, y = 0, d = 0, nx = 0, ny = 0, ok = false, onScreen = false;
          for (let attempt = 0; attempt < 12; attempt++) {
            x = (((c + 0.5 + (rnd() - 0.5) * 0.76) / cols) * 2 - 1) * halfX;
            y = (((r + 0.5 + (rnd() - 0.5) * 0.76) / rows) * 2 - 1) * halfY;
            d = cfg.near + rnd() * span;
            nx = x / (TAN * d * aspect);
            ny = y / (TAN * d);
            // well clear of the frame: keep it, it is a label the drift will bring in later
            if (Math.abs(nx) > 1.4 || Math.abs(ny) > 1.4) { onScreen = false; ok = true; break; }
            // half in frame reads as a typo, so reject anything the edge would cut
            if (Math.abs(nx) + hw > 0.99 || Math.abs(ny) + hh > 0.99) continue;
            const inZone = clearZone && nx > clearZone.x0 && nx < clearZone.x1 && ny > clearZone.y0 && ny < clearZone.y1;
            if (!inZone && free(nx, ny, hw, hh)) { onScreen = true; ok = true; break; }
          }
          if (!ok) continue;
          if (onScreen) placed.push({ x: nx, y: ny, hw, hh });

          pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = -d;
          rect[n * 4] = cell.rect[0]; rect[n * 4 + 1] = cell.rect[1];
          rect[n * 4 + 2] = cell.rect[2]; rect[n * 4 + 3] = cell.rect[3];
          px[n * 2] = pw; px[n * 2 + 1] = h;
          alpha[n] = cfg.alpha;
          col[n * 3] = cfg.color.r; col[n * 3 + 1] = cfg.color.g; col[n * 3 + 2] = cfg.color.b;
          // full strength only in the middle of the band, where the depth fade is not biting
          const t = (d - cfg.near) / span;
          const lit = onScreen && t > 0.20 && t < 0.70 && Math.abs(nx) < 0.88 && Math.abs(ny) < 0.88;
          mine.push({ i: n, lit, nx, ny, rad: Math.hypot(nx, ny) });
          n++;
        }
      }

      // the one amber element: a few near labels well inside the frame, kept apart
      if (cfg.amber > 0) {
        const taken: { i: number; lit: boolean; nx: number; ny: number; rad: number }[] = [];
        for (const m of mine.filter((q) => q.lit).sort((a, b) => a.rad - b.rad)) {
          if (taken.length >= cfg.amber) break;
          if (taken.some((t) => Math.hypot(t.nx - m.nx, t.ny - m.ny) < 0.7)) continue;
          taken.push(m);
          alpha[m.i] = 1.0;
          col[m.i * 3] = AMBER.r; col[m.i * 3 + 1] = AMBER.g; col[m.i * 3 + 2] = AMBER.b;
        }
      }

      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index;
      geo.setAttribute("position", quad.getAttribute("position"));
      geo.setAttribute("uv", quad.getAttribute("uv"));
      geo.setAttribute("aPos", new THREE.InstancedBufferAttribute(pos, 3));
      geo.setAttribute("aRect", new THREE.InstancedBufferAttribute(rect, 4));
      geo.setAttribute("aPx", new THREE.InstancedBufferAttribute(px, 2));
      geo.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alpha, 1));
      geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(col, 3));
      geo.instanceCount = n;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2000);

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uZ: { value: 0 },
          uNear: { value: cfg.near },
          uFar: { value: cfg.far },
          uFade: { value: 1 },
          uShift: { value: new THREE.Vector2(0, 0) },
          uViewport: { value: new THREE.Vector2(state.w, state.h) },
          uAtlas: { value: atlas.tex },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = cfg.order;
      mesh.userData.drift = cfg.drift;
      scene.add(mesh);
      return mesh;
    }

    /* ---------- loop ---------- */
    const TRAVEL = 520;
    let layers: ReturnType<typeof makeLayer>[] = [];
    let atlas: Atlas | null = null;
    let raf = 0;
    let observer: IntersectionObserver | null = null;
    let disposed = false;
    let running = true, visible = true, onScreen = true;
    let last = performance.now();

    function resize() {
      state.w = window.innerWidth;
      state.h = window.innerHeight;
      renderer.setSize(state.w, state.h, false);
      camera.aspect = state.w / state.h;
      camera.updateProjectionMatrix();
      for (const m of layers) m.material.uniforms.uViewport.value.set(state.w, state.h);
    }

    function scrollProgress() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return 0;
      return Math.min(1, Math.max(0, window.scrollY / max));
    }

    function smooth(x: number, a: number, b: number) {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    }

    function compose(dt: number) {
      state.t += dt;
      state.drift += dt * 0.85;

      state.px += (state.tx - state.px) * Math.min(1, dt * 3.2);
      state.py += (state.ty - state.py) * Math.min(1, dt * 3.2);

      state.zTarget = scrollProgress() * TRAVEL;
      state.z += (state.zTarget - state.z) * Math.min(1, dt * 4.0);
      state.progress = state.zTarget / TRAVEL;

      const travel = state.z + state.drift;
      const fade = 1 - smooth(state.progress, 0.74, 0.96);

      for (const m of layers) {
        const f = m.userData.drift;
        const u = m.material.uniforms;
        u.uZ.value = travel;
        u.uFade.value = fade;
        u.uShift.value.set(
          state.px * 9 * f + Math.sin(state.t * 0.09) * 3.2 * f,
          state.py * 7 * f + Math.sin(state.t * 0.13) * 2.4 * f
        );
      }
    }

    function onPointerMove(e: PointerEvent) {
      state.tx = (e.clientX / state.w) * 2 - 1;
      state.ty = -((e.clientY / state.h) * 2 - 1);
    }

    function onResize() {
      resize();
      if (reduced) {
        compose(0);
        renderer.render(scene, camera);
      }
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      compose(dt);
      renderer.render(scene, camera);
    }

    function sync() {
      const should = visible && onScreen;
      if (should === running) return;
      running = should;
      if (running) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    }

    function onVisibility() {
      visible = !document.hidden;
      sync();
    }

    function start(builtAtlas: Atlas) {
      // near layer is placed first so the readable wrappers win the free ground
      layers = LAYERS.slice().reverse().map((cfg) => makeLayer(cfg, builtAtlas));
      resize();

      if (reduced) {
        // reduced motion: one composed frame, then stop. no pointer, no loop.
        compose(0);
        renderer.render(scene, camera);
        window.addEventListener("resize", onResize, { passive: true });
        return;
      }

      if (finePointer) {
        window.addEventListener("pointermove", onPointerMove, { passive: true });
      }

      document.addEventListener("visibilitychange", onVisibility);

      if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver((entries) => {
          onScreen = entries[0].isIntersecting;
          sync();
        }, { threshold: 0 });
        observer.observe(canvas);
      }

      window.addEventListener("resize", onResize, { passive: true });
      raf = requestAnimationFrame(frame);
    }

    // the mono face has to be loaded before the atlas is drawn, or the labels bake in
    // the fallback metrics. 1.5 s and the system mono takes over.
    const fontReady = document.fonts && document.fonts.load
      ? document.fonts.load(`500 ${FS}px ${mono}`).then(() => document.fonts.ready)
      : Promise.resolve();
    Promise.race([fontReady, new Promise((r) => setTimeout(r, 1500))])
      .catch(() => {})
      .then(() => {
        if (disposed) return;
        atlas = buildAtlas([...new Set([...COMPANIES, ...WRAPPERS])]);
        start(atlas);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      for (const m of layers) {
        m.geometry.dispose();
        m.material.dispose();
      }
      quad.dispose();
      atlas?.tex.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="landing-field" aria-hidden="true" hidden={!webgl} />
      <div className={webgl ? "landing-scrim" : "landing-scrim landing-scrim-solid"} />
    </>
  );
}
