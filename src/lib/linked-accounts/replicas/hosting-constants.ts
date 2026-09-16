/**
 * The consent a venue is shown before it agrees to host a collective (UX spec `transfer.accept.*`;
 * plan contract 8). Shared by the dialog that shows it and the route that checks it, so a change
 * to the wording is a change to this version, and an old dialog's answer is refused.
 */
export const HOST_TRANSFER_CONSENT_VERSION = 'host-transfer-2026-09';

/** The consent a venue gives when it joins a collective (UX spec `join.consent`; contract 6). */
export const JOIN_CONSENT_VERSION = 'join-2026-09';
