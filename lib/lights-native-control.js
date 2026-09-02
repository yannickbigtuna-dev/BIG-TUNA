'use strict';

// The website/ESP contract stores an inverted relay value.  Native clients use
// physical-light terms exclusively; this adapter is the one translation point.
const MAX_COMMAND_ID_LENGTH = 128;
const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function createNativeLightsControl({
  readDesired,
  writeDesired,
  readDeviceStatus,
  invertOutput = true,
  recentWindowMs = 5000,
  now = () => Date.now(),
  commandTtlMs = 10 * 60 * 1000,
  maxRememberedCommands = 256,
  loadCommands = () => [],
  saveCommands = () => {},
}) {
  if (typeof readDesired !== 'function' || typeof writeDesired !== 'function' || typeof readDeviceStatus !== 'function') {
    throw new TypeError('Native Lights control requires desired-state and device-status readers plus a writer');
  }

  const commands = new Map();
  for (const entry of loadCommands()) {
    if (entry && validateCommandId(entry.id) && typeof entry.targetOn === 'boolean'
        && Number.isFinite(entry.at) && entry.response && typeof entry.response === 'object') {
      commands.set(entry.id, { at: entry.at, targetOn: entry.targetOn, response: entry.response });
    }
  }
  let mutationTail = Promise.resolve();

  function physicalFromStored(storedOn) {
    return invertOutput ? storedOn !== true : storedOn === true;
  }

  function storedFromPhysical(physicalOn) {
    return invertOutput ? physicalOn !== true : physicalOn === true;
  }

  function cleanCommands(timestamp) {
    for (const [id, value] of commands) {
      if (timestamp - value.at > commandTtlMs) commands.delete(id);
    }
    while (commands.size > maxRememberedCommands) commands.delete(commands.keys().next().value);
  }

  function persistCommands() {
    saveCommands(Array.from(commands, ([id, value]) => ({ id, ...value })));
  }

  function snapshot() {
    const desired = readDesired() || {};
    const device = readDeviceStatus() || {};
    const timestamp = now();
    const receivedAtMs = Date.parse(device.receivedAt || '');
    const polledAtMs = Date.parse(device.polledAt || '');
    const reportedKnown = Number.isFinite(receivedAtMs);
    const recentlyPolled = Number.isFinite(polledAtMs)
      && timestamp - polledAtMs >= 0
      && timestamp - polledAtMs <= recentWindowMs;

    return {
      physicalOn: physicalFromStored(desired.on),
      reportedPhysicalOn: reportedKnown && typeof device.on === 'boolean' ? device.on : null,
      recentlyPolled,
      revision: String(Number.isSafeInteger(desired.revision) && desired.revision >= 0 ? desired.revision : 0),
      updatedAt: typeof desired.updatedAt === 'string' ? desired.updatedAt : new Date(0).toISOString(),
    };
  }

  function validateCommandId(commandId) {
    return typeof commandId === 'string'
      && commandId.length <= MAX_COMMAND_ID_LENGTH
      && COMMAND_ID_RE.test(commandId);
  }

  async function setTarget({ targetOn, commandId, updatedBy }) {
    if (typeof targetOn !== 'boolean') {
      const error = new Error('targetOn must be boolean');
      error.code = 'INVALID_TARGET';
      throw error;
    }
    if (!validateCommandId(commandId)) {
      const error = new Error('commandId must be 1-128 URL-safe characters');
      error.code = 'INVALID_COMMAND_ID';
      throw error;
    }

    const run = async () => {
      const timestamp = now();
      cleanCommands(timestamp);
      const remembered = commands.get(commandId);
      if (remembered) {
        if (remembered.targetOn !== targetOn) {
          const error = new Error('commandId was already used for a different target');
          error.code = 'COMMAND_ID_CONFLICT';
          throw error;
        }
        return remembered.response;
      }

      const before = snapshot();
      if (before.physicalOn !== targetOn) writeDesired(storedFromPhysical(targetOn), updatedBy);
      const response = snapshot();
      commands.set(commandId, { at: timestamp, targetOn, response });
      cleanCommands(timestamp);
      persistCommands();
      return response;
    };
    const result = mutationTail.then(run, run);
    mutationTail = result.catch(() => {});
    return result;
  }

  return Object.freeze({ getState: snapshot, setTarget, validateCommandId });
}

module.exports = { createNativeLightsControl, MAX_COMMAND_ID_LENGTH };
