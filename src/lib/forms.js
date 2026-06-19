// RESILIENCE — form craft helpers.
//
// Spread `numericInputProps` onto any score / jersey / count input to get the
// phone numeric keypad (inputMode) + the iOS numeric keypad (pattern) and turn
// off autofill noise. `clampInt` sanitizes a raw string to an in-range integer
// for inline validation.
//
//   <input {...numericInputProps} value={n} onChange={e => setN(clampInt(e.target.value, 0, 99))} />

// `type` stays "text": type="number" brings spinners, locale-comma parsing, and
// scroll-to-change footguns. inputMode + pattern get the numeric keypad without
// any of that.
export const numericInputProps = {
  type: 'text',
  inputMode: 'numeric',
  pattern: '[0-9]*',
  autoComplete: 'off',
};

// Strip to digits, optionally clamp to [min,max]. Returns '' for empty so a
// field can be cleared. Use in onChange for live, inline sanitization.
export function clampInt(raw, min, max) {
  const digits = String(raw == null ? '' : raw).replace(/[^\d]/g, '');
  if (digits === '') return '';
  let n = parseInt(digits, 10);
  if (Number.isNaN(n)) return '';
  if (min != null && n < min) n = min;
  if (max != null && n > max) n = max;
  return String(n);
}

// Autocomplete tokens for the common identity fields — pass straight to the
// matching input so password managers + OS autofill light up correctly.
export const AUTOCOMPLETE = {
  email: 'email',
  currentPassword: 'current-password',
  newPassword: 'new-password',
  name: 'name',
  username: 'username',
  oneTimeCode: 'one-time-code',
};
