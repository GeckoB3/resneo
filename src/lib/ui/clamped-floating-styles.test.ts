import { describe, expect, it } from 'vitest';
import {
  MOBILE_POPOVER_MAX_VIEWPORT_WIDTH_PX,
  computePopoverPanelStyle,
} from '@/lib/ui/clamped-floating-styles';

describe('computePopoverPanelStyle', () => {
  it('anchors beside the pointer on wide viewports', () => {
    const style = computePopoverPanelStyle({
      anchorX: 400,
      anchorY: 300,
      viewportWidth: 1280,
      viewportHeight: 800,
      maxPanelWidth: 640,
    });

    expect(style.transform).toBeUndefined();
    expect(style.top).toBe(310);
    expect(style.left).toBe(410);
  });

  it('centers vertically and uses full width on mobile viewports', () => {
    const style = computePopoverPanelStyle({
      anchorX: 120,
      anchorY: 480,
      viewportWidth: MOBILE_POPOVER_MAX_VIEWPORT_WIDTH_PX - 1,
      viewportHeight: 700,
      maxPanelWidth: 640,
    });

    expect(style.transform).toBe('translateY(-50%)');
    expect(style.top).toBe('50%');
    expect(style.bottom).toBeUndefined();
    expect(style.left).toBe(12);
    expect(style.width).toBe(767 - 24);
    expect(style.maxHeight).toBe(700 - 24);
  });
});
