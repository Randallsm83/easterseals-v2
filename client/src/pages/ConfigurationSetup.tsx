import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { useInputCapture, type CapturedInput } from '../lib/useInputCapture';
import type { BaseConfig, InputConfig, ButtonShape, RawStoredConfig, PauseTrigger, PauseResumeMode, PauseResumeBinding } from '../types';
import { normalizeConfig } from '../lib/normalizeConfig';

// Dollar input helper — displays dollars, stores cents
function DollarInput({
  value,
  onChange,
  id,
  required,
}: {
  value: number; // cents
  onChange: (cents: number) => void;
  id?: string;
  required?: boolean;
}) {
  const [display, setDisplay] = useState((value / 100).toFixed(2));

  const handleBlur = () => {
    const parsed = parseFloat(display);
    if (!isNaN(parsed)) {
      const cents = Math.round(parsed * 100);
      onChange(cents);
      setDisplay((cents / 100).toFixed(2));
    } else {
      setDisplay((value / 100).toFixed(2));
    }
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={(e) => setDisplay(e.target.value)}
        onBlur={handleBlur}
        className="pl-7"
        required={required}
      />
    </div>
  );
}

// Shape preview swatch
function ShapePreview({ shape, color, size = 32 }: { shape: ButtonShape; color: string; size?: number }) {
  if (shape === 'none') return null;
  const style: React.CSSProperties = {
    backgroundColor: color,
    width: size,
    height: shape === 'rectangle' ? size * 0.6 : size,
    borderRadius: shape === 'circle' ? '50%' : '4px',
  };
  return <div style={style} className="flex-shrink-0" />;
}

