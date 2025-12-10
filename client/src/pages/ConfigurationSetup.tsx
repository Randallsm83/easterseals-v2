import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import type { BaseConfig, ButtonPosition } from '../types';

export function ConfigurationSetup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configName, setConfigName] = useState('');
  
  const [formData, setFormData] = useState<BaseConfig>({
    sessionLength: 60,
    sessionLengthType: 'seconds',
    continueAfterLimit: false,
    buttonActive: 'left',
    leftButton: { shape: 'circle', color: '#5ccc96' },
    middleButton: { shape: 'square', color: '#e39400' },
    rightButton: { shape: 'circle', color: '#00a3cc' },
    pointsAwarded: 1,
    clicksNeeded: 1,
    startingPoints: 0,
  });

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

  const updateButton = (position: 'left' | 'middle' | 'right', field: 'shape' | 'color', value: string) => {
    setFormData(prev => ({
      ...prev,
      [`${position}Button`]: {
        ...prev[`${position}Button`],
        [field]: value,
      },
    }));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Create Configuration</h1>
        <p className="text-muted-foreground mt-2">Create a reusable configuration template</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {/* Configuration Details */}
          <Card>
            <CardHeader>
              <CardTitle>Configuration Details</CardTitle>
              <CardDescription>Basic configuration settings</CardDescription>
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

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sessionLength">Session Length *</Label>
                  <Input
                    id="sessionLength"
                    type="number"
                    min="1"
                    value={formData.sessionLength}
                    onChange={(e) => setFormData({ ...formData, sessionLength: parseInt(e.target.value) })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sessionLengthType">Length Type</Label>
                  <select
                    id="sessionLengthType"
                    value={formData.sessionLengthType}
                    onChange={(e) => setFormData({ ...formData, sessionLengthType: e.target.value as 'seconds' | 'points' })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  >
                    <option value="seconds">Seconds</option>
                    <option value="points">Points</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="continueAfterLimit"
                  checked={formData.continueAfterLimit}
                  onChange={(e) => setFormData({ ...formData, continueAfterLimit: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="continueAfterLimit" className="cursor-pointer">
                  Continue session after limit reached
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Button Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Button Configuration</CardTitle>
              <CardDescription>Customize button appearance and active button</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="buttonActive">Active Button (awards points) *</Label>
                <select
                  id="buttonActive"
                  value={formData.buttonActive}
onChange={(e) => setFormData({ ...formData, buttonActive: e.target.value as ButtonPosition })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="left">Left</option>
                  <option value="middle">Middle</option>
                  <option value="right">Right</option>
                </select>
              </div>

              <div className="grid gap-6">
                {(['left', 'middle', 'right'] as const).map((position) => (
                  <div key={position} className="border border-border rounded-lg p-4 space-y-3">
                    <h4 className="font-medium capitalize">{position} Button</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Shape</Label>
                        <select
                          value={formData[`${position}Button`].shape}
                          onChange={(e) => updateButton(position, 'shape', e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="circle">Circle</option>
                          <option value="square">Square</option>
                          <option value="rectangle">Rectangle</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>Color</Label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            value={formData[`${position}Button`].color}
                            onChange={(e) => updateButton(position, 'color', e.target.value)}
                            className="w-20 h-10 cursor-pointer"
                          />
                          <Input
                            type="text"
                            value={formData[`${position}Button`].color}
                            onChange={(e) => updateButton(position, 'color', e.target.value)}
                            className="flex-1"
                            pattern="^#[0-9A-Fa-f]{6}$"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Rewards Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Rewards Configuration</CardTitle>
              <CardDescription>Point system settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pointsAwarded">Points Awarded *</Label>
                  <Input
                    id="pointsAwarded"
                    type="number"
                    min="0"
                    value={formData.pointsAwarded}
                    onChange={(e) => setFormData({ ...formData, pointsAwarded: parseInt(e.target.value) })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clicksNeeded">Clicks Needed *</Label>
                  <Input
                    id="clicksNeeded"
                    type="number"
                    min="1"
                    value={formData.clicksNeeded}
                    onChange={(e) => setFormData({ ...formData, clicksNeeded: parseInt(e.target.value) })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startingPoints">Starting Points *</Label>
                  <Input
                    id="startingPoints"
                    type="number"
                    min="0"
                    value={formData.startingPoints}
                    onChange={(e) => setFormData({ ...formData, startingPoints: parseInt(e.target.value) })}
                    required
                  />
                </div>
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
