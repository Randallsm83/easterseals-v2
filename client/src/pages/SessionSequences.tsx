import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import type { Configuration, SessionSequence } from '../types';

interface SequenceDraft {
  sequenceId: string | null;
  name: string;
  entries: { key: number; configId: string }[];
}

export function SessionSequences() {
  const navigate = useNavigate();
  const [sequences, setSequences] = useState<SessionSequence[]>([]);
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SequenceDraft | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [launchSequence, setLaunchSequence] = useState<SessionSequence | null>(null);
  const [participantId, setParticipantId] = useState('');
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [status, setStatus] = useState('');
  const nextEntryKey = useRef(0);
  const configurationSelect = useRef<HTMLSelectElement>(null);
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  const busy = saving || launching || deletingId !== null;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    try {
      const [savedSequences, savedConfigurations] = await Promise.all([
        api.getSequences(),
        api.getConfigurations({ includeArchived: true }),
      ]);
      setSequences(savedSequences);
      setConfigurations(savedConfigurations);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load session sequences and configurations.');
    } finally {
      setLoading(false);
    }
  }

  function openForm(sequence?: SessionSequence) {
    if (busy) return;
    setDraft({
      sequenceId: sequence?.sequenceId ?? null,
      name: sequence?.name ?? '',
      entries: sequence?.configIds.map(configId => ({ key: nextEntryKey.current++, configId })) ?? [],
    });
    setSelectedConfigId('');
    setFormError(null);
  }

  function configurationName(configId: string) {
    const configuration = configurations.find(config => config.configId === configId);
    if (!configuration) return `Unknown configuration (${configId})`;
    return `${configuration.name}${configuration.isArchived ? ' (Archived)' : ''}`;
  }

  function addEntry() {
    if (!draft || busy || !selectedConfigId) return;
    setDraft({
      ...draft,
      entries: [...draft.entries, { key: nextEntryKey.current++, configId: selectedConfigId }],
    });
    setFormError(null);
    setStatus(`Added ${configurationName(selectedConfigId)} at position ${draft.entries.length + 1}.`);
  }

  function moveEntry(index: number, offset: number) {
    if (!draft || busy) return;
    const destination = index + offset;
    if (destination < 0 || destination >= draft.entries.length) return;
    const entries = [...draft.entries];
    [entries[index], entries[destination]] = [entries[destination], entries[index]];
    setDraft({ ...draft, entries });
    setStatus(`Moved ${configurationName(entries[destination].configId)} to position ${destination + 1}.`);
  }

  function removeEntry(index: number) {
    if (!draft || busy) return;
    const nextEntry = draft.entries[index + 1] ?? draft.entries[index - 1];
    if (nextEntry) {
      removeButtons.current.get(nextEntry.key)?.focus();
    } else {
      configurationSelect.current?.focus();
    }
    setDraft({ ...draft, entries: draft.entries.filter((_, entryIndex) => entryIndex !== index) });
    setStatus(`Removed entry ${index + 1}.`);
  }

  async function saveSequence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const name = draft.name.trim();
    if (!name) {
      setFormError('Enter a sequence name containing more than spaces.');
      return;
    }
    if (draft.entries.length === 0) {
      setFormError('Add at least one configuration before saving the sequence.');
      configurationSelect.current?.focus();
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const data = { name, configIds: draft.entries.map(entry => entry.configId) };
      const saved = draft.sequenceId
        ? await api.updateSequence(draft.sequenceId, data)
        : await api.createSequence(data);
      setSequences(current => {
        if (!draft.sequenceId) return [saved, ...current];
        return current.map(sequence => sequence.sequenceId === saved.sequenceId ? saved : sequence);
      });
      setDraft(null);
      setStatus(`Saved ${saved.name}.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to save sequence. Your draft has been kept.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSequence(sequence: SessionSequence) {
    if (busy || !window.confirm(`Delete sequence "${sequence.name}"? Saved configurations and recorded sessions will be kept.`)) return;
    setDeletingId(sequence.sequenceId);
    setDeleteError(null);
    try {
      await api.deleteSequence(sequence.sequenceId);
      setSequences(current => current.filter(item => item.sequenceId !== sequence.sequenceId));
      setStatus(`Deleted ${sequence.name}.`);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete sequence.');
    } finally {
      setDeletingId(null);
    }
  }

  async function startSequence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!launchSequence || busy) return;
    const participant = participantId.trim();
    if (!participant) {
      setLaunchError('Enter a participant ID containing more than spaces.');
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    try {
      const run = await api.startSequenceRun(launchSequence.sequenceId, participant);
      navigate(`/sequence-runs/${run.runId}`);
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Failed to start sequence.');
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Session Sequences</h1>
          <p className="text-muted-foreground mt-1">
            Save named, ordered sets of configurations. The same configuration can appear more than once.
          </p>
        </div>
        <Button
          type="button"
          size="lg"
          disabled={loading || loadError !== null || busy || draft !== null || launchSequence !== null}
          onClick={() => openForm()}
        >
          Create Sequence
        </Button>
      </div>

      <p role="status" aria-live="polite" className="sr-only">{status}</p>

      {loadError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive space-y-3">
          <p>Could not load session sequences and configurations: {loadError}</p>
          <Button type="button" variant="outline" disabled={loading || busy} onClick={loadData}>
            Retry
          </Button>
        </div>
      )}
      {deleteError && (
        <p role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          Could not delete sequence: {deleteError}
        </p>
      )}
      {!loading && !loadError && configurations.length === 0 && (
        <p className="text-muted-foreground">
          No saved configurations yet.{' '}
          <Link to="/config/new" className="text-primary underline underline-offset-4">Create a configuration</Link>
          {' '}before adding sequence entries.
        </p>
      )}

      {launchSequence && (
        <Card>
          <CardHeader>
            <CardTitle id="sequence-launch-heading">Start {launchSequence.name}</CardTitle>
            <CardDescription>Choose one participant for every session in this sequence.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={startSequence} aria-labelledby="sequence-launch-heading" aria-busy={launching}>
              <fieldset disabled={busy} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sequence-participant">Participant ID</Label>
                  <Input
                    id="sequence-participant"
                    value={participantId}
                    onChange={event => setParticipantId(event.target.value)}
                    placeholder="e.g., 150"
                    required
                    autoFocus
                  />
                </div>
                {launchError && (
                  <p role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
                    {launchError}
                  </p>
                )}
                <div className="flex gap-3">
                  <Button type="submit">{launching ? 'Starting...' : 'Start Sequence'}</Button>
                  <Button type="button" variant="outline" onClick={() => setLaunchSequence(null)}>Cancel</Button>
                </div>
              </fieldset>
            </form>
          </CardContent>
        </Card>
      )}

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle id="sequence-form-heading">{draft.sequenceId ? 'Edit Sequence' : 'New Sequence'}</CardTitle>
            <CardDescription>Choose configurations in order, including any repeated conditions.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSequence} aria-labelledby="sequence-form-heading" aria-busy={saving}>
              <fieldset disabled={busy || loading} className="space-y-6 min-w-0">
                <div className="space-y-2">
                  <Label htmlFor="sequence-name">Sequence name</Label>
                  <Input
                    id="sequence-name"
                    name="sequenceName"
                    value={draft.name}
                    onChange={event => setDraft({ ...draft, name: event.target.value })}
                    required
                    maxLength={200}
                    autoFocus
                  />
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-2 flex-1 min-w-0">
                    <Label htmlFor="sequence-configuration">Configuration</Label>
                    <select
                      ref={configurationSelect}
                      id="sequence-configuration"
                      value={selectedConfigId}
                      onChange={event => setSelectedConfigId(event.target.value)}
                      aria-describedby="sequence-entries-help"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <option value="">Choose a configuration</option>
                      {configurations.map(configuration => (
                        <option key={configuration.configId} value={configuration.configId}>
                          {configuration.name}{configuration.isArchived ? ' (Archived)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="button" variant="outline" onClick={addEntry} disabled={!selectedConfigId}>
                    Add Configuration
                  </Button>
                </div>
                <div className="space-y-3">
                  <p id="sequence-entries-help" className="text-sm text-muted-foreground">
                    Add at least one configuration. Use Move up, Move down, or Remove to revise the order.
                  </p>
                  <ol aria-label="Sequence entries" className="list-none space-y-2">
                    {draft.entries.map((entry, index) => (
                      <li key={entry.key} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                        <span className="font-medium break-words min-w-0">{index + 1}. {configurationName(entry.configId)}</span>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Move entry ${index + 1} up`}
                            aria-disabled={index === 0}
                            className={index === 0 ? 'opacity-50' : ''}
                            onClick={() => moveEntry(index, -1)}
                          >
                            Move up
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Move entry ${index + 1} down`}
                            aria-disabled={index === draft.entries.length - 1}
                            className={index === draft.entries.length - 1 ? 'opacity-50' : ''}
                            onClick={() => moveEntry(index, 1)}
                          >
                            Move down
                          </Button>
                          <Button
                            ref={button => {
                              if (button) removeButtons.current.set(entry.key, button);
                              else removeButtons.current.delete(entry.key);
                            }}
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Remove entry ${index + 1}`}
                            onClick={() => removeEntry(index)}
                          >
                            Remove
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                {formError && (
                  <p role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
                    {formError}
                  </p>
                )}
                <div className="flex gap-3">
                  <Button type="submit">{saving ? 'Saving...' : 'Save Sequence'}</Button>
                  <Button type="button" variant="outline" onClick={() => {
                    if (busy) return;
                    setDraft(null);
                    setFormError(null);
                  }}>
                    Cancel
                  </Button>
                </div>
              </fieldset>
            </form>
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-muted-foreground">Loading session sequences...</p>}
      {!loading && !loadError && sequences.length === 0 && (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">No session sequences yet. Create your first one.</p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sequences.map(sequence => (
          <Card key={sequence.sequenceId}>
            <CardHeader>
              <CardTitle className="text-lg break-words">{sequence.name}</CardTitle>
              <CardDescription>{sequence.configIds.length} configuration entries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol aria-label={`Entries for ${sequence.name}`} className="list-none space-y-1 text-sm">
                {sequence.configIds.map((configId, index) => (
                  <li key={index} className="break-words">{index + 1}. {configurationName(configId)}</li>
                ))}
              </ol>
              <div className="flex gap-2">
                <Button
                  type="button"
                  aria-label={`Start ${sequence.name}`}
                  disabled={loading || busy || draft !== null || launchSequence !== null}
                  onClick={() => {
                    setParticipantId('');
                    setLaunchError(null);
                    setLaunchSequence(sequence);
                  }}
                >
                  Start
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Edit ${sequence.name}`}
                  disabled={loading || busy || draft !== null || launchSequence !== null}
                  onClick={() => openForm(sequence)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  aria-label={`Delete ${sequence.name}`}
                  disabled={loading || busy || draft?.sequenceId === sequence.sequenceId || launchSequence !== null}
                  onClick={() => deleteSequence(sequence)}
                >
                  {deletingId === sequence.sequenceId ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
