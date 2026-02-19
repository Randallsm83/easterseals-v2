import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { Configuration, SessionListItem } from '../types';
import { formatTimestamp } from '../lib/utils';

function ConfigSessionsList({ configId }: { configId: string }) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getConfigurationSessions(configId)
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [configId]);

  if (loading) return <p className="text-xs text-muted-foreground py-2">Loading sessions...</p>;
  if (sessions.length === 0) return <p className="text-xs text-muted-foreground py-2">No sessions found</p>;

  return (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {sessions.map((s) => (
        <Link
          key={s.sessionId}
          to={`/analytics/${s.sessionId}`}
          className="flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-muted/50 transition-colors group"
        >
          <span className="font-mono text-muted-foreground group-hover:text-foreground">{s.sessionId}</span>
          <span className="text-muted-foreground">
            {s.startedAt ? formatTimestamp(s.startedAt) : '—'}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function Configurations() {
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [archivedConfigurations, setArchivedConfigurations] = useState<Configuration[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [expandedConfigs, setExpandedConfigs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfigurations();
  }, []);

  async function loadConfigurations() {
    try {
      const [active, archived] = await Promise.all([
        api.getConfigurations(),
        api.getConfigurations({ archivedOnly: true }),
      ]);
      setConfigurations(active);
      setArchivedConfigurations(archived);
    } catch (error) {
      console.error('Failed to load configurations:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleArchive(configId: string) {
    try {
      await api.archiveConfiguration(configId);
      await loadConfigurations();
    } catch (error) {
      console.error('Failed to archive configuration:', error);
    }
  }

  async function handleUnarchive(configId: string) {
    try {
      await api.unarchiveConfiguration(configId);
      await loadConfigurations();
    } catch (error) {
      console.error('Failed to unarchive configuration:', error);
    }
  }

  function toggleExpanded(configId: string) {
    setExpandedConfigs((prev) => {
      const next = new Set(prev);
      if (next.has(configId)) next.delete(configId);
      else next.add(configId);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Configurations</h1>
          <p className="text-muted-foreground mt-1">
            Manage session configurations
          </p>
        </div>
        <div className="flex gap-2">
          {archivedConfigurations.length > 0 && (
            <Button 
              variant="outline" 
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? 'Hide' : 'Show'} Archived ({archivedConfigurations.length})
            </Button>
          )}
          <Link to="/config/new">
            <Button size="lg">Create Configuration</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-muted-foreground">Loading configurations...</p>
            </CardContent>
          </Card>
        ) : configurations.length === 0 ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-muted-foreground">No configurations yet. Create your first one!</p>
            </CardContent>
          </Card>
        ) : (
          configurations.map((config) => {
            const parsedConfig = typeof config.config === 'string' ? JSON.parse(config.config) : config.config;
            const isExpanded = expandedConfigs.has(config.configId);
            const count = config.sessionCount ?? 0;
            return (
              <Card key={config.configId} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="text-lg">{config.name || `Config ${config.configId}`}</CardTitle>
                  <CardDescription>
                    Created {formatTimestamp(config.createdAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Active Button:</span>
                      <span className="font-medium capitalize">{parsedConfig.buttonActive}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Time Limit:</span>
                      <span className="font-medium">{parsedConfig.timeLimit}s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Money Awarded:</span>
                      <span className="font-medium">${(parsedConfig.moneyAwarded / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Award Interval:</span>
                      <span className="font-medium">{parsedConfig.awardInterval} clicks</span>
                    </div>
                  </div>

                  {/* Sessions toggle */}
                  {count > 0 && (
                    <button
                      onClick={() => toggleExpanded(config.configId)}
                      className="flex items-center gap-1 text-sm text-primary hover:underline w-full"
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {count} session{count !== 1 ? 's' : ''}
                    </button>
                  )}
                  {count === 0 && (
                    <span className="text-xs text-muted-foreground">No sessions</span>
                  )}

                  {isExpanded && (
                    <div className="border-t pt-2">
                      <ConfigSessionsList configId={config.configId} />
                    </div>
                  )}

                  <div className="flex gap-2 mt-4">
                    <Link to={`/start/${config.configId}`} className="flex-1">
                      <Button className="w-full" size="sm">
                        Start Session
                      </Button>
                    </Link>
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={() => handleArchive(config.configId)}
                      title="Archive configuration"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Archived Configurations */}
      {showArchived && archivedConfigurations.length > 0 && (
        <>
          <div className="border-t pt-6">
            <h2 className="text-xl font-semibold text-muted-foreground mb-4">Archived Configurations</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {archivedConfigurations.map((config) => {
                const parsedConfig = typeof config.config === 'string' ? JSON.parse(config.config) : config.config;
                const count = config.sessionCount ?? 0;
                const isExpanded = expandedConfigs.has(config.configId);
                return (
                  <Card key={config.configId} className="opacity-60 hover:opacity-100 transition-opacity">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {config.name || `Config ${config.configId}`}
                        <span className="text-xs bg-muted px-2 py-0.5 rounded">Archived</span>
                      </CardTitle>
                      <CardDescription>
                        Created {formatTimestamp(config.createdAt)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Active Button:</span>
                          <span className="font-medium capitalize">{parsedConfig.buttonActive}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Time Limit:</span>
                          <span className="font-medium">{parsedConfig.timeLimit}s</span>
                        </div>
                      </div>
                      {count > 0 && (
                        <button
                          onClick={() => toggleExpanded(config.configId)}
                          className="flex items-center gap-1 text-sm text-primary hover:underline w-full"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {count} session{count !== 1 ? 's' : ''}
                        </button>
                      )}
                      {isExpanded && (
                        <div className="border-t pt-2">
                          <ConfigSessionsList configId={config.configId} />
                        </div>
                      )}
                      <div className="flex gap-2 mt-4">
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="flex-1"
                          onClick={() => handleUnarchive(config.configId)}
                        >
                          Restore
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
