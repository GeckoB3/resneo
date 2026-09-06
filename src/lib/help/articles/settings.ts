import type { HelpCategory } from '../types';
import { article as overview } from './settings/overview';
import { article as businessHours } from './settings/business-hours';
import { article as staffAccounts } from './settings/staff-accounts';
import { article as planBilling } from './settings/plan-billing';
import { article as guestManagement } from './settings/guest-management';
import { article as dataExport } from './settings/data-export';

export const settingsCategory: HelpCategory = {
  slug: 'settings',
  title: 'Settings & account',
  description:
    'Venue Settings for admins, Account for staff, hours, plan, Stripe, comms, team, imports, and how they relate to Contacts and Reports.',
  plan: 'all',
  articles: [overview, businessHours, staffAccounts, planBilling, guestManagement, dataExport],
};
