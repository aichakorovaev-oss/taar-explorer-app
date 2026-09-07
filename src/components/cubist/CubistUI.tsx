/**
 * Cubist / art-deco design.
 * Ported & generalized from the "Cubist Notes" prototype so the same
 * hand-drawn, thick-border, hard-shadow visual language can be reused
 * across Aesthetic Explorer's richer feature set.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import cubistTexture from '../../assets/images/art_deco_cubist_bg_1780563383401.jpg';
import simpleFaceImg from '../../assets/images/simple_cubist_face_1780627039192.jpg';

export const INK = '#111111';

// Fallback palette used before any image has been analyzed yet.
export const DEFAULT_PALETTE = [
  '#ff9cbf', // Pink
  '#7acaea', // Blue
  '#fbd743', // Yellow
  '#f98b79', // Coral
  '#a3e4a1', // Mint
];

export const DEFAULT_BG = '#fef8f0';

export const getContrastColor = (hex?: string) => {
  if (!hex) return INK;
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map((c) => c + c).join('');
  }
  if (cleanHex.length !== 6) return INK;
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? INK : '#ffffff';
};

const pick = (palette: string[], i: number) =>
  palette.length > 0 ? palette[i % palette.length] : DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];

// Hand-tuned tilt sequence, cycled by global letter index — mirrors the
// slightly-irregular (never simply alternating) resting angles used in
// the original Cubist Notes title.
export const TITLE_ROTATIONS = [-2, 3, -1, 2, -3, 1];

/** Fixed background texture overlay, mirrors Cubist Notes' page treatment. */
export const CubistTexture: React.FC = () => (
  <div
    className="fixed inset-0 pointer-events-none z-0 opacity-[0.08] mix-blend-multiply bg-cover bg-center"
    style={{ backgroundImage: `url(${cubistTexture})` }}
  />
);

/** A single "domino" letter tile, used to spell out headings — static, but reactive on hover/tap. */
export const TitleBlock: React.FC<{
  char: string;
  color: string;
  rotation?: number;
  index?: number;
  total?: number;
  size?: 'md' | 'lg';
}> = ({ char, color, rotation = 0, size = 'lg' }) => {
  const dims =
    size === 'lg'
      ? 'w-8 h-10 sm:w-12 sm:h-14 md:w-14 md:h-16 lg:w-16 lg:h-20 text-2xl sm:text-3xl md:text-5xl border-[3px] sm:border-[4px] rounded-xl sm:rounded-2xl shadow-[3px_3px_0px_0px_#111111] sm:shadow-[4px_4px_0px_0px_#111111]'
      : 'w-6 h-8 sm:w-9 sm:h-11 text-lg sm:text-2xl border-[3px] rounded-lg sm:rounded-xl shadow-[2px_2px_0px_0px_#111111] sm:shadow-[3px_3px_0px_0px_#111111]';

  return (
    <motion.div
      style={{ backgroundColor: color, color: getContrastColor(color), transformOrigin: 'bottom right', rotate: rotation }}
      whileHover={{ scale: 1.08, rotate: 0, zIndex: 10, transition: { duration: 0.2 } }}
      whileTap={{ scale: 0.95 }}
      className={`flex items-center justify-center border-[#111111] font-black shadow-[3px_3px_0px_0px_#111111] cursor-default shrink-0 select-none ${dims}`}
    >
      {char}
    </motion.div>
  );
};

/** Spells out a word as a row of TitleBlocks, cycling through a palette. */
export const TitleWord: React.FC<{ word: string; palette: string[]; startIndex?: number; total: number; size?: 'md' | 'lg' }> = ({
  word,
  palette,
  startIndex = 0,
  total,
  size,
}) => (
  <div className="flex gap-1 sm:gap-2 shrink-0">
    {word.split('').map((char, i) => {
      const globalIndex = startIndex + i;
      return (
        <TitleBlock
          key={i}
          char={char}
          color={pick(palette, globalIndex)}
          rotation={TITLE_ROTATIONS[globalIndex % TITLE_ROTATIONS.length]}
          index={globalIndex}
          total={total}
          size={size}
        />
      );
    })}
  </div>
);

/** Decorative cubist eye that tracks the cursor. */
export const CubistEye: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => {
  const eyeRef = useRef<SVGSVGElement>(null);
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!eyeRef.current) return;
      const rect = eyeRef.current.getBoundingClientRect();
      const eyeCenterX = rect.left + rect.width / 2;
      const eyeCenterY = rect.top + rect.height / 2;
      const dx = e.clientX - eyeCenterX;
      const dy = e.clientY - eyeCenterY;
      const angle = Math.atan2(dy, dx);
      const distance = Math.hypot(dx, dy);
      const maxRadius = 12;
      const smoothDistance = Math.min((distance / 250) * maxRadius, maxRadius);
      setPupilOffset({ x: Math.cos(angle) * smoothDistance, y: Math.sin(angle) * smoothDistance });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <svg
      ref={eyeRef}
      viewBox="0 0 100 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`h-auto ${className || 'w-12'}`}
      style={style}
    >
      <path d="M5 30C25 10 75 10 95 30C75 50 25 50 5 30Z" fill="white" stroke="#111111" strokeWidth="6" strokeLinejoin="round" />
      <circle cx={50 + pupilOffset.x} cy={30 + pupilOffset.y} r="12" fill="#111111" className="transition-transform duration-75 ease-out" />
    </svg>
  );
};

