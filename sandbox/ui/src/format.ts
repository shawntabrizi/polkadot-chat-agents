export const shortHex = (hex: string | null | undefined, n = 6): string => (hex ? `${hex.slice(0, 2 + n)}…${hex.slice(-4)}` : '');

export const formatTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const formatIso = (iso: string | null | undefined): string => (iso ? formatTime(Date.parse(iso)) : '');

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
