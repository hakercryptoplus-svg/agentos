import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Bot, User, RefreshCw, Cpu, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGetSession, useListMessages, useClearSession, getListMessagesQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";

// Simple Markdown Renderer
function MessageContent({ content }: { content: string }) {
  // Very basic regex-based splitting for code blocks
  const blocks = content.split(/(```[\s\S]*?```)/g);
  
  return (
    <div className="space-y-2 text-sm leading-relaxed whitespace-pre-wrap font-sans">
      {blocks.map((block, idx) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const match = block.match(/```(\w*)\n([\s\S]*?)```/);
          if (match) {
            const [, lang, code] = match;
            return (
              <div key={idx} className="relative mt-2 mb-2 rounded-md overflow-hidden bg-zinc-950 border border-zinc-800 shadow-sm">
                {lang && (
                  <div className="px-3 py-1 bg-zinc-900/80 text-xs text-zinc-400 border-b border-zinc-800 font-mono flex justify-between items-center">
                    <span>{lang}</span>
                  </div>
                )}
                <pre className="p-3 overflow-x-auto text-[13px] font-mono text-zinc-300">
                  <code>{code.trim()}</code>
                </pre>
              </div>
            );
          }
        }
        return <span key={idx}>{block}</span>;
      })}
    </div>
  );
}

export default function Chat() {
  const [location] = useLocation();
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');
  
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  
  const { data: session } = useGetSession(sessionId || "", { 
    query: { enabled: !!sessionId } 
  });
  
  const { data: messages, isLoading: messagesLoading } = useListMessages(sessionId || "", {
    query: { enabled: !!sessionId }
  });

  const clearSession = useClearSession();

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleClear = () => {
    if (!sessionId) return;
    clearSession.mutate({ id: sessionId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(sessionId) });
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !sessionId || isStreaming) return;

    const userMessage = input;
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    // Optimistically add user message to cache
    queryClient.setQueryData(getListMessagesQueryKey(sessionId), (old: any) => {
      const msgs = old || [];
      return [...msgs, { id: 'temp', sessionId, role: 'user', content: userMessage, createdAt: new Date().toISOString() }];
    });

    try {
      const response = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMessage, stream: true })
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulatedContent = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.replace("data: ", "").trim();
              if (dataStr === "[DONE]") {
                done = true;
                break;
              }
              try {
                const data = JSON.parse(dataStr);
                if (data.type === "delta" && data.content) {
                  accumulatedContent += data.content;
                  setStreamingContent(accumulatedContent);
                } else if (data.type === "error") {
                  console.error("Stream error:", data.error);
                }
              } catch (e) {
                // Ignore parse errors for partial chunks
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      // Refresh real messages and session list to update lastMessage
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(sessionId) });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    }
  };

  if (!sessionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
        <Cpu className="w-16 h-16 mb-6 opacity-20 text-primary" />
        <h2 className="text-xl font-medium text-foreground mb-2">Agent Mission Control</h2>
        <p className="text-center max-w-md">Select a session from the sidebar or create a new one to start interacting with your agent.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="h-14 shrink-0 border-b border-border flex items-center justify-between px-4 bg-background/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <h1 className="font-medium text-foreground">{session?.title || "Session"}</h1>
          {session?.channel && (
            <span className="text-[10px] uppercase tracking-wider font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
              {session.channel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleClear} className="text-muted-foreground hover:text-destructive transition-colors">
            <RefreshCw className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth"
      >
        {messagesLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : messages?.length === 0 && !isStreaming ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Bot className="w-12 h-12 mb-4 opacity-20" />
            <p>No messages yet. Send a message to start.</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8 pb-4">
            {messages?.map((msg) => (
              <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-md shrink-0 flex items-center justify-center ${msg.role === 'user' ? 'bg-secondary' : 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'}`}>
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {msg.role !== 'user' && (
                    <span className="text-xs font-medium text-muted-foreground ml-1">Agent</span>
                  )}
                  <div className={`px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-secondary text-secondary-foreground rounded-tr-sm' : 'bg-card border border-border shadow-sm rounded-tl-sm'}`}>
                    {msg.role === 'tool' ? (
                      <div className="text-xs font-mono text-muted-foreground bg-zinc-950 p-2 rounded border border-zinc-800">
                        <div className="text-primary mb-1">🛠 Ran tool: {msg.toolName}</div>
                        {msg.toolResult}
                      </div>
                    ) : (
                      <MessageContent content={msg.content} />
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Streaming Message Indicator */}
            {isStreaming && (
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-md shrink-0 bg-primary text-primary-foreground flex items-center justify-center shadow-sm shadow-primary/20">
                  <Bot className="w-4 h-4 animate-pulse" />
                </div>
                <div className="flex flex-col gap-1 max-w-[85%] items-start">
                  <span className="text-xs font-medium text-primary ml-1 flex items-center gap-2">
                    Agent typing
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </span>
                  <div className="px-4 py-3 rounded-2xl bg-card border border-border shadow-sm rounded-tl-sm min-w-[60px] min-h-[44px]">
                    <MessageContent content={streamingContent} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-background border-t border-border">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative flex items-end gap-2 bg-card border border-border rounded-xl shadow-sm focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50 transition-all p-2">
          <Input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message to your agent..."
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-10"
            disabled={isStreaming}
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!input.trim() || isStreaming}
            className={`shrink-0 rounded-lg ${input.trim() ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : 'bg-secondary text-muted-foreground'}`}
          >
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
        <div className="text-center mt-2 text-[10px] text-muted-foreground font-mono">
          Model: {session?.model || "default"}
        </div>
      </div>
    </div>
  );
}