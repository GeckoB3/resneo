'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

interface HomeRevealProps {
  children: ReactNode;
  /** Stagger delay in ms before this element animates in once visible. */
  delay?: number;
  /** Element to render as the wrapper (default: div). */
  as?: ElementType;
  className?: string;
}

/**
 * Lightweight scroll-reveal wrapper: fades + lifts its children into view the
 * first time they enter the viewport. Pairs with the `.home-reveal` primitive
 * in globals.css. Honours prefers-reduced-motion (CSS short-circuits the move)
 * and reveals immediately if IntersectionObserver is unavailable.
 */
export function HomeReveal({ children, delay = 0, as, className }: HomeRevealProps) {
  const Tag = as ?? 'div';
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      // No IO support: reveal on the next frame so content never stays hidden.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`home-reveal${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? { ['--reveal-delay' as string]: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