export function ConfigurationSetup() {
  const navigate = useNavigate();
  const { configId } = useParams<{ configId?: string }>();
  const isEditMode = !!configId;
  const [loading, setLoading] = useState(false);
  const [formReady, setFormReady] = useState(!isEditMode);
  const [error, setError] = useState<string | null>(null);
  const [configName, setConfigName] = useState('');

  const [formData, setFormData] = useState<BaseConfig>({
    timeLimit: 60,
    moneyLimit: 1000000, // $10,000 default
    startingMoney: 0,
    continueAfterMoneyLimit: true,
    showMoneyToParticipant: true,
    pauseEnabled: false,
    pauseTrigger: 'rewarded',
    pauseAfterResponses: 5,
    pauseDurationSeconds: 15,
    pauseResumeMode: 'auto',
    pauseResumeBinding: { type: 'any' },
    inputs: [
      {
        id: `screen-${Date.now()}-1`,
        name: 'Left',
        type: 'screen',
        shape: 'circle',
        color: '#5ccc96',
        isRewarded: true,
        moneyAwarded: 5,
        awardInterval: 10,
        playAwardSound: true,
      },
      {
        id: `screen-${Date.now()}-2`,
        name: 'Middle',
        type: 'screen',
        shape: 'square',
        color: '#e39400',
        isRewarded: false,
        moneyAwarded: 5,
        awardInterval: 10,
        playAwardSound: true,
      },
      {
        id: `screen-${Date.now()}-3`,
        name: 'Right',
        type: 'screen',
        shape: 'circle',
        color: '#00a3cc',
        isRewarded: false,
        moneyAwarded: 5,
        awardInterval: 10,
        playAwardSound: true,
      },
    ],
  });

  useEffect(() => {
    if (!isEditMode || !configId) return;
    api.getConfiguration(configId)
      .then((cfg) => {
        const parsedConfig = typeof cfg.config === 'string' ? JSON.parse(cfg.config) : cfg.config;
        const normalized = normalizeConfig(parsedConfig as RawStoredConfig);
        setConfigName(cfg.name);
        setFormData(normalized);
        setFormReady(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load configuration');
        setFormReady(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Input capture state (for adding physical inputs)
  const [captureMode, setCaptureMode] = useState<'idle' | 'capturing' | 'rebinding'>('idle');
  const [rebindInputId, setRebindInputId] = useState<string | null>(null);
  const [expandedInputId, setExpandedInputId] = useState<string | null>(null);

  const handleInputCapture = useCallback((captured: CapturedInput) => {
    if (captureMode === 'rebinding' && rebindInputId) {
      setFormData(prev => ({
        ...prev,
        inputs: prev.inputs.map(input =>
          input.id === rebindInputId
            ? { ...input, type: captured.inputType, inputCode: captured.inputCode, inputLabel: captured.inputLabel }
            : input
        ),
      }));
      setCaptureMode('idle');
      setRebindInputId(null);
    } else {
      const newInput: InputConfig = {
        id: `input-${Date.now()}`,
        name: '',
        type: captured.inputType,
        inputCode: captured.inputCode,
        inputLabel: captured.inputLabel,
        showHighlight: true,
        isRewarded: false,
        moneyAwarded: 5,
        awardInterval: 10,
        playAwardSound: true,
      };
      setFormData(prev => ({
        ...prev,
        inputs: [...prev.inputs, newInput],
      }));
      setExpandedInputId(newInput.id);
      setCaptureMode('idle');
    }
  }, [captureMode, rebindInputId]);

  const { connectedGamepads } = useInputCapture({
    active: captureMode !== 'idle',
    onCapture: handleInputCapture,
  });

  const updateInput = (inputId: string, updates: Partial<InputConfig>) => {
    setFormData(prev => ({
      ...prev,
      inputs: prev.inputs.map(input =>
        input.id === inputId ? { ...input, ...updates } : input
      ),
    }));
  };

  const removeInput = (inputId: string) => {
    setFormData(prev => ({
      ...prev,
      inputs: prev.inputs.filter(input => input.id !== inputId),
    }));
    if (expandedInputId === inputId) setExpandedInputId(null);
  };

  const addScreenButton = () => {
    const newInput: InputConfig = {
      id: `screen-${Date.now()}`,
      name: '',
      type: 'screen',
      shape: 'circle',
      color: '#5ccc96',
      isRewarded: false,
      moneyAwarded: 5,
      awardInterval: 10,
      playAwardSound: true,
    };
    setFormData(prev => ({
      ...prev,
      inputs: [...prev.inputs, newInput],
    }));
    setExpandedInputId(newInput.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isEditMode && configId) {
        await api.updateConfiguration(configId, { name: configName, config: formData });
      } else {
        const newConfigId = `config-${Date.now()}`;
        await api.createConfiguration({ configId: newConfigId, name: configName, config: formData });
      }
      navigate('/configurations');
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEditMode ? 'Failed to update configuration' : 'Failed to create configuration'));
    } finally {
      setLoading(false);
    }
  };

  const screenInputs = formData.inputs.filter(i => i.type === 'screen');
  const physicalInputs = formData.inputs.filter(i => i.type !== 'screen');

  if (!formReady) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted-foreground">Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">{isEditMode ? 'Edit Configuration' : 'Create Configuration'}</h1>
        <p className="text-muted-foreground mt-2">{isEditMode ? 'Update this configuration template' : 'Create a reusable configuration template'}</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Section 1: Session Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Session Settings</CardTitle>
              <CardDescription>Time, money, and session behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="configName">Configuration Name *</Label>
                <Input
                  id="configName"
                  value={configName}
                  onChange={(e) => setConfigName(e.target.value)}
                  placeholder="e.g., Standard Session, Quick Test"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeLimit">Time Limit (seconds) *</Label>
                <Input
                  id="timeLimit"
                  type="number"
                  min="1"
                  value={formData.timeLimit}
                  onChange={(e) => setFormData({ ...formData, timeLimit: parseInt(e.target.value) || 60 })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startingMoney">Starting Money</Label>
                  <DollarInput
                    id="startingMoney"
                    value={formData.startingMoney}
                    onChange={(cents) => setFormData({ ...formData, startingMoney: cents })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="moneyLimit">Money Limit</Label>
                  <DollarInput
                    id="moneyLimit"
                    value={formData.moneyLimit}
                    onChange={(cents) => setFormData({ ...formData, moneyLimit: cents })}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="endOnMoneyLimit"
                  checked={!formData.continueAfterMoneyLimit}
                  onChange={(e) => setFormData({ ...formData, continueAfterMoneyLimit: !e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="endOnMoneyLimit" className="cursor-pointer">
                  End session when money limit is reached
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                When enabled, the session ends automatically as soon as the participant
                reaches the money limit above.
              </p>
            </CardContent>
          </Card>

          {/* Section 1b: Participant Display & Pauses */}
          <Card>
            <CardHeader>
              <CardTitle>Participant Display &amp; Pauses</CardTitle>
              <CardDescription>Control what the participant sees and add periodic breaks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Show money to participant */}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="showMoneyToParticipant"
                  checked={formData.showMoneyToParticipant !== false}
                  onChange={(e) => setFormData({ ...formData, showMoneyToParticipant: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="showMoneyToParticipant" className="cursor-pointer">
                  Show money earned to participant
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                When disabled, the money counter is hidden from the participant
                (still visible to the researcher in the live monitor).
              </p>

              {/* Pause toggle */}
              <div className="pt-3 border-t flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="pauseEnabled"
                  checked={!!formData.pauseEnabled}
                  onChange={(e) => setFormData({ ...formData, pauseEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="pauseEnabled" className="cursor-pointer font-medium">
                  Pause session periodically
                </Label>
              </div>

              {formData.pauseEnabled && (
                <div className="pl-6 space-y-4 border-l-2 border-primary/30">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="pauseAfterResponses">Pause after every N responses</Label>
                      <Input
                        id="pauseAfterResponses"
                        type="number"
                        min="1"
                        value={formData.pauseAfterResponses ?? 5}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            pauseAfterResponses: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pauseDurationSeconds">Pause duration (seconds)</Label>
                      <Input
                        id="pauseDurationSeconds"
                        type="number"
                        min="1"
                        value={formData.pauseDurationSeconds ?? 15}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            pauseDurationSeconds: Math.max(1, parseInt(e.target.value) || 1),
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Trigger radio */}
                  <div className="space-y-2">
                    <Label className="text-sm">Count which responses?</Label>
                    <div className="space-y-1">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="pauseTrigger"
                          value="rewarded"
                          checked={(formData.pauseTrigger ?? 'rewarded') === 'rewarded'}
                          onChange={() => setFormData({ ...formData, pauseTrigger: 'rewarded' as PauseTrigger })}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">Only rewarded responses</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="pauseTrigger"
                          value="any"
                          checked={formData.pauseTrigger === 'any'}
                          onChange={() => setFormData({ ...formData, pauseTrigger: 'any' as PauseTrigger })}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">Any response</span>
                      </label>
                    </div>
                  </div>

                  {/* Resume mode radio */}
                  <div className="space-y-2">
                    <Label className="text-sm">When the pause ends</Label>
                    <div className="space-y-1">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="pauseResumeMode"
                          value="auto"
                          checked={(formData.pauseResumeMode ?? 'auto') === 'auto'}
                          onChange={() => setFormData({ ...formData, pauseResumeMode: 'auto' as PauseResumeMode })}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">Auto-resume after duration</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name="pauseResumeMode"
                          value="manual"
                          checked={formData.pauseResumeMode === 'manual'}
                          onChange={() => setFormData({ ...formData, pauseResumeMode: 'manual' as PauseResumeMode })}
                          className="h-4 w-4"
                        />
                        <span className="text-sm">Manual resume (researcher presses a button/key)</span>
                      </label>
                    </div>
                  </div>

                  {/* Resume binding (manual only) */}
                  {formData.pauseResumeMode === 'manual' && (
                    <PauseResumeBindingEditor
                      binding={formData.pauseResumeBinding ?? { type: 'any' }}
                      onChange={(binding) => setFormData({ ...formData, pauseResumeBinding: binding })}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 2: Inputs */}
          <Card>
            <CardHeader>
              <CardTitle>Inputs</CardTitle>
              <CardDescription>
                Screen buttons and physical inputs. Each can independently award money.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {connectedGamepads.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Connected gamepads: {connectedGamepads.join(', ')}
                </div>
              )}

              {/* Capture overlay */}
              {captureMode !== 'idle' && (
                <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
                  <div className="bg-card border rounded-lg p-8 text-center space-y-4 max-w-md">
                    <div className="text-4xl">🎮</div>
                    <h3 className="text-lg font-semibold">
                      {captureMode === 'rebinding' ? 'Re-bind Input' : 'Capture New Input'}
                    </h3>
                    <p className="text-muted-foreground">
                      Press a key, push a button, or move a joystick...
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCaptureMode('idle');
                        setRebindInputId(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Screen Buttons */}
              {screenInputs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Screen Buttons
                  </h3>
                  <div className="space-y-3">
                    {screenInputs.map((input) => (
                      <InputCard
                        key={input.id}
                        input={input}
                        isExpanded={expandedInputId === input.id}
                        onToggleExpand={() => setExpandedInputId(expandedInputId === input.id ? null : input.id)}
                        onUpdate={(updates) => updateInput(input.id, updates)}
                        onRemove={() => removeInput(input.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Physical Inputs */}
              {physicalInputs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Physical Inputs
                  </h3>
                  <div className="space-y-3">
                    {physicalInputs.map((input) => (
                      <InputCard
                        key={input.id}
                        input={input}
                        isExpanded={expandedInputId === input.id}
                        onToggleExpand={() => setExpandedInputId(expandedInputId === input.id ? null : input.id)}
                        onUpdate={(updates) => updateInput(input.id, updates)}
                        onRemove={() => removeInput(input.id)}
                        onRebind={() => {
                          setRebindInputId(input.id);
                          setCaptureMode('rebinding');
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Add buttons */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={addScreenButton}
                  className="flex-1"
                >
                  + Add Screen Button
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCaptureMode('capturing')}
                  className="flex-1"
                >
                  + Add Physical Input
                </Button>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <Button type="submit" size="lg" disabled={loading} className="flex-1">
              {loading ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save Changes' : 'Create Configuration')}
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={() => navigate('/configurations')}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// --- Pause resume binding editor ---

function PauseResumeBindingEditor({
  binding,
  onChange,
}: {
  binding: PauseResumeBinding;
  onChange: (binding: PauseResumeBinding) => void;
}) {
  const [capturing, setCapturing] = useState(false);

  const handleCapture = useCallback(
    (captured: CapturedInput) => {
      onChange({
        type: captured.inputType,
        inputCode: captured.inputCode,
        inputLabel: captured.inputLabel,
      });
      setCapturing(false);
    },
    [onChange]
  );

  useInputCapture({ active: capturing, onCapture: handleCapture });

  return (
    <div className="space-y-2">
      <Label className="text-sm">Resume input</Label>
      <div className="space-y-1">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="radio"
            name="pauseResumeBindingType"
            checked={binding.type === 'any'}
            onChange={() => onChange({ type: 'any' })}
            className="h-4 w-4"
          />
          <span className="text-sm">Any input resumes (any key or gamepad press)</span>
        </label>
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="radio"
            name="pauseResumeBindingType"
            checked={binding.type !== 'any'}
            onChange={() => {
              // If switching to specific without one yet, prompt capture
              if (binding.type === 'any') setCapturing(true);
            }}
            className="h-4 w-4"
          />
          <span className="text-sm">A specific input resumes</span>
        </label>
      </div>

      {binding.type !== 'any' && (
        <div className="pl-6 flex items-center gap-2">
          <span className="text-sm font-mono bg-muted px-2 py-1 rounded">
            {binding.inputLabel ?? 'Unset'}
          </span>
          <span className="text-xs text-muted-foreground">({binding.type})</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCapturing(true)}
            className="h-7 text-xs"
          >
            {binding.inputCode ? 'Re-bind' : 'Bind'}
          </Button>
        </div>
      )}

      {capturing && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-card border rounded-lg p-8 text-center space-y-4 max-w-md">
            <div className="text-4xl">⏸️</div>
            <h3 className="text-lg font-semibold">Bind Resume Input</h3>
            <p className="text-muted-foreground">
              Press a key, push a button, or move a joystick to bind it as the resume input...
            </p>
            <Button type="button" variant="outline" onClick={() => setCapturing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Color swatch picker ---

const SWATCH_PALETTE = [
  '#5ccc96', '#e39400', '#00a3cc', '#b3a1e6',
  '#ce6f8f', '#42b3c2', '#f2ce00', '#c678dd',
  '#98c379', '#61afef', '#e06c75', '#56b6c2',
  '#404040', '#e0e0e0', '#ffffff', '#000000',
];

function ColorSwatchPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCH_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          onClick={() => onChange(color)}
          className={`w-6 h-6 rounded border-2 transition-transform hover:scale-110 ${
            value === color ? 'border-primary scale-110' : 'border-transparent hover:border-muted-foreground'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

// --- InputCard component ---

interface InputCardProps {
  input: InputConfig;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (updates: Partial<InputConfig>) => void;
  onRemove: () => void;
  onRebind?: () => void;
}

function InputCard({ input, isExpanded, onToggleExpand, onUpdate, onRemove, onRebind }: InputCardProps) {
  const isScreen = input.type === 'screen';

  const typeBadge = isScreen ? 'Screen' : input.type === 'keyboard' ? 'Keyboard' : 'Gamepad';

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 transition-all ${
        input.isRewarded ? 'ring-1 ring-primary bg-primary/5' : 'border-border'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-3">
        {/* Preview swatch for screen buttons */}
        {isScreen && input.shape && input.shape !== 'none' && (
          <ShapePreview shape={input.shape} color={input.color ?? '#5ccc96'} size={28} />
        )}

        {/* Physical input binding badge */}
        {!isScreen && input.inputLabel && (
          <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded shrink-0">
            {input.inputLabel}
          </span>
        )}

        {/* Name */}
        <span className="font-medium truncate flex-1">
          {input.name || <span className="text-muted-foreground italic">Unnamed</span>}
        </span>

        {/* Rewarded indicator */}
        {input.isRewarded && (
          <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium shrink-0">
            Rewarded
          </span>
        )}

        {/* Type badge */}
        <span className="text-xs bg-muted px-2 py-0.5 rounded shrink-0">{typeBadge}</span>

        {/* No-highlight badge */}
        {!isScreen && input.showHighlight === false && (
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded shrink-0">
            No highlight
          </span>
        )}

        {/* Actions */}
        <Button type="button" variant="ghost" size="sm" onClick={onToggleExpand} className="h-7 text-xs shrink-0">
          {isExpanded ? 'Collapse' : 'Edit'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-7 text-xs text-destructive hover:text-destructive shrink-0"
        >
          Remove
        </Button>
      </div>

      {/* Summary when collapsed */}
      {!isExpanded && input.isRewarded && (
        <p className="text-xs text-muted-foreground">
          Awards ${(input.moneyAwarded / 100).toFixed(2)} every {input.awardInterval} activation{input.awardInterval !== 1 ? 's' : ''}
        </p>
      )}

      {/* Expanded editing */}
      {isExpanded && (
        <div className="space-y-4 pt-2 border-t">
          {/* Name field */}
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              type="text"
              value={input.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder={isScreen ? 'e.g., Left, Center, Right' : 'e.g., Red Arcade Button'}
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          {/* Screen-specific: shape + color */}
          {isScreen && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Shape</Label>
                <select
                  value={input.shape ?? 'circle'}
                  onChange={(e) => onUpdate({ shape: e.target.value as ButtonShape })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="none">None (hidden)</option>
                  <option value="circle">Circle</option>
                  <option value="square">Square</option>
                  <option value="rectangle">Rectangle</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={input.color ?? '#5ccc96'}
                    onChange={(e) => onUpdate({ color: e.target.value })}
                    className="w-12 h-9 cursor-pointer p-1"
                  />
                  <Input
                    type="text"
                    value={input.color ?? '#5ccc96'}
                    onChange={(e) => onUpdate({ color: e.target.value })}
                    className="flex-1 h-9 text-xs"
                    pattern="^#[0-9A-Fa-f]{6}$"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Physical-specific: binding + re-bind + highlight toggle */}
          {!isScreen && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="space-y-1 flex-1">
                  <Label className="text-xs">Binding</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono bg-muted px-3 py-1.5 rounded">
                      {input.inputLabel ?? 'Unknown'}
                    </span>
                    <span className="text-xs text-muted-foreground">({input.type})</span>
                  </div>
                </div>
                {onRebind && (
                  <Button type="button" variant="outline" size="sm" onClick={onRebind} className="h-8 text-xs">
                    Re-bind
                  </Button>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Color (for charts)</Label>
                <ColorSwatchPicker
                  value={input.color ?? '#b3a1e6'}
                  onChange={(color) => onUpdate({ color })}
                />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id={`${input.id}-highlight`}
                  checked={input.showHighlight !== false}
                  onChange={(e) => onUpdate({ showHighlight: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor={`${input.id}-highlight`} className="cursor-pointer text-sm">
                  Show screen highlight when activated
                </Label>
              </div>
            </div>
          )}

          {/* Reward settings */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={`${input.id}-rewarded`}
                checked={input.isRewarded}
                onChange={(e) => onUpdate({ isRewarded: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <Label htmlFor={`${input.id}-rewarded`} className="cursor-pointer text-sm">
                Awards money
              </Label>
            </div>

            {input.isRewarded && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Money Awarded</Label>
                    <DollarInput
                      value={input.moneyAwarded}
                      onChange={(cents) => onUpdate({ moneyAwarded: cents })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Award Interval (activations)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={input.awardInterval}
                      onChange={(e) => onUpdate({ awardInterval: parseInt(e.target.value) || 1 })}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id={`${input.id}-sound`}
                    checked={input.playAwardSound}
                    onChange={(e) => onUpdate({ playAwardSound: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  <Label htmlFor={`${input.id}-sound`} className="cursor-pointer text-sm">
                    Play sound on reward
                  </Label>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
