import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { useInputCapture, type CapturedInput } from '../lib/useInputCapture';
import type { BaseConfig, InputConfig, ButtonShape } from '../types';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configName, setConfigName] = useState('');

  const [formData, setFormData] = useState<BaseConfig>({
    timeLimit: 60,
    moneyLimit: 1000000, // $10,000 default
    startingMoney: 0,
    continueAfterMoneyLimit: true,
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
      const configId = `config-${Date.now()}`;
      await api.createConfiguration({ configId, name: configName, config: formData });
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create configuration');
    } finally {
      setLoading(false);
    }
  };

  const screenInputs = formData.inputs.filter(i => i.type === 'screen');
  const physicalInputs = formData.inputs.filter(i => i.type !== 'screen');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Create Configuration</h1>
        <p className="text-muted-foreground mt-2">Create a reusable configuration template</p>
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
                  id="continueAfterMoneyLimit"
                  checked={formData.continueAfterMoneyLimit}
                  onChange={(e) => setFormData({ ...formData, continueAfterMoneyLimit: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="continueAfterMoneyLimit" className="cursor-pointer">
                  Continue session after money limit reached
                </Label>
              </div>
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
              {loading ? 'Creating...' : 'Create Configuration'}
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={() => navigate('/')}>
              Cancel
            </Button>
          </div>
        </div>
      </form>
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

        {/* Type badge */}
        <span className="text-xs bg-muted px-2 py-0.5 rounded shrink-0">{typeBadge}</span>

        {/* Rewarded indicator */}
        {input.isRewarded && (
          <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium shrink-0">
            Rewarded
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

          {/* Physical-specific: binding + re-bind */}
          {!isScreen && (
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
