/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TabBar } from './TabBar';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'hours', label: 'Business hours' },
  { id: 'linked', label: 'Linked Accounts' },
] as const;

afterEach(cleanup);

describe('TabBar select layout', () => {
  it('lists every tab in one labelled picker, set to the current tab', () => {
    render(<TabBar tabs={TABS} value="hours" onChange={vi.fn()} mobileLayout="select" mobileSelectLabel="Settings" />);
    const picker = screen.getByRole('combobox', { name: /Settings/ });
    expect(picker).toHaveValue('hours');
    expect([...(picker as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      'Profile',
      'Business hours',
      'Linked Accounts',
    ]);
  });

  it('changes tab from the picker', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={TABS} value="profile" onChange={onChange} mobileLayout="select" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'linked' } });
    expect(onChange).toHaveBeenCalledWith('linked');
  });

  it('renders the tabs once, for wider screens', () => {
    render(<TabBar tabs={TABS} value="profile" onChange={vi.fn()} mobileLayout="select" />);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});
