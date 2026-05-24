import React, { useState } from "react";
import { useRunTool } from "@workspace/api-client-react";
import { Wrench, Play, Code2, Globe, Clock, Monitor, Hash, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

const AVAILABLE_TOOLS = [
  { id: "web_search", icon: Globe, name: "Web Search", desc: "Search the internet for real-time information", params: ["query"] },
  { id: "calculate", icon: Hash, name: "Calculate", desc: "Evaluate mathematical expressions", params: ["expression"] },
  { id: "fetch_url", icon: Code2, name: "Fetch URL", desc: "Get text content from a web page", params: ["url"] },
  { id: "get_datetime", icon: Clock, name: "Date/Time", desc: "Get current system time", params: [] },
  { id: "system_info", icon: Monitor, name: "System Info", desc: "Get OS and environment details", params: [] },
  { id: "echo", icon: TerminalSquare, name: "Echo", desc: "Echo back input (testing)", params: ["text"] },
];

// Helper since lucide-react might not export TerminalSquare in this specific version, let's use a safe fallback
function TerminalSquare(props: any) {
  return <Wrench {...props} />;
}

export default function Tools() {
  const runTool = useRunTool();
  const [selectedTool, setSelectedTool] = useState<string>("web_search");
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ success: boolean; result: string; error?: string | null } | null>(null);

  const activeToolDef = AVAILABLE_TOOLS.find(t => t.id === selectedTool);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    try {
      const res = await runTool.mutateAsync({ data: { tool: selectedTool, params } });
      setResult(res);
    } catch (err: any) {
      setResult({ success: false, result: "", error: err.message || "Failed to execute tool" });
    }
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Wrench className="w-8 h-8 text-primary" />
            Tool Runner
          </h1>
          <p className="text-muted-foreground mt-2">Test agent tools manually before allowing autonomous use.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tool Selection */}
          <Card className="col-span-1 bg-card border-border">
            <CardHeader>
              <CardTitle>Available Tools</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {AVAILABLE_TOOLS.map(tool => (
                <div 
                  key={tool.id}
                  onClick={() => {
                    setSelectedTool(tool.id);
                    setParams({});
                    setResult(null);
                  }}
                  className={`p-3 rounded-lg flex items-start gap-3 cursor-pointer border transition-colors ${
                    selectedTool === tool.id 
                      ? "bg-primary/10 border-primary text-primary" 
                      : "bg-background border-border text-foreground hover:bg-secondary"
                  }`}
                >
                  <tool.icon className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-sm">{tool.name}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{tool.desc}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Execution Panel */}
          <Card className="col-span-1 lg:col-span-2 bg-card border-border flex flex-col">
            <CardHeader className="border-b border-border bg-background/50">
              <div className="flex items-center gap-2 text-primary font-mono">
                <activeToolDef.icon className="w-5 h-5" />
                {activeToolDef?.name}
              </div>
            </CardHeader>
            <CardContent className="p-6 flex-1 flex flex-col">
              <form onSubmit={handleRun} className="space-y-4 mb-6">
                {activeToolDef?.params.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-4 bg-secondary rounded-md text-center">
                    This tool requires no parameters.
                  </div>
                ) : (
                  activeToolDef?.params.map(param => (
                    <div key={param} className="space-y-2">
                      <Label htmlFor={param} className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        {param}
                      </Label>
                      <Input 
                        id={param} 
                        value={params[param] || ""}
                        onChange={e => setParams(prev => ({ ...prev, [param]: e.target.value }))}
                        className="font-mono bg-zinc-950 border-zinc-800 focus-visible:ring-primary"
                        placeholder={`Enter ${param}...`}
                        required
                      />
                    </div>
                  ))
                )}
                
                <Button type="submit" className="w-full shadow-sm" disabled={runTool.isPending}>
                  {runTool.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Execute Tool
                </Button>
              </form>

              {/* Results */}
              <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md flex flex-col overflow-hidden relative">
                <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex justify-between items-center text-xs font-mono">
                  <span className="text-zinc-400">OUTPUT</span>
                  {result && (
                    <span className={result.success ? "text-emerald-500" : "text-destructive"}>
                      {result.success ? "SUCCESS" : "ERROR"}
                    </span>
                  )}
                </div>
                <div className="p-4 flex-1 overflow-auto font-mono text-sm text-zinc-300">
                  {runTool.isPending ? (
                    <div className="h-full flex items-center justify-center text-zinc-600">
                      <Loader2 className="w-6 h-6 animate-spin mb-2" />
                    </div>
                  ) : !result ? (
                    <div className="text-zinc-600 italic">// Awaiting execution...</div>
                  ) : result.success ? (
                    <pre className="whitespace-pre-wrap">{result.result}</pre>
                  ) : (
                    <div className="text-destructive whitespace-pre-wrap">{result.error}</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}