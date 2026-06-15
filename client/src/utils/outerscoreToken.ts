/**
 * In-memory holder for the Outerscore access token inside the LibreChat iframe.
 *
 * The token never touches sessionStorage / localStorage. The parent re-sends
 * it on every iframe boot (after `outerscore:ready`) and on every token
 * refresh, so persistence isn't needed — and keeping it out of any
 * JS-readable storage shrinks the XSS exfiltration surface to "live tab,
 * script already running" instead of "any future code on this origin".
 */
let token: string | null = null;

export const getOuterscoreToken = (): string | null => token;

export const setOuterscoreToken = (next: string): void => {
  token = next;
};

export const clearOuterscoreToken = (): void => {
  token = null;
};
