import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { config } from '../../config/config';

/** Headers the Next.js server sets when it calls the API for a visitor. */
export const FORWARDED_IP_HEADER = 'x-rj-client-ip';
export const FORWARDED_UA_HEADER = 'x-rj-client-ua';
export const FORWARD_SECRET_HEADER = 'x-rj-forward-secret';

export interface ClientContext {
  ip?: string;
  userAgent?: string;
  /** Page the request came from, used as Meta's event_source_url. */
  referer?: string;
}

function header(req: any, name: string): string | undefined {
  const value = req?.headers?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first.trim() ? first.trim() : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeIp(ip?: string): string | undefined {
  if (!ip) return undefined;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** Server-side HTTP clients (Next.js fetch) are not the visitor's browser. */
function isServerUserAgent(ua?: string): boolean {
  return !ua || /^(node|undici)/i.test(ua);
}

/**
 * The visitor's IP and user agent for Meta matching.
 *
 * Forwarded headers are trusted only with the shared secret, because
 * POST /users is public and anyone could send them. Otherwise nginx's
 * X-Real-IP, then the first X-Forwarded-For entry, then the socket.
 */
export function getClientContext(req: any): ClientContext {
  const secret = config.tracking.forwardSecret;
  const sentSecret = header(req, FORWARD_SECRET_HEADER);
  const trusted = !!secret && !!sentSecret && safeEqual(secret, sentSecret);

  const forwardedFor = header(req, 'x-forwarded-for')?.split(',')[0]?.trim();
  const ip = trusted
    ? header(req, FORWARDED_IP_HEADER)
    : header(req, 'x-real-ip') || forwardedFor || req?.socket?.remoteAddress;

  const userAgent = trusted
    ? header(req, FORWARDED_UA_HEADER)
    : header(req, 'user-agent');

  return {
    ip: normalizeIp(ip),
    userAgent: isServerUserAgent(userAgent) ? undefined : userAgent,
    referer: header(req, 'referer'),
  };
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** `pay_Nq8x2Lk9AbCd` → `pay_…AbCd`. Keeps ids recognisable in logs without exposing them. */
export function maskId(id?: string): string | undefined {
  if (!id) return undefined;
  const underscore = id.indexOf('_');
  const prefix =
    underscore > 0 && underscore < 8 ? id.slice(0, underscore + 1) : '';
  return `${prefix}…${id.slice(-4)}`;
}

/**
 * One structured log line: `<type> {"key":"value",...}`.
 * Never pass emails, phone numbers or tokens in `fields`.
 */
export function logEvent(
  logger: Logger,
  type: string,
  fields: Record<string, unknown>,
  level: 'log' | 'warn' = 'log',
): void {
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  logger[level](`${type} ${JSON.stringify(clean)}`);
}
