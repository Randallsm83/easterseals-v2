import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';

export function Home() {
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="text-center py-12">
        <h1 className="text-5xl font-bold mb-4">Easterseals Research Study</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Behavioral research platform for conducting button-click experiments with configurable reward schedules
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="text-2xl">Participants</CardTitle>
            <CardDescription>
              View all participants and their session history
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/participants">
              <Button className="w-full" size="lg">View Participants</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="text-2xl">Configurations</CardTitle>
            <CardDescription>
              Manage experiment configurations and parameters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/configurations">
              <Button className="w-full" size="lg" variant="secondary">View Configurations</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="text-2xl">Analytics</CardTitle>
            <CardDescription>
              View session data and performance metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/analytics">
              <Button className="w-full" size="lg" variant="outline">View Analytics</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Quick Start */}
      <Card className="bg-gradient-to-r from-primary/10 to-accent/10">
        <CardHeader>
          <CardTitle className="text-xl">Quick Start</CardTitle>
          <CardDescription>
            Start a new session with an existing configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Link to="/configurations">
            <Button>Select Configuration & Start Session</Button>
          </Link>
          <Link to="/config/new">
            <Button variant="outline">Create New Configuration</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
