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

export const HELP_VIDEOS: Record<string, HelpVideoDef> = {
  'services-setup': {
    youtubeId: 'ARezQjb-NsA',
    title: 'Watch: setting up your services',
    caption: 'A walkthrough of building a service, from naming it to linking it to a calendar.',
  },
  'communications-setup': {
    youtubeId: 'DBCcKebhbKA',
    title: 'Watch: setting up your communication settings',
    caption: 'How to choose which messages go out, by email or SMS, and when they send.',
  },
  'booking-page-setup': {
    youtubeId: 'wx-FW6455Dg',
    title: 'Watch: setting up your booking page',
    caption: 'Setting your booking page address, branding it, and sharing the link with clients.',
  },
  'linked-venues-setup': {
    youtubeId: 'y_-fpQCHXO4',
    title: 'Watch: setting up linked venues and collectives',
    caption: 'How to link another venue, choose what you share, and set up a combined booking page.',
  },
};
