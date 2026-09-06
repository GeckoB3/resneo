import type { HelpCategory } from '../types';
import { article as stripeIssues } from './troubleshooting/stripe-issues';
import { article as smsIssues } from './troubleshooting/sms-issues';
import { article as availabilityIssues } from './troubleshooting/availability-issues';
import { article as importIssues } from './troubleshooting/import-issues';
import { article as accessIssues } from './troubleshooting/access-issues';

export const troubleshootingCategory: HelpCategory = {
  slug: 'troubleshooting',
  title: 'Troubleshooting',
  description:
    'Stripe Connect, SMS, availability, CSV imports, and access problems.',
  plan: 'all',
  articles: [stripeIssues, smsIssues, availabilityIssues, importIssues, accessIssues],
};
