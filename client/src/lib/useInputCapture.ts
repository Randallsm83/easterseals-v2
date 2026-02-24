import { useEffect, useRef, useState } from 'react';
import type { ExternalInputType } from '../types';

export interface CapturedInput {
  inputType: ExternalInputType;
  inputCode: string;
  inputLabel: string;
}

interface UseInputCaptureOptions {
  active: boolean;
  onCapture: (captured: CapturedInput) => void;
}

/**
 * Hook for capturing physical input in the configuration UI.
 * When active, listens for keyboard presses, gamepad button presses,
 * and gamepad axis movements, then calls onCapture with the detected input.
 */
export function useInputCapture({ active, onCapture }: UseInputCaptureOptions) {
  const [connectedGamepads, setConnectedGamepads] = useState<string[]>([]);
  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);
  const prevGamepadStateRef = useRef<Record<string, boolean>>({});
  const rafRef = useRef<number | null>(null);

  // Track connected gamepads
  useEffect(() => {
    const updateGamepads = () => {
      const gps = navigator.getGamepads?.() ?? [];
      const names: string[] = [];
      for (const gp of gps) {
        if (gp) names.push(gp.id);
      }
      setConnectedGamepads(names);
    };

    const onConnect = () => updateGamepads();
    const onDisconnect = () => updateGamepads();

    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    updateGamepads();

    return () => {
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
    };
  }, []);

  // Keyboard capture — delay briefly so the click that opened the modal doesn't register
  useEffect(() => {
    if (!active) return;

    let listening = false;
    const timerId = setTimeout(() => { listening = true; }, 200);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!listening) return;
      e.preventDefault();
      e.stopPropagation();

      // Generate a human-readable label
      const label = getKeyLabel(e);

      onCaptureRef.current({
        inputType: 'keyboard',
        inputCode: e.code,
        inputLabel: label,
      });
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      clearTimeout(timerId);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [active]);

  // Gamepad capture (polling)
  useEffect(() => {
    if (!active) return;

    // Snapshot current gamepad state as baseline so resting positions don't trigger
    const baseline: Record<string, boolean> = {};
    const gamepadsNow = navigator.getGamepads?.() ?? [];
    for (let gpIndex = 0; gpIndex < gamepadsNow.length; gpIndex++) {
      const gp = gamepadsNow[gpIndex];
      if (!gp) continue;
      for (let btnIndex = 0; btnIndex < gp.buttons.length; btnIndex++) {
        baseline[`gp-${gpIndex}-btn-${btnIndex}`] = gp.buttons[btnIndex].pressed;
      }
      for (let axisIndex = 0; axisIndex < gp.axes.length; axisIndex++) {
        const val = gp.axes[axisIndex];
        baseline[`gp-${gpIndex}-axis-${axisIndex}-pos`] = val > 0.5;
        baseline[`gp-${gpIndex}-axis-${axisIndex}-neg`] = val < -0.5;
      }
    }
    prevGamepadStateRef.current = baseline;

    const poll = () => {
      const gamepads = navigator.getGamepads?.() ?? [];

      for (let gpIndex = 0; gpIndex < gamepads.length; gpIndex++) {
        const gp = gamepads[gpIndex];
        if (!gp) continue;

        // Check buttons
        for (let btnIndex = 0; btnIndex < gp.buttons.length; btnIndex++) {
          const button = gp.buttons[btnIndex];
          const stateKey = `gp-${gpIndex}-btn-${btnIndex}`;
          const isPressed = button.pressed;
          const wasPressedBefore = prevGamepadStateRef.current[stateKey] ?? false;

          if (isPressed && !wasPressedBefore) {
            onCaptureRef.current({
              inputType: 'gamepad_button',
              inputCode: `gp-${gpIndex}-btn-${btnIndex}`,
              inputLabel: `${gp.id.substring(0, 30)} — Button ${btnIndex + 1}`,
            });
          }

          prevGamepadStateRef.current[stateKey] = isPressed;
        }

        // Check axes
        for (let axisIndex = 0; axisIndex < gp.axes.length; axisIndex++) {
          const axisValue = gp.axes[axisIndex];
          const threshold = 0.5;

          for (const dir of ['pos', 'neg'] as const) {
            const stateKey = `gp-${gpIndex}-axis-${axisIndex}-${dir}`;
            const isActive =
              dir === 'pos' ? axisValue > threshold : axisValue < -threshold;
            const wasPressedBefore = prevGamepadStateRef.current[stateKey] ?? false;

            if (isActive && !wasPressedBefore) {
              const dirLabel = getAxisLabel(axisIndex, dir);
              onCaptureRef.current({
                inputType: 'gamepad_axis',
                inputCode: `gp-${gpIndex}-axis-${axisIndex}-${dir}`,
                inputLabel: `${gp.id.substring(0, 30)} — ${dirLabel}`,
              });
            }

            prevGamepadStateRef.current[stateKey] = isActive;
          }
        }
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
  }, [active]);

  return { connectedGamepads };
}

/** Generate a readable label for a keyboard key */
function getKeyLabel(e: KeyboardEvent): string {
  // Use e.key for readable labels, but filter out modifier-only presses
  if (e.code.startsWith('Key')) return e.code.replace('Key', '');
  if (e.code.startsWith('Digit')) return e.code.replace('Digit', '');
  if (e.code.startsWith('Numpad')) return `Numpad ${e.code.replace('Numpad', '')}`;
  if (e.code.startsWith('Arrow')) return e.code.replace('Arrow', '↑↓←→'.charAt(0));

  // Common special keys
  const labels: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Escape: 'Esc',
    Backspace: 'Backspace',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };

  return labels[e.code] ?? e.key ?? e.code;
}

/** Generate a readable label for a gamepad axis direction */
function getAxisLabel(axisIndex: number, dir: 'pos' | 'neg'): string {
  const axisNames: Record<number, [string, string]> = {
    0: ['Left Stick ←', 'Left Stick →'],
    1: ['Left Stick ↑', 'Left Stick ↓'],
    2: ['Right Stick ←', 'Right Stick →'],
    3: ['Right Stick ↑', 'Right Stick ↓'],
  };

  const names = axisNames[axisIndex];
  if (names) return dir === 'neg' ? names[0] : names[1];
  return `Axis ${axisIndex} ${dir === 'pos' ? '+' : '-'}`;
}
