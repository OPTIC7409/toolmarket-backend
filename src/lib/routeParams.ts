import { HttpError } from './httpError.js';

export function singleParam(value: string | string[] | undefined, label = 'id'): string {
  if (value === undefined) throw new HttpError(400, `Missing ${label}`);
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) throw new HttpError(400, `Missing ${label}`);
  return v;
}
