import { redirect } from 'next/navigation';

/**
 * Add-ons live as a tab inside the Services page. This route exists only to
 * redirect any old bookmarks or external links to the correct tab URL.
 */
export default function AddonsLibraryPage() {
  redirect('/dashboard/appointment-services?tab=addons');
}
