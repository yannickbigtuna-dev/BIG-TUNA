// lib/email-campaigns.js
//
// Bulk email campaign sending for the admin dashboard's visual campaign builder.
// A thin sibling to lib/assignment-coach.js — reuses its Resend-backed sendEmail()
// and HMAC signAction()/verifyAction() helpers rather than re-implementing them,
// so the existing password-reset/test-email/assignment-digest paths can't regress.
//
// NOTE on assignment-coach.js exports: verifyAction is exported top-level, but
// signAction is NOT — it only appears nested under the `_test` sub-object in that
// file's module.exports. Confirmed by reading lib/assignment-coach.js's exports
// block directly (not guessed). Reused from there rather than duplicated here.

'use strict';

const fs     = require('fs');
const path   = require('path');

const assignmentCoach = require('./assignment-coach');
const { sendEmail, verifyAction } = assignmentCoach;
const { signAction } = assignmentCoach._test;

// Follows the same precedent as assignment-coach.js: compute its own data paths
// rather than importing server.js's directory constants.
const DATA_DIR      = path.join(__dirname, '..', 'data');
const USERS_FILE     = path.join(DATA_DIR, 'users.json');
const CAMPAIGNS_DIR  = path.join(DATA_DIR, 'email', 'campaigns');

const TRACKING_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — recipient may open weeks later
const SEND_DELAY_MS = 400; // sequential throttle between recipients, avoids Resend rate limits

// ── small local helpers (mirrors server.js's atomicWrite, mkdir-first) ───────
function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function campaignFile(id) {
  return path.join(CAMPAIGNS_DIR, id + '.json');
}

function readCampaign(id) {
  try { return JSON.parse(fs.readFileSync(campaignFile(id), 'utf8')); }
  catch { return null; }
}

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}

function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── signed open/click tracking tokens (reuses assignment-coach's signAction/verifyAction) ──
// Token format: "<expiresMs>.<hexSignature>" — verifyAction needs {userId,id,action,expires,sig}
// as separate fields, so we pack expires alongside the sig into one query-string-safe token.
function signTrackingToken(userId, campaignId, action, expiresAt) {
  return `${expiresAt}.${signAction(userId, campaignId, action, expiresAt)}`;
}

function verifyTrackingToken(userId, campaignId, action, token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const expires = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  return verifyAction({ userId, id: campaignId, action, expires, sig });
}

function trackingBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://yannickmorgans.ca').replace(/\/+$/, '');
}

function openPixelUrl(campaignId, recipientId) {
  const expires = Date.now() + TRACKING_TOKEN_TTL_MS;
  const t = signTrackingToken(recipientId, campaignId, 'campaign-open', expires);
  return `${trackingBaseUrl()}/api/admin/email/campaigns/${encodeURIComponent(campaignId)}/open?u=${encodeURIComponent(recipientId)}&t=${encodeURIComponent(t)}`;
}

function clickRedirectUrl(campaignId, recipientId, originalUrl) {
  const expires = Date.now() + TRACKING_TOKEN_TTL_MS;
  const t = signTrackingToken(recipientId, campaignId, 'campaign-click', expires);
  return `${trackingBaseUrl()}/api/admin/email/campaigns/${encodeURIComponent(campaignId)}/click?u=${encodeURIComponent(recipientId)}&t=${encodeURIComponent(t)}&url=${encodeURIComponent(originalUrl || '')}`;
}

// ── block rendering ───────────────────────────────────────────────────────────
// Mirrors digestHtml()'s inline-style conventions in lib/assignment-coach.js:
// inline styles only, system font stack, ~680px max width — email clients don't
// load external stylesheets, so tokens.css is never referenced here.
function renderBlock(block, campaignId, recipientId) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'heading':
      return `<h2 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:#111">${htmlEscape(block.text)}</h2>`;
    case 'text':
      return `<div style="margin:0 0 16px;font-size:15px;color:#333">${block.html || ''}</div>`;
    case 'button': {
      // Every button's URL is rewritten to route through the signed /click endpoint.
      const href = clickRedirectUrl(campaignId, recipientId, block.url || '');
      return `<p style="margin:0 0 20px"><a href="${htmlEscape(href)}" style="display:inline-block;padding:11px 22px;border-radius:7px;background:#2457a6;color:#fff;text-decoration:none;font-weight:700;font-size:15px">${htmlEscape(block.label || 'Learn more')}</a></p>`;
    }
    case 'image':
      return `<img src="${htmlEscape(block.src)}" alt="${htmlEscape(block.alt || '')}" style="max-width:100%;width:100%;display:block;margin:0 0 16px;border:0" />`;
    case 'divider':
      return `<div style="border-top:1px solid #e2e2e2;margin:18px 0;height:0;font-size:0;line-height:0">&nbsp;</div>`;
    default:
      return '';
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function blockPlainText(block) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'heading': return String(block.text || '').trim();
    case 'text':    return stripHtml(block.html);
    case 'button':  return block.url ? `${block.label || 'Learn more'}: ${block.url}` : '';
    case 'image':   return block.alt ? `[image: ${block.alt}]` : '';
    case 'divider': return '----------------------------------------';
    default:        return '';
  }
}

