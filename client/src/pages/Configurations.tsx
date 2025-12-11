import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { Configuration } from '../types';
import { formatTimestamp } from '../lib/utils';

export function Configurations() {
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [archivedConfigurations, setArchivedConfigurations] = useState<Configuration[]>([]);
  const [showArchived, setShowArchived] = useState(false);
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
                  <div className="flex gap-2 mt-4">
                    <Link to={`/start/${config.configId}`} className="flex-1">
                      <Button className="w-full" size="sm">
                        Start Session
                      </Button>
                    </Link>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleArchive(config.configId)}
                      title="Archive configuration"
                    >
                      Archive
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
