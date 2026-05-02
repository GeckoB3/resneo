import { redirect } from 'next/navigation';

/** Bookmarks and old links: guest management lives under Contacts. */
export default function GuestsPage() {
  redirect('/dashboard/contacts');
}
