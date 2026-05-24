import React from "react";
import { Link, useLocation } from "wouter";
import { useListSessions, useCreateSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Database, Wrench, Settings, Plus, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: sessions } = useListSessions();
  const createSession = useCreateSession();

  const handleNewChat = () => {
    createSession.mutate(
      { data: { title: "New Session" } },
      {
        onSuccess: (newSession) => {
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          setLocation(`/?session=${newSession.id}`);
        },
      }
    );
  };

  const navItems = [
    { icon: MessageSquare, label: "Chat", path: "/" },
    { icon: Database, label: "Memory", path: "/memory" },
    { icon: Terminal, label: "Skills", path: "/skills" },
    { icon: Wrench, label: "Tools", path: "/tools" },
    { icon: Settings, label: "Settings", path: "/settings" },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30">
      {/* Sidebar Navigation */}
      <aside className="w-16 md:w-64 border-r border-border bg-sidebar flex flex-col shrink-0 transition-all duration-300">
        <div className="h-14 flex items-center justify-center md:justify-start md:px-4 border-b border-border">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
            <Terminal className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="ml-3 font-semibold text-sidebar-foreground hidden md:block tracking-tight">AGENT<span className="text-primary font-bold">OS</span></span>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-1 px-2 md:px-3 overflow-hidden">
          <div className="mb-4 hidden md:block">
            <Button onClick={handleNewChat} className="w-full justify-start shadow-sm" variant="default">
              <Plus className="w-4 h-4 mr-2" />
              New Session
            </Button>
          </div>
          <div className="mb-4 md:hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={handleNewChat} size="icon" className="w-full rounded-lg shadow-sm" variant="default">
                  <Plus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">New Session</TooltipContent>
            </Tooltip>
          </div>

          <ScrollArea className="flex-1 -mx-2 px-2">
            <div className="space-y-1">
              <div className="text-xs font-medium text-sidebar-foreground/50 mb-2 px-2 hidden md:block">Views</div>
              {navItems.map((item) => {
                const isActive = location === item.path || (location.startsWith(item.path) && item.path !== "/");
                return (
                  <Link key={item.path} href={item.path} className="block">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={`flex items-center justify-center md:justify-start px-2 py-2 rounded-md transition-colors cursor-pointer ${
                            isActive
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                          }`}
                        >
                          <item.icon className="w-4 h-4 shrink-0" />
                          <span className="ml-3 text-sm hidden md:block">{item.label}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="md:hidden">{item.label}</TooltipContent>
                    </Tooltip>
                  </Link>
                );
              })}

              <Separator className="my-4 hidden md:block bg-sidebar-border" />
              
              <div className="text-xs font-medium text-sidebar-foreground/50 mb-2 px-2 hidden md:block mt-4">Recent Sessions</div>
              
              <div className="space-y-0.5 hidden md:block">
                {sessions?.slice(0, 10).map((session) => {
                  // Basic extraction of session ID from query params
                  const urlParams = new URLSearchParams(window.location.search);
                  const activeSessionId = urlParams.get('session');
                  const isSessionActive = location === "/" && activeSessionId === session.id;

                  return (
                    <Link key={session.id} href={`/?session=${session.id}`} className="block">
                      <div
                        className={`px-2 py-1.5 rounded-md text-sm truncate transition-colors cursor-pointer ${
                          isSessionActive
                            ? "bg-sidebar-accent text-primary font-medium"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        }`}
                      >
                        {session.title || "Untitled Session"}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </ScrollArea>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        <div className="absolute inset-0 pointer-events-none z-[-1] opacity-20" 
             style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, hsl(var(--primary) / 0.15) 0%, transparent 50%)' }} 
        />
        {children}
      </main>
    </div>
  );
}