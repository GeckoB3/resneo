import { describe, expect, it } from 'vitest';
import { FALLBACK_SENTENCE } from './prompt';
import { countWords, isAllowedHref, postprocessAnswer, startsWithFallback } from './postprocess';

const corpus = {
  hrefs: new Set(['/help/appointments/deposits', '/help/getting-started/services']),
  videoIds: new Set(['96Nw37-Kfrg']),
};

/** Docs/help-assistant-plan.md, 2.5 and 5.1. */
describe('postprocessAnswer', () => {
  it('keeps links to real help pages and records them as citations', () => {
    const r = postprocessAnswer('Do this.\n\nRead more: [Deposits](/help/appointments/deposits) and [Services](/help/getting-started/services#step-3)', corpus);
    expect(r.text).toContain('[Deposits](/help/appointments/deposits)');
    expect(r.text).toContain('[Services](/help/getting-started/services#step-3)');
    expect(r.citations).toEqual(['appointments/deposits', 'getting-started/services']);
    expect(r.droppedLinks).toBe(0);
    expect(r.answered).toBe(true);
  });

  it('turns links to pages that do not exist back into plain text', () => {
    const r = postprocessAnswer('See [Payroll](/help/getting-started/payroll) and [Xero](https://xero.com) for more.', corpus);
    expect(r.text).toBe('See Payroll and Xero for more.');
    expect(r.citations).toEqual([]);
    expect(r.droppedLinks).toBe(2);
  });

  it('allows listed videos and dashboard paths, and nothing else', () => {
    expect(isAllowedHref('https://youtu.be/96Nw37-Kfrg', corpus)).toBe(true);
    expect(isAllowedHref('https://www.youtube.com/watch?v=96Nw37-Kfrg', corpus)).toBe(true);
    expect(isAllowedHref('https://youtu.be/notlisted1', corpus)).toBe(false);
    expect(isAllowedHref('/dashboard/settings?tab=payments', corpus)).toBe(true);
    expect(isAllowedHref('/help/appointments/deposits/', corpus)).toBe(true);
    expect(isAllowedHref('mailto:support@resneo.com', corpus)).toBe(false);
    expect(isAllowedHref('javascript:alert(1)', corpus)).toBe(false);
  });

  it('deduplicates citations', () => {
    const r = postprocessAnswer('[a](/help/appointments/deposits) [b](/help/appointments/deposits)', corpus);
    expect(r.citations).toEqual(['appointments/deposits']);
  });

  it('flags the fallback sentence as unanswered, whichever apostrophe the model used', () => {
    expect(startsWithFallback(FALLBACK_SENTENCE + ' Try Support.')).toBe(true);
    expect(startsWithFallback(FALLBACK_SENTENCE.replace(/'/g, '’'))).toBe(true);
    expect(startsWithFallback('  ' + FALLBACK_SENTENCE)).toBe(true);
    expect(startsWithFallback('Here is how.')).toBe(false);
    expect(postprocessAnswer(FALLBACK_SENTENCE, corpus).answered).toBe(false);
  });

  it('counts words', () => {
    expect(countWords('one two  three\nfour')).toBe(4);
    expect(postprocessAnswer('1. Go to **Settings**.', corpus).words).toBe(4);
  });
});
