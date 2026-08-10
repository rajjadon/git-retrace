import { createHash } from 'node:crypto';

export interface GravatarOptions {
  size?: number;
  /** Gravatar's fallback image style when no avatar is registered for the email. */
  default?: 'identicon' | 'mp' | 'retro' | 'robohash' | 'wavatar';
}

// MD5 is Gravatar's own hashing spec for the avatar lookup key (not a security use of
// the hash) — https://docs.gravatar.com/api/avatars/images/. Do not "upgrade" this.
export function buildGravatarUrl(email: string, opts: GravatarOptions = {}): string {
  const hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  const size = opts.size ?? 64;
  const fallback = opts.default ?? 'identicon';
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${fallback}`;
}
