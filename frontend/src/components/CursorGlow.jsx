import React, { useEffect, useRef } from 'react';

/**
 * CursorGlow - Renders a full-screen canvas displaying a smooth, glowing trail
 * that follows the user's cursor with custom particle dynamics and radial gradients.
 */
export default function CursorGlow() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let points = [];
    const maxPoints = 25; // Length of the trail
    let mouse = { x: 0, y: 0 };
    let lastMouse = { x: 0, y: 0 };
    let active = false;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const handleMouseMove = (e) => {
      active = true;
      mouse.x = e.clientX;
      mouse.y = e.clientY;

      // Interpolate points for faster mouse movements to make trail continuous
      const dx = mouse.x - lastMouse.x;
      const dy = mouse.y - lastMouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 15) {
        const steps = Math.floor(dist / 12);
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          points.push({
            x: lastMouse.x + dx * t,
            y: lastMouse.y + dy * t,
            size: 22, // Larger size for soft diffuse spread
            alpha: 0.22, // Very low initial opacity for a dim trail
            color: Math.random() > 0.4 ? '56, 189, 248' : '129, 140, 248' // RGB for Sky blue or Indigo
          });
        }
      } else {
        points.push({
          x: mouse.x,
          y: mouse.y,
          size: 22,
          alpha: 0.22,
          color: Math.random() > 0.4 ? '56, 189, 248' : '129, 140, 248'
        });
      }

      lastMouse.x = mouse.x;
      lastMouse.y = mouse.y;

      if (points.length > maxPoints) {
        points.splice(0, points.length - maxPoints);
      }
    };

    const handleMouseLeave = () => {
      active = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    let animationFrameId;

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Smoothly fade out remaining points
      if (points.length > 0) {
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          pt.size = Math.max(0.1, pt.size - 0.2); // Shrink slowly
          pt.alpha = Math.max(0, pt.alpha - 0.008); // Slow, elegant fade
        }
        points = points.filter(pt => pt.alpha > 0 && pt.size > 0.1);
      }

      if (points.length > 1) {
        ctx.globalCompositeOperation = 'screen';

        // Draw the glowing dots
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];

          // Radial glow gradient - extremely soft, dim, and diffuse
          const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, pt.size * 3.5);
          grad.addColorStop(0, `rgba(${pt.color}, ${pt.alpha * 0.3})`); // Dim center
          grad.addColorStop(0.4, `rgba(${pt.color}, ${pt.alpha * 0.1})`); // Outer glow
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Draw connecting vector trail line (whisper-thin)
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }

        ctx.strokeStyle = `rgba(56, 189, 248, ${points[0].alpha * 0.04})`;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[99999] w-full h-full"
      style={{ mixBlendMode: 'screen' }}
    />
  );
}
