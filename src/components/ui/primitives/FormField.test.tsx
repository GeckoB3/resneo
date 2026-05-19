/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from './FormField';
import { Input } from './Input';

describe('FormField', () => {
  it('associates label with input and error message', () => {
    render(
      <FormField label="Email" error="Invalid email" required>
        <Input type="email" />
      </FormField>,
    );

    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('error');
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email');
  });
});
