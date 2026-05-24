import React from "react";
import { useGetAgentStats } from "@workspace/api-client-react";
import { Settings2, Activity, MessageSquare, Database, Terminal, Cpu } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function StatCard({ title, value, icon: Icon, description }: any) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { data: stats, isLoading } = useGetAgentStats();

  const formatUptime = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Settings2 className="w-8 h-8 text-primary" />
            Agent Settings
          </h1>
          <p className="text-muted-foreground mt-2">System statistics and agent configuration.</p>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4 text-foreground">
              <Activity className="w-5 h-5 text-primary" />
              Telemetry
            </h2>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map(i => <Card key={i} className="h-32 animate-pulse bg-card/50" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <StatCard 
                  title="Total Sessions" 
                  value={stats?.totalSessions || 0} 
                  icon={MessageSquare} 
                  description="Active and archived chats"
                />
                <StatCard 
                  title="Total Messages" 
                  value={stats?.totalMessages || 0} 
                  icon={MessageSquare} 
                  description="Interactions processed"
                />
                <StatCard 
                  title="Memory Entries" 
                  value={stats?.totalMemoryEntries || 0} 
                  icon={Database} 
                  description="Persistent facts stored"
                />
                <StatCard 
                  title="Loaded Skills" 
                  value={stats?.totalSkills || 0} 
                  icon={Terminal} 
                  description="Custom capabilities"
                />
                <StatCard 
                  title="System Uptime" 
                  value={stats?.uptime ? formatUptime(stats.uptime) : "0h 0m"} 
                  icon={Cpu} 
                  description="Time since last boot"
                />
                <StatCard 
                  title="Telegram Bot" 
                  value={stats?.telegramConnected ? "Connected" : "Offline"} 
                  icon={Activity} 
                  description="External channel status"
                />
              </div>
            )}
          </div>

          <Separator className="bg-border" />

          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>System Information</CardTitle>
              <CardDescription>AgentOS Core Environment</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs text-zinc-400 space-y-2">
                <div className="flex justify-between">
                  <span>OS_VERSION</span>
                  <span className="text-zinc-300">AgentOS v0.1.0-alpha</span>
                </div>
                <div className="flex justify-between">
                  <span>LLM_ENGINE</span>
                  <span className="text-primary">OpenClaw Engine</span>
                </div>
                <div className="flex justify-between">
                  <span>ENVIRONMENT</span>
                  <span className="text-emerald-500">Production</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}