/** Mascot used for empty states, borrowed wholesale from Cubist Notes. */
export const CubistFace: React.FC<{ className?: string }> = ({ className }) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const eyeLeft = { x: 43.5, y: 45 };
  const eyeRight = { x: 56.5, y: 45 };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = mousePos.x - centerX;
    const dy = mousePos.y - centerY;
    const distance = Math.min(Math.sqrt(dx * dx + dy * dy) / 30, 8);
    const angle = Math.atan2(dy, dx);
    setOffset({ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance });
  }, [mousePos]);

  return (
    <div ref={containerRef} className={`relative ${className || 'w-full max-w-xs'}`}>
      <img
        src={simpleFaceImg}
        alt="Cubist mascot"
        className="w-full h-full object-contain mix-blend-multiply drop-shadow-[0_10px_20px_rgba(0,0,0,0.15)]"
      />
      <div
        className="absolute w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 bg-[#111111] rounded-full shadow-lg"
        style={{ left: `calc(${eyeLeft.x}% + ${offset.x}px)`, top: `calc(${eyeLeft.y}% + ${offset.y}px)`, transform: 'translate(-50%, -50%)' }}
      />
      <div
        className="absolute w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 bg-[#111111] rounded-full shadow-lg"
        style={{ left: `calc(${eyeRight.x}% + ${offset.x}px)`, top: `calc(${eyeRight.y}% + ${offset.y}px)`, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  );
};

/** Sweeping glow beam played over an image while it's being analyzed — ported verbatim from Cubist Notes. */
export const ScanBeam: React.FC = () => (
  <motion.div
    className="absolute left-0 right-0 w-full h-1/3 bg-gradient-to-b from-transparent via-[rgba(251,215,67,0.2)] to-[rgba(251,215,67,0.6)] border-b-[4px] border-[#fbd743] shadow-[0_4px_30px_rgba(251,215,67,0.8)] z-10 pointer-events-none mix-blend-color-dodge"
    animate={{ top: ['-33%', '100%'] }}
    transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
  />
);

/** "Decoding..." pill shown alongside the scan beam. */
export const DecodingPill: React.FC<{ label?: string }> = ({ label = 'Decoding...' }) => (
  <div className="flex items-center gap-3 font-black uppercase tracking-wider text-base sm:text-xl bg-[#fbd743] px-5 sm:px-6 py-2.5 sm:py-3 border-[4px] border-[#111111] shadow-[4px_4px_0px_0px_#111111] rounded-xl z-20">
    <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin shrink-0" /> {label}
  </div>
);

/** Chunky white panel: the base "card" used everywhere in place of the old glassy slate-900 boxes. */
export const CubistCard: React.FC<React.HTMLAttributes<HTMLDivElement> & { thick?: boolean }> = ({
  className = '',
  thick = false,
  children,
  ...rest
}) => (
  <div
    className={`bg-white text-[#111111] border-[${thick ? 6 : 5}px] border-[#111111] shadow-[6px_6px_0px_0px_#111111] rounded-2xl ${className}`}
    {...rest}
  >
    {children}
  </div>
);

/** Small colored, hard-shadowed pill — replaces the old translucent slate/indigo chips. */
export const CubistChip: React.FC<{
  children: React.ReactNode;
  color?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}> = ({ children, color, className = '', onClick, active }) => (
  <motion.span
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
    onClick={onClick}
    style={color ? { backgroundColor: color, color: getContrastColor(color) } : undefined}
    className={`px-3 py-1.5 font-black text-xs sm:text-sm uppercase tracking-wider border-[3px] border-[#111111] shadow-[3px_3px_0px_0px_#111111] rounded-xl inline-flex items-center gap-1.5 ${
      onClick ? 'cursor-pointer' : 'cursor-default'
    } ${!color ? 'bg-white' : ''} ${active ? 'ring-4 ring-[#111111]/20' : ''} ${className}`}
  >
    {children}
  </motion.span>
);

/** Chunky pill button — replaces the old indigo/slate translucent buttons. */
export const CubistButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { color?: string; variant?: 'solid' | 'ghost' }
> = ({ children, color = '#fbd743', variant = 'solid', className = '', style, ...rest }) => (
  <motion.button
    whileHover={{ scale: rest.disabled ? 1 : 1.03, y: rest.disabled ? 0 : -2 }}
    whileTap={{ scale: rest.disabled ? 1 : 0.97 }}
    style={{
      backgroundColor: variant === 'solid' ? color : 'white',
      color: variant === 'solid' ? getContrastColor(color) : INK,
      ...style,
    }}
    className={`font-black text-sm sm:text-base uppercase tracking-wider py-2.5 px-5 rounded-xl border-[4px] border-[#111111] shadow-[4px_4px_0px_0px_#111111] flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    {...(rest as any)}
  >
    {children}
  </motion.button>
);

/** Small round icon button, chunky-bordered (used for the audio toggle, modal close, etc). */
export const CubistIconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; activeColor?: string }
> = ({ children, active, activeColor = '#fbd743', className = '', style, ...rest }) => (
  <motion.button
    whileHover={{ scale: 1.06 }}
    whileTap={{ scale: 0.94 }}
    style={{ backgroundColor: active ? activeColor : 'white', ...style }}
    className={`p-2.5 sm:p-3 rounded-xl border-[4px] border-[#111111] shadow-[3px_3px_0px_0px_#111111] flex items-center justify-center text-[#111111] transition-colors ${className}`}
    {...(rest as any)}
  >
    {children}
  </motion.button>
);
