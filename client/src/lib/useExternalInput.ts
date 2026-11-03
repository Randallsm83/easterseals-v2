import { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { InputConfig } from '../types';

interface UseExternalInputOptions {
  inputs: InputConfig[];  // physical inputs only (non-screen)
  onInput: (inputId: string, inputType: string) => void;
  enabled: boolean;
  tracking?: boolean;
  debounceMs?: number;
  boundaryKey?: string;
}


function isGamepadPressed(input: InputConfig, gamepads: readonly (Gamepad | null)[]): boolean {
  if (!input.inputCode) return false;
  const parts = input.inputCode.split('-');
  const gamepad = gamepads[Number(parts[1])];
  if (!gamepad) return false;
  if (input.type === 'gamepad_button') return gamepad.buttons[Number(parts[3])]?.pressed ?? false;
  const value = gamepad.axes[Number(parts[3])] ?? 0;
  return parts[4] === 'pos' ? value > 0.5 : value < -0.5;
}
/**
 * Hook that listens for external input devices (keyboard keys, gamepad buttons/axes)
 * and fires a callback when a configured input is activated.
 *
 * - Keyboard: listens for `keydown` events, matches `event.code`
 * - Gamepad buttons: polls via requestAnimationFrame with edge detection
 * - Gamepad axes: polls with threshold crossing detection (±0.5)
 */
export function useExternalInput({
  inputs,
  onInput,
  enabled,
  tracking = true,
  debounceMs = 50,
  boundaryKey,
}: UseExternalInputOptions) {
  const lastTriggerRef = useRef<Record<string, number>>({});
  const prevGamepadStateRef = useRef<Record<string, boolean>>({});
  const rafRef = useRef<number | null>(null);
  const onInputRef = useRef(onInput);
  const enabledRef = useRef(enabled && tracking);
  const boundaryKeyRef = useRef(boundaryKey);
  const heldKeysRef = useRef(new Set<string>());
  const blockedKeysRef = useRef(new Set<string>());

  useLayoutEffect(() => {
    onInputRef.current = onInput;
    enabledRef.current = enabled && tracking;
    boundaryKeyRef.current = boundaryKey;
  }, [onInput, enabled, tracking, boundaryKey]);

  // Build lookup maps from inputs
  const keyboardMapRef = useRef<Map<string, InputConfig>>(new Map());
  const gamepadInputsRef = useRef<InputConfig[]>([]);

  useLayoutEffect(() => {
    const keyMap = new Map<string, InputConfig>();
    const gpInputs: InputConfig[] = [];

    for (const input of inputs) {
      if (input.type === 'keyboard') {
        keyMap.set(input.inputCode!, input);
      } else if (input.type !== 'screen') {
        gpInputs.push(input);
      }
    }

    keyboardMapRef.current = keyMap;
    gamepadInputsRef.current = gpInputs;
    const gamepads = navigator.getGamepads?.() ?? [];
    prevGamepadStateRef.current = {};
    for (const input of gpInputs) {
      if (input.inputCode) prevGamepadStateRef.current[input.inputCode] = isGamepadPressed(input, gamepads);
    }
    lastTriggerRef.current = {};
    if (boundaryKey !== undefined) blockedKeysRef.current = new Set(heldKeysRef.current);
  }, [inputs, boundaryKey]);

  useLayoutEffect(() => {
    if (!enabled) {
      lastTriggerRef.current = {};
      if (boundaryKey !== undefined) {
        for (const key of heldKeysRef.current) blockedKeysRef.current.add(key);
      }
    }
  }, [enabled, boundaryKey]);

  const canTrigger = useCallback(
    (inputId: string): boolean => {
      const now = Date.now();
      const last = lastTriggerRef.current[inputId] ?? 0;
      if (now - last < debounceMs) return false;
      lastTriggerRef.current[inputId] = now;
      return true;
    },
    [debounceMs]
  );

  // Keyboard listener
  useEffect(() => {
    if (!tracking) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const wasHeld = heldKeysRef.current.has(event.code);
      heldKeysRef.current.add(event.code);
      const input = keyboardMapRef.current.get(event.code);
      const activatesButton = event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space';
      if (input) event.preventDefault();
      if (!enabledRef.current) {
        if (boundaryKeyRef.current !== undefined) {
          blockedKeysRef.current.add(event.code);
          if (activatesButton) event.preventDefault();
        }
        return;
      }
      if (boundaryKeyRef.current !== undefined &&
        (blockedKeysRef.current.has(event.code) || (event.repeat && !wasHeld))) {
        blockedKeysRef.current.add(event.code);
        if (activatesButton) event.preventDefault();
        return;
      }
      if (input && canTrigger(input.id)) onInputRef.current(input.id, 'keyboard');
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      heldKeysRef.current.delete(event.code);
      blockedKeysRef.current.delete(event.code);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [canTrigger, tracking]);

  // Gamepad polling loop
  useEffect(() => {
    if (!tracking || gamepadInputsRef.current.length === 0) return;

    const poll = () => {
      const gamepads = navigator.getGamepads?.() ?? [];

      for (const input of gamepadInputsRef.current) {
        const { id, inputCode, type } = input;
        if (!inputCode) continue;
        const isPressed = isGamepadPressed(input, gamepads);
        const wasPressedBefore = prevGamepadStateRef.current[inputCode] ?? false;
        if (enabledRef.current && isPressed && !wasPressedBefore && canTrigger(id)) {
          onInputRef.current(id, type);
        }
        prevGamepadStateRef.current[inputCode] = isPressed;
      }

      rafRef.current = requestAnimationFrame(poll);
    };

    rafRef.current = requestAnimationFrame(poll);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [inputs, canTrigger, tracking]);
}
