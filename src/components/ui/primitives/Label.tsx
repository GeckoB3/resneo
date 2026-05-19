'use client';

import * as RadixLabel from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export const Label = forwardRef<HTMLLabelElement, ComponentPropsWithoutRef<typeof RadixLabel.Root>>(
  function Label({ className, ...props }, ref) {
    return (
      <RadixLabel.Root
        ref={ref}
        className={cn('text-sm font-medium text-slate-700', className)}
        {...props}
      />
    );
  },
);
