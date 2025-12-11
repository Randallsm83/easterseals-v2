import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';

export function Home() {
  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Quick Actions */}
      <div className="grid gap-6 md:grid-cols-3">
        <Link to="/participants" className="block">
          <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle>Participants</CardTitle>
              <CardDescription>
                View all participants and their session history
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/configurations" className="block">
          <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle>Configurations</CardTitle>
              <CardDescription>
                Manage experiment configurations and parameters
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/analytics" className="block">
          <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
            <CardHeader>
              <CardTitle>Analytics</CardTitle>
              <CardDescription>
                View session data and performance metrics
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Quick Start */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Start</CardTitle>
          <CardDescription>
            Start a new session with an existing configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Link to="/configurations">
            <Button>Select Configuration</Button>
          </Link>
          <Link to="/config/new">
            <Button variant="outline" className="select-none">Create New Configuration</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
