/**
 * Walkthrough videos embedded in help articles.
 *
 * An article references one with a `:::help-video <id>` marker on its own line,
 * the same mechanism as `:::help-figure`. Titles and captions live here rather
 * than in the markdown so the copy stays out of the search index body and every
 * embed is framed identically.
 *
 * `youtubeId` is the id only (the part after `youtu.be/`), never a full share
 * URL: the player URL is built in HelpVideo so privacy and player options are
 * applied in one place.
 */
export interface HelpVideoDef {
  youtubeId: string;
  title: string;
  caption?: string;
}

export const HELP_VIDEOS = {
  'dashboard-tour': {
    youtubeId: 'l8afPZWnpd8',
    title: 'Watch: onboarding and a tour of your dashboard',
    caption: 'Your first sign-in, the setup wizard, and where each tool lives once you are in.',
  },
  'services-setup': {
    youtubeId: '96Nw37-Kfrg',
    title: 'Watch: setting up your services',
    caption: 'A walkthrough of building a service, from naming it to linking it to a calendar.',
  },
  'communications-setup': {
    youtubeId: '4NpaZxd11mA',
    title: 'Watch: setting up your communication settings',
    caption: 'How to choose which messages go out, by email or SMS, and when they send.',
  },
  'booking-page-setup': {
    youtubeId: 'ScW3XxcciHE',
    title: 'Watch: setting up your booking page',
    caption: 'Setting your booking page address, branding it, and sharing the link with clients.',
  },
  'linked-venues-setup': {
    youtubeId: 'M1SF8ZFMXSE',
    title: 'Watch: setting up linked venues and collectives',
    caption: 'How to link another venue, choose what you share, and set up a combined booking page.',
  },
} satisfies Record<string, HelpVideoDef>;

/**
 * The known video ids. Declared through `satisfies` above so non-article callers (the
 * welcome email links to the same videos) fail to compile if an id is renamed here.
 */
export type HelpVideoId = keyof typeof HELP_VIDEOS;
