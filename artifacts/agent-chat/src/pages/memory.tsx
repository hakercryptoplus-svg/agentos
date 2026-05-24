import React, { useState } from "react";
import { useListMemory, useCreateMemory, useDeleteMemory, getListMemoryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Trash2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function Memory() {
  const queryClient = useQueryClient();
  const { data: memories, isLoading } = useListMemory();
  const createMemory = useCreateMemory();
  const deleteMemory = useDeleteMemory();

  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [newMemory, setNewMemory] = useState({ key: "", value: "", category: "general" });

  const filteredMemories = memories?.filter(m => 
    m.key.toLowerCase().includes(search.toLowerCase()) || 
    m.value.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.key || !newMemory.value) return;

    createMemory.mutate({ data: newMemory }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey() });
        setIsOpen(false);
        setNewMemory({ key: "", value: "", category: "general" });
      }
    });
  };

  const handleDelete = (id: string) => {
    deleteMemory.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMemoryQueryKey() });
      }
    });
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <BrainCircuit className="w-8 h-8 text-primary" />
              Agent Memory
            </h1>
            <p className="text-muted-foreground mt-2">Manage persistent core memory across all sessions.</p>
          </div>
          
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="shadow-sm shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" />
                Add Entry
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Add Memory Entry</DialogTitle>
                  <DialogDescription>
                    Teach your agent a new fact to remember permanently.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="key">Key Fact</Label>
                    <Input id="key" value={newMemory.key} onChange={e => setNewMemory({...newMemory, key: e.target.value})} placeholder="e.g. User Name" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="value">Details</Label>
                    <Textarea id="value" value={newMemory.value} onChange={e => setNewMemory({...newMemory, value: e.target.value})} placeholder="e.g. John Doe, works as a developer" required className="h-24" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="category">Category</Label>
                    <Input id="category" value={newMemory.category} onChange={e => setNewMemory({...newMemory, category: e.target.value})} placeholder="e.g. user_prefs" required />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMemory.isPending}>Save to Memory</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search memories..." 
            className="pl-9 bg-card border-border"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="animate-pulse bg-card/50 border-border/50 h-32" />
            ))}
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg bg-card/30">
            <BrainCircuit className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No memories found</h3>
            <p className="text-muted-foreground">The agent's memory bank is empty or no matches found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMemories.map((entry) => (
              <Card key={entry.id} className="bg-card hover:bg-card/80 transition-colors border-border group relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-primary/10 rounded-bl-full -mr-8 -mt-8 pointer-events-none" />
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg font-medium text-primary line-clamp-1 pr-6" title={entry.key}>
                      {entry.key}
                    </CardTitle>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all absolute top-2 right-2"
                      onClick={() => handleDelete(entry.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardDescription>
                    <Badge variant="outline" className="bg-secondary/50 text-[10px] font-mono border-border uppercase tracking-wider">
                      {entry.category}
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed line-clamp-4">
                    {entry.value}
                  </p>
                  <div className="mt-4 text-[10px] text-muted-foreground font-mono text-right">
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}