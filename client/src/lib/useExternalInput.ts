import { useEffect, useRef, useCallback } from 'react';
import type { InputConfig } from '../types';

interface UseExternalInputOptions {
  inputs: InputConfig[];  // physical inputs only (non-screen)
  onInput: (inputId: string, inputType: string) => void;
  enabled: boolean;
  debounceMs?: number;
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
  debounceMs = 50,
}: UseExternalInputOptions) {
  const lastTriggerRef = useRef<Record<string, number>>({});
  const prevGamepadStateRef = useRef<Record<string, boolean>>({});
  const rafRef = useRef<number | null>(null);
  const onInputRef = useRef(onInput);
  useEffect(() => { onInputRef.current = onInput; }, [onInput]);

  // Build lookup maps from inputs
  const keyboardMapRef = useRef<Map<string, InputConfig>>(new Map());
  const gamepadInputsRef = useRef<InputConfig[]>([]);

  useEffect(() => {
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
  }, [inputs]);

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
    if (!enabled || keyboardMapRef.current.size === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const input = keyboardMapRef.current.get(e.code);
      if (!input) return;

      e.preventDefault();
      if (canTrigger(input.id)) {
        onInputRef.current(input.id, 'keyboard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, inputs, canTrigger]);

  // Gamepad polling loop
  useEffect(() => {
    if (!enabled || gamepadInputsRef.current.length === 0) return;

    const poll = () => {
      const gamepads = navigator.getGamepads?.() ?? [];

      for (const input of gamepadInputsRef.current) {
        const { id, inputCode, type } = input;
        if (!inputCode) continue;

        // Parse gamepad input code: "gp-{gpIndex}-btn-{btnIndex}" or "gp-{gpIndex}-axis-{axisIndex}-{dir}"
        const parts = inputCode.split('-');
        const gpIndex = parseInt(parts[1], 10);
        const gp = gamepads[gpIndex];
        if (!gp) continue;

        let isPressed = false;
        const stateKey = inputCode;

        if (type === 'gamepad_button') {
          const btnIndex = parseInt(parts[3], 10);
          const button = gp.buttons[btnIndex];
          isPressed = button?.pressed ?? false;
        } else if (type === 'gamepad_axis') {
          const axisIndex = parseInt(parts[3], 10);
          const dir = parts[4]; // 'pos' or 'neg'
          const axisValue = gp.axes[axisIndex] ?? 0;
          const threshold = 0.5;
          isPressed =
            dir === 'pos' ? axisValue > threshold : axisValue < -threshold;
        }

        const wasPressedBefore = prevGamepadStateRef.current[stateKey] ?? false;

        // Edge detection: trigger only on press, not hold
        if (isPressed && !wasPressedBefore) {
          if (canTrigger(id)) {
            onInputRef.current(id, type);
          }
        }

        prevGamepadStateRef.current[stateKey] = isPressed;
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
  }, [enabled, inputs, canTrigger]);

  // Reset state when inputs change or disabled
  useEffect(() => {
    if (!enabled) {
      lastTriggerRef.current = {};
      prevGamepadStateRef.current = {};
    }
  }, [enabled]);
}
