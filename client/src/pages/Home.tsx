import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import type { Configuration } from '../types';
import { formatTimestamp } from '../lib/utils';

export function Home() {
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfigurations();
  }, []);

  async function loadConfigurations() {
    try {
      const data = await api.getConfigurations();
      setConfigurations(data);
    } catch (error) {
      console.error('Failed to load configurations:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Easterseals Research Study</h1>
          <p className="text-muted-foreground mt-2">
            Create configurations and run sessions
          </p>
        </div>
        <Link to="/config/new">
          <Button size="lg">Create Configuration</Button>
        </Link>
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
                  <CardTitle className="text-lg">{config.name}</CardTitle>
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
                      <span className="text-muted-foreground">Points per {parsedConfig.clicksNeeded} clicks:</span>
                      <span className="font-medium">{parsedConfig.pointsAwarded}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Session Limit:</span>
                      <span className="font-medium">
                        {parsedConfig.sessionLength} {parsedConfig.sessionLengthType}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Link to={`/start/${config.configId}`} className="flex-1">
                      <Button className="w-full" size="sm">
                        Start Session
                      </Button>
                    </Link>
                    <Link to={`/config/${config.configId}/sessions`} className="flex-1">
                      <Button className="w-full" variant="outline" size="sm">
                        View Sessions
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
