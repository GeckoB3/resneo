import type { ReactNode } from 'react';
import '../src/app/globals.css';

// Stories that render next/link need process.env, which Ladle's Vite build does not define.
if (typeof window !== 'undefined' && !('process' in window)) {
  Object.assign(window, { process: { env: { NODE_ENV: 'development' } } });
}

export const Provider = ({ children }: { children: ReactNode }) => <>{children}</>;
