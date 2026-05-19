import type { Story } from '@ladle/react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { FormField } from './FormField';
import { Input } from './Input';
import { Sheet } from './Sheet';
import { useState } from 'react';

export const ButtonVariants: Story = () => (
  <div className="flex flex-wrap gap-2 p-4">
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Danger</Button>
    <Button variant="link">Link</Button>
  </div>
);

export const DialogConfirm: Story = () => {
  const [open, setOpen] = useState(true);
  return (
  <div className="p-4">
    <Button onClick={() => setOpen(true)}>Open dialog</Button>
    <Dialog open={open} onOpenChange={setOpen} title="Confirm action" description="This cannot be undone.">
      <p className="text-sm text-slate-600">Example body content.</p>
    </Dialog>
  </div>
  );
};

export const FormFieldError: Story = () => (
  <div className="max-w-sm p-4">
    <FormField label="Email" error="Enter a valid email" required>
      <Input type="email" defaultValue="not-an-email" />
    </FormField>
  </div>
);

export const SheetDrawer: Story = () => {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-4">
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onOpenChange={setOpen} title="Booking detail" side="right">
        <p className="p-4 text-sm text-slate-600">Drawer content</p>
      </Sheet>
    </div>
  );
};
