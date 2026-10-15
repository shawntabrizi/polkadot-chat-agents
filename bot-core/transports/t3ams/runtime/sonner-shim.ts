// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * `sonner` for an agent: there is no screen to toast on. The real package
 * injects its stylesheet into `document.head` as it loads.
 */

const silent = (): string => "";

export const toast = Object.assign(silent, {
  success: silent,
  error: silent,
  info: silent,
  warning: silent,
  message: silent,
  loading: silent,
  dismiss: (): void => {},
});

export function Toaster(): null {
  return null;
}