// Plain-text fallback for the whole campaign, generated from the same blocks.
function campaignPlainText(campaign) {
  const blocks = Array.isArray(campaign && campaign.blocks) ? campaign.blocks : [];
  return blocks.map(blockPlainText).filter(Boolean).join('\n\n');
}

// Compiles campaign.blocks into a single email-safe HTML string for one recipient,
// appending the open-tracking pixel and rewriting button URLs through /click.
function renderCampaignHtml(campaign, recipient) {
  const blocks = Array.isArray(campaign && campaign.blocks) ? campaign.blocks : [];
  const body = blocks.map(b => renderBlock(b, campaign.id, recipient.id)).join('\n    ');
  const pixel = `<img src="${htmlEscape(openPixelUrl(campaign.id, recipient.id))}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`;
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.45;color:#111;max-width:680px;margin:0 auto;padding:8px">
    ${body}
    ${pixel}
  </body></html>`;
}

// ── sending ───────────────────────────────────────────────────────────────────
// Resolves campaign.recipientIds against users.json, sends sequentially (~400ms
// apart, fine at <=~40 recipients), and writes sendResults[] back incrementally
// so a mid-send crash doesn't lose progress on already-sent recipients.
async function sendCampaign(campaignId) {
  const campaign = readCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const users = readUsers();
  const usersById = new Map(users.map(u => [u.id, u]));
  const recipientIds = Array.isArray(campaign.recipientIds) ? campaign.recipientIds : [];
  const text = campaignPlainText(campaign);

  campaign.status = 'sending';
  campaign.sendResults = [];
  atomicWrite(campaignFile(campaignId), campaign);

  for (let i = 0; i < recipientIds.length; i++) {
    const userId = recipientIds[i];
    const recipient = usersById.get(userId);

    const entry = {
      userId,
      email: recipient ? (recipient.email || null) : null,
      status: 'skipped',
      error: null,
      sentAt: null,
      opened: false,
      openedAt: null,
      clicks: [],
    };

    if (!recipient || !recipient.email) {
      entry.status = 'skipped';
      entry.error = 'No recovery email on file';
    } else {
      try {
        const html = renderCampaignHtml(campaign, recipient);
        const result = await sendEmail(recipient.email, {
          subject: campaign.subject,
          text,
          html,
          from: campaign.fromEmail,
        });
        if (result && result.skipped) {
          entry.status = 'failed';
          entry.error = result.reason || 'Email not sent';
        } else {
          entry.status = 'sent';
          entry.sentAt = new Date().toISOString();
        }
      } catch (err) {
        entry.status = 'failed';
        entry.error = err.message || 'Send failed';
      }
    }

    campaign.sendResults.push(entry);
    atomicWrite(campaignFile(campaignId), campaign);

    if (i < recipientIds.length - 1) {
      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    }
  }

  campaign.status = 'sent';
  campaign.sentAt = new Date().toISOString();
  atomicWrite(campaignFile(campaignId), campaign);

  return campaign;
}

// ── scheduler ─────────────────────────────────────────────────────────────────
// Copies startLightsScheduler()/tickLightsSchedule()'s pattern in server.js: a
// 60s setInterval tick, guarded by an in-memory Set of in-flight campaign IDs so
// a slow send loop can't be double-triggered by the next tick.
const inFlightCampaigns = new Set();

function listCampaignIds() {
  let files = [];
  try { files = fs.readdirSync(CAMPAIGNS_DIR); } catch { return []; }
  return files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp')).map(f => f.slice(0, -'.json'.length));
}

function tickCampaignSchedule() {
  const now = Date.now();
  for (const id of listCampaignIds()) {
    if (inFlightCampaigns.has(id)) continue;
    const campaign = readCampaign(id);
    if (!campaign || campaign.status !== 'scheduled' || !campaign.scheduledAt) continue;
    if (new Date(campaign.scheduledAt).getTime() > now) continue;

    inFlightCampaigns.add(id);
    sendCampaign(id)
      .catch(err => console.error(`[email-campaigns] send failed for ${id}:`, err.message))
      .finally(() => inFlightCampaigns.delete(id));
  }
}

function startCampaignScheduler() {
  tickCampaignSchedule();
  setInterval(tickCampaignSchedule, 60_000);
}

module.exports = {
  renderCampaignHtml,
  campaignPlainText,
  sendCampaign,
  startCampaignScheduler,
  tickCampaignSchedule,
  signTrackingToken,
  verifyTrackingToken,
};
