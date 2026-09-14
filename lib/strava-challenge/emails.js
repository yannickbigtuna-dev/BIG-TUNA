'use strict';
const { PARTICIPANTS } = require('./domain');
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function interpolateTemplate(text, data = {}) {
  if (typeof text !== 'string') return '';
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}|\$\{\s*([^${}\s]+)\s*\}|\{\s*([^{}\s]+)\s*\}/g, (match, p1, p2, p3) => {
    const key = p1 || p2 || p3;
    if (data && Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined && data[key] !== null) {
      return String(data[key]);
    }
    return match;
  });
}
function formatEmailBody(body) {
  if (typeof body !== 'string') return '';
  const trimmed = body.trim();
  if (!trimmed) return '';
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}
function formatDuration(seconds = 0, detailed = false) { seconds = Math.max(0, Math.floor(Number(seconds) || 0)); const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60; return detailed ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : h ? `${h}h ${m}m` : `${m}m${m ? '' : ` ${s}s`}`; }
function participant(id) { return PARTICIPANTS[id] || { name: String(id || 'Athlete'), color: 'blue' }; }
function emailShell({ title, body, color }) { const safeTitle = escapeHtml(title); return { text: `${title}\n\n${body.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ')}`, html: `<!doctype html><html><body style="margin:0;background:#101319;color:#f8fafc;font-family:Arial,sans-serif"><main style="max-width:560px;margin:24px auto;padding:28px;background:#1b2230;border-top:6px solid ${color === 'red' ? '#e53935' : '#3182ce'}"><h1 style="margin:0 0 18px;font-size:25px;color:#fff">${safeTitle}</h1>${body}</main></body></html>` }; }
function renderConnectionEmail({ participantId, connectUrl, expiresAt } = {}) { const p = participant(participantId); const expiry = expiresAt ? ` This invitation expires ${escapeHtml(new Date(expiresAt).toLocaleString('en-CA'))}.` : ''; const title = 'Connect your Strava to the challenge'; const body = `<p>You’re invited to connect your Strava account to the Yannick vs Emma Strava Challenge.${expiry}</p><p><a href="${escapeHtml(connectUrl)}" style="display:inline-block;padding:13px 18px;background:${p.color === 'red' ? '#e53935' : '#3182ce'};color:#fff;text-decoration:none;font-weight:bold">Connect ${escapeHtml(p.name)}’s Strava</a></p><p>This link is personal and can only connect ${escapeHtml(p.name)}’s challenge slot.</p>`; return { subject: title, ...emailShell({ title, body, color: p.color }) }; }
function renderWeeklyEmails(result = {}, options = {}) { const url = options.weekUrl || result.weekUrl || ''; const y = result.yannick || {}, e = result.emma || {}; const score = `${y.qualifyingActivities || 0}–${e.qualifyingActivities || 0}`; const season = result.seasonScoreAfter || options.seasonScoreAfter || {}; const seasonText = `Season score: Yannick ${season.yannick ?? 0} — ${season.emma ?? 0} Emma.`; const link = url ? `<p><a href="${escapeHtml(url)}" style="color:#93c5fd">View the week’s result</a></p>` : ''; const emails = {};
  if (!result.winner) { for (const id of ['yannick', 'emma']) { const p = participant(id); const title = 'Strava battle ends in a draw'; const body = `<p>You both finished with ${escapeHtml(score)} qualifying activities and exactly ${escapeHtml(formatDuration(y.qualifyingActivityTime, true))}. No point was awarded.</p><p>${escapeHtml(seasonText)}</p>${link}`; emails[id] = { subject: title, ...emailShell({ title, body, color: p.color }), templateId: null }; } return emails; }
  const winner = participant(result.winner), loserId = result.winner === 'yannick' ? 'emma' : 'yannick', loser = participant(loserId); const tie = result.winningMethod === 'activity_time_tiebreaker'; const winnerTitle = tie ? 'You won the tiebreaker' : 'You won this week’s Strava battle'; const loserTitle = tie ? 'Beaten on the tiebreaker' : 'You lost this week’s Strava battle'; const wt = (result[result.winner] && result[result.winner].qualifyingActivityTime) || 0, lt = (result[loserId] && result[loserId].qualifyingActivityTime) || 0; const margin = formatDuration(Math.abs(wt - lt)); const winCopy = tie ? `You both finished with ${score} qualifying activities, but you logged ${formatDuration(wt)} compared with ${formatDuration(lt)}. Point secured.` : `Big week. You took it ${score} and picked up another point.`; const loseCopy = tie ? `You both managed ${score} qualifying activities, but ${winner.name} logged ${margin} more. That’s a painful way to lose one.` : `Rough week. ${winner.name} took this one ${score}. You’ve got seven days to fix that.`;
  const poolList = options.emailPool ? (Array.isArray(options.emailPool) ? options.emailPool : Object.values(options.emailPool)) : null;
  let winTemplate = options.winTemplate || null;
  if (typeof winTemplate === 'string' && poolList) winTemplate = poolList.find(t => t && t.id === winTemplate) || null;
  let lossTemplate = options.lossTemplate || null;
  if (typeof lossTemplate === 'string' && poolList) lossTemplate = poolList.find(t => t && t.id === lossTemplate) || null;
  if (poolList) {
    const activePool = poolList.filter(t => t && t.active !== false);
    if (!winTemplate) {
      let winCandidates = activePool.filter(t => t.type === (tie ? 'tiebreaker_win' : 'win'));
      if (tie && !winCandidates.length) winCandidates = activePool.filter(t => t.type === 'win');
      if (winCandidates.length) winTemplate = winCandidates[Math.floor(Math.random() * winCandidates.length)];
    }
    if (!lossTemplate) {
      let lossCandidates = activePool.filter(t => t.type === (tie ? 'tiebreaker_loss' : 'loss'));
      if (tie && !lossCandidates.length) lossCandidates = activePool.filter(t => t.type === 'loss');
      if (lossCandidates.length) lossTemplate = lossCandidates[Math.floor(Math.random() * lossCandidates.length)];
    }
  }
  const seasonScoreStr = typeof options.seasonScore === 'string' ? options.seasonScore : `${season.yannick ?? 0}–${season.emma ?? 0}`;
  const templateData = { score, winner: winner.name, loser: loser.name, margin, winner_time: formatDuration(wt), loser_time: formatDuration(lt), season_score: seasonScoreStr, seasonScore: seasonScoreStr, week_start: result.weekStart || options.weekStart || '', weekStart: result.weekStart || options.weekStart || '' };
  const winSubject = winTemplate ? interpolateTemplate(winTemplate.subject, templateData) : winnerTitle;
  const winBodyFormatted = winTemplate ? formatEmailBody(interpolateTemplate(winTemplate.body, templateData)) : `<p>${escapeHtml(winCopy)}</p>`;
  const winFullBody = `${winBodyFormatted}<p>${escapeHtml(seasonText)}</p>${link}`;
  const lossSubject = lossTemplate ? interpolateTemplate(lossTemplate.subject, templateData) : loserTitle;
  const lossBodyFormatted = lossTemplate ? formatEmailBody(interpolateTemplate(lossTemplate.body, templateData)) : `<p>${escapeHtml(loseCopy)}</p>`;
  const lossFullBody = `${lossBodyFormatted}<p>${escapeHtml(seasonText)}</p>${link}`;
  emails[result.winner] = { subject: winSubject, ...emailShell({ title: winSubject, body: winFullBody, color: winner.color }), templateId: winTemplate ? (winTemplate.id || null) : null };
  emails[loserId] = { subject: lossSubject, ...emailShell({ title: lossSubject, body: lossFullBody, color: loser.color }), templateId: lossTemplate ? (lossTemplate.id || null) : null };
  return emails;
}
function previewFixtures() { return { countWin: renderWeeklyEmails({ winner: 'yannick', winningMethod: 'activity_count', yannick: { qualifyingActivities: 6, qualifyingActivityTime: 5000 }, emma: { qualifyingActivities: 4, qualifyingActivityTime: 3000 }, seasonScoreAfter: { yannick: 2, emma: 1 } }), trueTie: renderWeeklyEmails({ winner: null, yannick: { qualifyingActivities: 5, qualifyingActivityTime: 3600 }, emma: { qualifyingActivities: 5, qualifyingActivityTime: 3600 } }) }; }
module.exports = { escapeHtml, formatDuration, interpolateTemplate, formatEmailBody, renderConnectionEmail, renderWeeklyEmails, previewFixtures };
