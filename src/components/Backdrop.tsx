import { useEffect, useRef } from "react";

/** Decorative app backdrop: a faint upside-down Cerberus mark, a red aurora, and
 *  slow rising embers behind every page. Purely cosmetic — pointer-events off. */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;

    type Ember = { x: number; y: number; z: number; r: number; tw: number };
    let embers: Ember[] = [];

    const make = (): Ember => {
      const z = Math.random();
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z,
        r: z * 1.6 + 0.3,
        tw: Math.random() * Math.PI * 2,
      };
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      embers = Array.from({ length: Math.round((w * h) / 9000) }, make);
    };

    const draw = (t: number, animate: boolean) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of embers) {
        if (animate) {
          // Rise: drift upward, respawn at the bottom.
          s.y -= 0.04 + s.z * 0.18;
          if (s.y < -2) {
            s.y = h + 2;
            s.x = Math.random() * w;
          }
        }
        const tw = animate ? 0.55 + Math.sin(t * 0.001 + s.tw) * 0.45 : 0.8;
        const a = (0.18 + s.z * 0.55) * tw;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        // Crimson embers, brighter/warmer as they near the viewer.
        ctx.fillStyle = `rgba(${205 + Math.round(s.z * 45)}, ${
          55 + Math.round(s.z * 55)
        }, ${48 + Math.round(s.z * 32)}, ${a})`;
        ctx.fill();
      }
    };

    const loop = (t: number) => {
      draw(t, true);
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) draw(0, false);
    else raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="fx" aria-hidden="true">
      <div className="fx-aurora" />
      <canvas ref={ref} className="fx-embers" />
      <img src="/logo.png" className="fx-mark" alt="" />
      <div className="fx-vignette" />
    </div>
  );
}
