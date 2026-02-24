import type { BaseConfig, InputConfig, SessionConfig, RawStoredConfig, ButtonPosition } from '../types';

/**
 * Detect whether a stored config is in the old (legacy) format.
 * Legacy configs have `leftButton`/`middleButton`/`rightButton` fields
 * and no `inputs` array.
 */
function isLegacyConfig(raw: RawStoredConfig): boolean {
  return !Array.isArray(raw.inputs) && raw.leftButton != null;
}

/**
 * Convert an old-format config to the new unified input model.
 * Handles:
 * - leftButton/middleButton/rightButton → screen InputConfig entries
 * - buttonActive + global rewards → isRewarded on the matching screen input
 * - externalInputs[] → physical InputConfig entries
 */
function convertLegacyConfig(raw: RawStoredConfig): BaseConfig {
  const inputs: InputConfig[] = [];

  const positions: ButtonPosition[] = ['left', 'middle', 'right'];
  for (const pos of positions) {
    const btn = raw[`${pos}Button`];
    if (!btn) continue;

    const isActive = raw.buttonActive === pos;
    inputs.push({
      id: `screen-${pos}`,
      name: `${pos.charAt(0).toUpperCase()}${pos.slice(1)}`,
      type: 'screen',
      shape: btn.shape ?? 'circle',
      color: btn.color ?? '#5ccc96',
      isRewarded: isActive,
      moneyAwarded: isActive ? (raw.moneyAwarded ?? 5) : 5,
      awardInterval: isActive ? (raw.awardInterval ?? 10) : 10,
      playAwardSound: isActive ? (raw.playAwardSound ?? true) : true,
    });
  }

  // Convert external inputs
  if (Array.isArray(raw.externalInputs)) {
    for (const ext of raw.externalInputs) {
      inputs.push({
        id: ext.id,
        name: ext.name ?? '',
        type: ext.inputType ?? 'keyboard',
        inputCode: ext.inputCode,
        inputLabel: ext.inputLabel,
        isRewarded: ext.isActive ?? false,
        moneyAwarded: ext.moneyAwarded ?? 5,
        awardInterval: ext.awardInterval ?? 10,
        playAwardSound: ext.playAwardSound ?? true,
      });
    }
  }

  return {
    timeLimit: raw.timeLimit ?? 60,
    moneyLimit: raw.moneyLimit ?? 1000000,
    startingMoney: raw.startingMoney ?? 0,
    continueAfterMoneyLimit: raw.continueAfterMoneyLimit ?? true,
    inputs,
  };
}

/**
 * Normalize any stored config (old or new format) into the current BaseConfig shape.
 */
export function normalizeConfig(raw: RawStoredConfig): BaseConfig {
  if (isLegacyConfig(raw)) {
    return convertLegacyConfig(raw);
  }

  // Already in new format
  return {
    timeLimit: raw.timeLimit ?? 60,
    moneyLimit: raw.moneyLimit ?? 1000000,
    startingMoney: raw.startingMoney ?? 0,
    continueAfterMoneyLimit: raw.continueAfterMoneyLimit ?? true,
    inputs: raw.inputs ?? [],
  };
}

/**
 * Normalize a raw stored config into a SessionConfig (with sessionId/configId).
 */
export function normalizeSessionConfig(
  raw: RawStoredConfig,
  sessionId: string,
  configId: string = '',
): SessionConfig {
  const base = normalizeConfig(raw);
  return {
    sessionId,
    configId,
    ...base,
  };
}
