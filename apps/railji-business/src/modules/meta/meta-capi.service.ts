import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config/config';
import { ClientContext, logEvent, maskId, sha256 } from './tracking.utils';

export type MetaEventName =
  'CompleteRegistration' | 'InitiateCheckout' | 'Purchase';

export interface MetaEventInput {
  eventName: MetaEventName;
  /** Same id the browser Pixel uses, so Meta dedupes the two copies. */
  eventId: string;
  /** Page the conversion happened on; falls back to the request Referer, then SITE_URL. */
  eventSourcePath?: string;
  client?: ClientContext;
  email?: string;
  /** Our business userId; hashed before sending. */
  externalId?: string;
  fbp?: string;
  fbc?: string;
  customData?: Record<string, unknown>;
}

export interface ExclusionInput {
  internalFlag?: boolean;
  email?: string;
  userType?: string;
  trackingExcluded?: boolean;
}

/**
 * Sends server-side events to the Meta Conversions API.
 *
 * `send()` is fire-and-forget: it returns immediately, never throws, and
 * gives up after META_CAPI_TIMEOUT_MS. Callers must not await it, so a slow
 * or failing Meta API can never delay or fail a signup or a webhook.
 */
@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  isEnabled(): boolean {
    return !!config.meta.pixelId && !!config.meta.accessToken;
  }

  isInternalEmail(email?: string): boolean {
    if (!email) return false;
    const normalized = email.trim().toLowerCase();
    return config.tracking.internalEmails.some((entry) =>
      entry.startsWith('@') ? normalized.endsWith(entry) : normalized === entry,
    );
  }

  /** Our own traffic: flagged browser, listed test account, or an admin. */
  isExcluded({
    internalFlag,
    email,
    userType,
    trackingExcluded,
  }: ExclusionInput): boolean {
    return (
      internalFlag === true ||
      trackingExcluded === true ||
      userType === 'admin' ||
      userType === 'superadmin' ||
      this.isInternalEmail(email)
    );
  }

  send(event: MetaEventInput): void {
    const logFields = {
      event_name: event.eventName,
      event_id: maskId(event.eventId),
    };

    if (!this.isEnabled()) {
      logEvent(this.logger, 'meta_capi', {
        ...logFields,
        status: 'skipped',
        reason: 'not_configured',
      });
      return;
    }

    this.post(event).catch((error) => {
      // post() handles its own errors; this is a last-resort guard.
      logEvent(
        this.logger,
        'meta_capi',
        { ...logFields, status: 'failed', error: error?.message },
        'warn',
      );
    });
  }

  private buildPayload(event: MetaEventInput) {
    const { client = {} } = event;
    const userData: Record<string, unknown> = {};

    if (event.email) userData.em = [sha256(event.email.trim().toLowerCase())];
    if (event.externalId) userData.external_id = [sha256(event.externalId)];
    if (client.ip) userData.client_ip_address = client.ip;
    if (client.userAgent) userData.client_user_agent = client.userAgent;
    if (event.fbp) userData.fbp = event.fbp;
    if (event.fbc) userData.fbc = event.fbc;

    const eventSourceUrl = event.eventSourcePath
      ? `${config.tracking.siteUrl}${event.eventSourcePath}`
      : client.referer || config.tracking.siteUrl;

    return {
      data: [
        {
          event_name: event.eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: event.eventId,
          // Meta rejects website events without a user agent.
          action_source: client.userAgent ? 'website' : 'system_generated',
          event_source_url: eventSourceUrl,
          user_data: userData,
          ...(event.customData ? { custom_data: event.customData } : {}),
        },
      ],
      ...(config.meta.testEventCode
        ? { test_event_code: config.meta.testEventCode }
        : {}),
      access_token: config.meta.accessToken,
    };
  }

  private async post(event: MetaEventInput): Promise<void> {
    const startedAt = Date.now();
    const logFields = {
      event_name: event.eventName,
      event_id: maskId(event.eventId),
      test: config.meta.testEventCode ? true : undefined,
    };
    const url = `https://graph.facebook.com/${config.meta.graphApiVersion}/${config.meta.pixelId}/events`;

    try {
      // The token travels in the body, not the URL, so it can't end up in a logged URL.
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildPayload(event)),
        signal: AbortSignal.timeout(config.meta.timeoutMs),
      });
      const body: any = await response.json().catch(() => ({}));
      const ms = Date.now() - startedAt;

      if (!response.ok) {
        logEvent(
          this.logger,
          'meta_capi',
          {
            ...logFields,
            status: 'failed',
            http_status: response.status,
            error: body?.error?.message,
            error_code: body?.error?.code,
            fbtrace_id: body?.error?.fbtrace_id,
            ms,
          },
          'warn',
        );
        return;
      }

      logEvent(this.logger, 'meta_capi', {
        ...logFields,
        status: 'sent',
        events_received: body?.events_received,
        ms,
      });
    } catch (error) {
      const timedOut =
        error?.name === 'TimeoutError' || error?.name === 'AbortError';
      logEvent(
        this.logger,
        'meta_capi',
        {
          ...logFields,
          status: 'failed',
          error: timedOut ? 'timeout' : error?.message,
          ms: Date.now() - startedAt,
        },
        'warn',
      );
    }
  }
}
