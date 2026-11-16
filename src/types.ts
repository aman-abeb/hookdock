import type { IncomingHttpHeaders } from 'node:http';

/**
 * A single captured webhook request, as stored in memory and returned by the JSON API.
 */
export interface HookRequest {
  /** Unique identifier (UUID v4) assigned at capture time. */
  id: string;
  /** Hook name taken from the `/hook/:name` path segment. */
  name: string;
  /** HTTP method of the captured request (POST, PUT, ...). */
  method: string;
  /** Request path without the query string, e.g. `/hook/test`. */
  path: string;
  /** Parsed query string parameters. */
  query: Record<string, unknown>;
  /** Request headers exactly as received (lower-cased by Node). */
  headers: IncomingHttpHeaders;
  /** Raw request body decoded as UTF-8 text (empty string when there was no body). */
  rawBody: string;
  /** Parsed JSON body when the content type is JSON and parsing succeeds; otherwise `undefined`. */
  body: unknown;
  /** Value of the `Content-Type` header, if the request had one. */
  contentType: string | undefined;
  /** ISO-8601 timestamp of when the request was captured. */
  receivedAt: string;
}
