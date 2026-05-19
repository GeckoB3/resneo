'use client';

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';
import { Label } from './Label';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  description?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({
  label,
  htmlFor: htmlForProp,
  description,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = htmlForProp ?? generatedId;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required ? (
          <span className="text-red-600" aria-hidden>
            {' '}
            *
          </span>
        ) : null}
      </Label>
      {description ? (
        <p id={descriptionId} className="text-xs text-slate-500">
          {description}
        </p>
      ) : null}
      <FieldSlot fieldId={fieldId} describedBy={describedBy} invalid={Boolean(error)}>
        {children}
      </FieldSlot>
      {error ? (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}


function FieldSlot({
  fieldId,
  describedBy,
  invalid,
  children,
}: {
  fieldId: string;
  describedBy?: string;
  invalid: boolean;
  children: ReactNode;
}) {
  if (isValidElement(children)) {
    const el = children as ReactElement<Record<string, unknown>>;
    return cloneElement(el, {
      id: (el.props.id as string | undefined) ?? fieldId,
      'aria-describedby': describedBy,
      'aria-invalid': invalid || undefined,
    });
  }
  return <>{children}</>;
}
