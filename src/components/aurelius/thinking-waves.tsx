"use client";

import { useEffect, useRef } from "react";

type WaveState = "thinking" | "error" | "streaming";

interface ThinkingWavesProps {
  className?: string;
  state?: WaveState;
}

export function ThinkingWaves({ className = "", state = "thinking" }: ThinkingWavesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    // Get background color from parent for proper clearing
    const getBackgroundColor = (): string => {
      const parent = canvas.parentElement;
      if (parent) {
        const computed = getComputedStyle(parent);
        const bg = computed.backgroundColor;
        // Parse rgb/rgba and add alpha for trail effect
        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          return `rgba(${match[1]}, ${match[2]}, ${match[3]}, 0.25)`;
        }
      }
      // Fallback to dark theme color
      return "rgba(18, 18, 18, 0.25)";
    };

    // Pre-compute wave config outside draw loop (only changes when state changes)
    const getWaveConfig = () => {
      if (state === "error") {
        // Dull, muted colors for error state
        return {
          primary: { color: "hsla(0, 30%, 40%, 0.5)", glow: "hsla(0, 30%, 40%, 0.2)" },
          secondary: [
            { color: "hsla(0, 20%, 35%, 0.3)" },
            { color: "hsla(0, 15%, 30%, 0.25)" },
            { color: "hsla(0, 10%, 35%, 0.2)" },
            { color: "hsla(0, 25%, 30%, 0.15)" },
          ],
          speed: 0.5, // Slower for error
          opacity: 0.6,
          pulse: false,
        };
      } else if (state === "streaming") {
        // Bright, active colors for streaming
        return {
          primary: { color: "hsla(43, 74%, 49%, 0.9)", glow: "hsla(43, 74%, 60%, 0.6)" },
          secondary: [
            { color: "hsla(200, 60%, 50%, 0.5)" },
            { color: "hsla(280, 50%, 55%, 0.4)" },
            { color: "hsla(160, 50%, 45%, 0.35)" },
            { color: "hsla(20, 70%, 50%, 0.3)" },
          ],
          speed: 1,
          opacity: 1,
          pulse: false,
        };
      } else {
        // Thinking state - pulsing transparency
        return {
          primary: { color: "hsla(43, 74%, 49%, VAR)", glow: "hsla(43, 74%, 60%, VAR)" },
          secondary: [
            { color: "hsla(200, 60%, 50%, VAR)" },
            { color: "hsla(280, 50%, 55%, VAR)" },
            { color: "hsla(160, 50%, 45%, VAR)" },
            { color: "hsla(20, 70%, 50%, VAR)" },
          ],
          speed: 1,
          opacity: 1, // Will be modulated by pulse
          pulse: true,
        };
      }
    };

    // Memoize config - only recalculated when effect re-runs (state changes)
    const config = getWaveConfig();
    const bgColor = getBackgroundColor();

    // Wave parameters (static)
    const baseWaves = [
      { amplitude: 6, frequency: 0.012, speed: 0.03, phase: 0, lineWidth: 2, baseOpacity: 0.9 },
      { amplitude: 8, frequency: 0.018, speed: -0.025, phase: Math.PI / 4, lineWidth: 1.2, baseOpacity: 0.5 },
      { amplitude: 5, frequency: 0.022, speed: 0.04, phase: Math.PI / 2, lineWidth: 1, baseOpacity: 0.4 },
      { amplitude: 7, frequency: 0.015, speed: -0.035, phase: Math.PI, lineWidth: 1, baseOpacity: 0.35 },
      { amplitude: 4, frequency: 0.025, speed: 0.045, phase: Math.PI * 1.3, lineWidth: 0.8, baseOpacity: 0.3 },
    ];

    let animationId: number;
    let time = 0;

    const draw = () => {
      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;
      const centerY = height / 2;

      // Calculate pulse factor for thinking state (oscillates between 0.3 and 1)
      const pulseFactor = config.pulse
        ? 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 0.02))
        : config.opacity;

      // Clear with slight fade for trail effect
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      // Draw secondary waves first (behind)
      baseWaves.slice(1).forEach((wave, i) => {
        ctx.beginPath();

        const opacity = wave.baseOpacity * pulseFactor * (config.opacity || 1);
        const colorBase = config.secondary[i]?.color || "hsla(200, 60%, 50%, 0.5)";
        ctx.strokeStyle = colorBase.replace("VAR", String(opacity));
        ctx.lineWidth = wave.lineWidth;

        const phaseShift = time * wave.speed * (config.speed || 1) + wave.phase;

        for (let x = 0; x < width; x++) {
          const y =
            centerY +
            wave.amplitude * Math.sin(x * wave.frequency + phaseShift) +
            (wave.amplitude / 3) * Math.sin(x * wave.frequency * 2.5 + phaseShift * 1.3);

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      });

      // Draw primary gold wave last (on top) with glow
      const primaryWave = baseWaves[0];
      const phaseShift = time * primaryWave.speed * (config.speed || 1) + primaryWave.phase;
      const primaryOpacity = primaryWave.baseOpacity * pulseFactor;

      // Glow layer
      ctx.beginPath();
      const glowColor = config.primary.glow.replace("VAR", String(primaryOpacity * 0.4));
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 6;
      ctx.shadowBlur = 15;
      ctx.shadowColor = glowColor;

      for (let x = 0; x < width; x++) {
        const y =
          centerY +
          primaryWave.amplitude * Math.sin(x * primaryWave.frequency + phaseShift) +
          (primaryWave.amplitude / 3) * Math.sin(x * primaryWave.frequency * 2 + phaseShift * 1.5);

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Core gold line
      ctx.beginPath();
      ctx.strokeStyle = config.primary.color.replace("VAR", String(primaryOpacity));
      ctx.lineWidth = primaryWave.lineWidth;
      ctx.shadowBlur = 0;

      for (let x = 0; x < width; x++) {
        const y =
          centerY +
          primaryWave.amplitude * Math.sin(x * primaryWave.frequency + phaseShift) +
          (primaryWave.amplitude / 3) * Math.sin(x * primaryWave.frequency * 2 + phaseShift * 1.5);

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      time += 1;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-10 ${className}`}
      style={{ background: "transparent" }}
    />
  );
}
