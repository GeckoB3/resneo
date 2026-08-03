/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BookingPageDraggableImage } from './BookingPageDraggableImage';
import type { BookingPageImageFraming } from '@/lib/booking/booking-page-image-framing';

/**
 * Repositioning a team or service photo. The upload is never altered: the frame clips, and the
 * stored x/y/zoom decide what shows inside it.
 */

const SIZE = 50;

function setup(crop: BookingPageImageFraming | null = null) {
  const onCropChange = vi.fn();
  render(
    <BookingPageDraggableImage
      imageUrl="https://cdn.example/p.jpg"
      crop={crop}
      onCropChange={onCropChange}
      sizePx={SIZE}
      label="Reposition the photo for Alex"
    />,
  );
  return { onCropChange, handle: screen.getByRole('button') };
}

describe('BookingPageDraggableImage', () => {
  it('clips the photo so a zoomed image cannot paint outside its frame', () => {
    const { handle } = setup({ x: 50, y: 50, zoom: 2 });
    // Without this the transform would spill over neighbouring rows.
    expect(handle).toHaveClass('overflow-hidden');
    const img = handle.querySelector('img')!;
    expect(img.getAttribute('style')).toContain('scale(2)');
  });

  it('converts a drag into a position change scaled to the frame size', () => {
    const { onCropChange, handle } = setup({ x: 50, y: 50, zoom: 1 });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    // A quarter of the frame across and an eighth down.
    fireEvent.pointerMove(handle, { clientX: SIZE / 4, clientY: SIZE / 8, pointerId: 1 });

    expect(onCropChange).toHaveBeenCalledWith({ x: 75, y: 62.5, zoom: 1 });
  });

  it('ignores pointer movement that did not start with a press', () => {
    const { onCropChange, handle } = setup();
    fireEvent.pointerMove(handle, { clientX: 40, clientY: 40, pointerId: 1 });
    expect(onCropChange).not.toHaveBeenCalled();
  });

  it('clamps a drag at the edges instead of running off', () => {
    const { onCropChange, handle } = setup({ x: 50, y: 50, zoom: 1 });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: SIZE * 10, clientY: -SIZE * 10, pointerId: 1 });

    expect(onCropChange).toHaveBeenCalledWith({ x: 100, y: 0, zoom: 1 });
  });

  it('stops changing the position once the pointer is released', () => {
    const { onCropChange, handle } = setup({ x: 50, y: 50, zoom: 1 });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    onCropChange.mockClear();
    fireEvent.pointerMove(handle, { clientX: 25, clientY: 25, pointerId: 1 });

    expect(onCropChange).not.toHaveBeenCalled();
  });

  it('nudges with the arrow keys, so framing is not mouse-only', () => {
    const { onCropChange, handle } = setup({ x: 50, y: 50, zoom: 1 });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 52, y: 50, zoom: 1 });

    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(onCropChange).toHaveBeenLastCalledWith({ x: 50, y: 40, zoom: 1 });
  });

  it('leaves other keys to the page', () => {
    const { onCropChange, handle } = setup();
    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'a' });
    expect(onCropChange).not.toHaveBeenCalled();
  });

  it('does not respond at all when the editor is read-only', () => {
    const onCropChange = vi.fn();
    render(
      <BookingPageDraggableImage
        imageUrl="https://cdn.example/p.jpg"
        crop={null}
        onCropChange={onCropChange}
        sizePx={SIZE}
        disabled
        label="Reposition the photo for Alex"
      />,
    );
    const handle = screen.getByRole('button');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 25, clientY: 0, pointerId: 1 });
    expect(onCropChange).not.toHaveBeenCalled();
    expect(handle).toHaveAttribute('tabindex', '-1');
  });
});
