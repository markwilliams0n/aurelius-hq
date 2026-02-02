"use client";

import { useEffect, useRef } from "react";

export function ThinkingWaves({ className = "" }: { className?: string }) {
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

    // Wave parameters - multiple waves with different colors
    // Gold is the primary, others are complementary
    const waves = [
      // Primary gold wave - thicker, more prominent
      { amplitude: 6, frequency: 0.012, speed: 0.03, phase: 0, color: "hsla(43, 74%, 49%, 0.9)", lineWidth: 2, glow: true },
      // Secondary waves - different colors
      { amplitude: 8, frequency: 0.018, speed: -0.025, phase: Math.PI / 4, color: "hsla(200, 60%, 50%, 0.5)", lineWidth: 1.2, glow: false }, // Blue
      { amplitude: 5, frequency: 0.022, speed: 0.04, phase: Math.PI / 2, color: "hsla(280, 50%, 55%, 0.4)", lineWidth: 1, glow: false }, // Purple
      { amplitude: 7, frequency: 0.015, speed: -0.035, phase: Math.PI, color: "hsla(160, 50%, 45%, 0.35)", lineWidth: 1, glow: false }, // Teal
      { amplitude: 4, frequency: 0.025, speed: 0.045, phase: Math.PI * 1.3, color: "hsla(20, 70%, 50%, 0.3)", lineWidth: 0.8, glow: false }, // Orange
    ];

    let animationId: number;
    let time = 0;

    const draw = () => {
      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;
      const centerY = height / 2;

      // Clear with slight fade for trail effect
      ctx.fillStyle = "rgba(18, 18, 18, 0.2)";
      ctx.fillRect(0, 0, width, height);

      // Draw secondary waves first (behind)
      waves.slice(1).forEach((wave) => {
        ctx.beginPath();
        ctx.strokeStyle = wave.color;
        ctx.lineWidth = wave.lineWidth;

        const phaseShift = time * wave.speed + wave.phase;

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
      const primaryWave = waves[0];
      const phaseShift = time * primaryWave.speed + primaryWave.phase;

      // Glow layer
      ctx.beginPath();
      ctx.strokeStyle = "hsla(43, 74%, 49%, 0.3)";
      ctx.lineWidth = 6;
      ctx.shadowBlur = 15;
      ctx.shadowColor = "hsla(43, 74%, 60%, 0.6)";

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
      ctx.strokeStyle = primaryWave.color;
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-10 ${className}`}
      style={{ background: "transparent" }}
    />
  );
}
