import React, { useEffect, useRef } from 'react';

export const BackgroundParticles: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let particles: { x: number; y: number; size: number; speedY: number; color: string; opacity: number; swing: number; swingSpeed: number }[] = [];
        let animationFrameId: number;

        const colors = [
            '#818cf8', '#6366f1', '#c084fc', '#e879f9',
            '#22d3ee', '#38bdf8', '#4ade80', '#fbbf24', '#f472b6',
        ];

        const init = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            particles = [];
            const count = Math.floor((window.innerWidth * window.innerHeight) / 2000);
            for (let i = 0; i < count; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    size: Math.random() * 3 + 1,
                    speedY: Math.random() * 1.5 + 0.5,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    opacity: Math.random() * 0.7 + 0.3,
                    swing: Math.random() * Math.PI * 2,
                    swingSpeed: Math.random() * 0.02 + 0.01,
                });
            }
        };

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (const p of particles) {
                p.y += p.speedY;
                p.swing += p.swingSpeed;
                p.x += Math.sin(p.swing) * 0.5;
                if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
                if (p.x > canvas.width) p.x = 0;
                if (p.x < 0) p.x = canvas.width;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.opacity;
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
            animationFrameId = requestAnimationFrame(animate);
        };

        init();
        animate();

        const handleResize = () => init();
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none z-0 mix-blend-screen"
            style={{ opacity: 0.8 }}
        />
    );
};
