import React, { useState } from "react";
import { useListSkills, useCreateSkill, useDeleteSkill, getListSkillsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal, Trash2, Plus, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function Skills() {
  const queryClient = useQueryClient();
  const { data: skills, isLoading } = useListSkills();
  const createSkill = useCreateSkill();
  const deleteSkill = useDeleteSkill();

  const [isOpen, setIsOpen] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: "", description: "", content: "" });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSkill.name || !newSkill.content) return;

    createSkill.mutate({ data: newSkill }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSkillsQueryKey() });
        setIsOpen(false);
        setNewSkill({ name: "", description: "", content: "" });
      }
    });
  };

  const handleDelete = (id: string) => {
    deleteSkill.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSkillsQueryKey() });
      }
    });
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <Terminal className="w-8 h-8 text-primary" />
              Skills Library
            </h1>
            <p className="text-muted-foreground mt-2">Custom instructions and capabilities the agent can load.</p>
          </div>
          
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="shadow-sm shadow-primary/20">
                <Plus className="w-4 h-4 mr-2" />
                New Skill
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Create Agent Skill</DialogTitle>
                  <DialogDescription>
                    Define a new skill file that the agent can utilize.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Skill Name (Slug)</Label>
                    <Input id="name" value={newSkill.name} onChange={e => setNewSkill({...newSkill, name: e.target.value})} placeholder="e.g. write_python_tests" required className="font-mono" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description">Short Description</Label>
                    <Input id="description" value={newSkill.description} onChange={e => setNewSkill({...newSkill, description: e.target.value})} placeholder="e.g. Guidelines for writing pytest suites" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="content">Skill Content (Markdown)</Label>
                    <Textarea 
                      id="content" 
                      value={newSkill.content} 
                      onChange={e => setNewSkill({...newSkill, content: e.target.value})} 
                      placeholder="# Python Testing Guidelines\n\n1. Always use pytest..." 
                      required 
                      className="h-48 font-mono text-xs bg-zinc-950" 
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createSkill.isPending}>Deploy Skill</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse bg-card/50 border-border/50 h-24" />
            ))}
          </div>
        ) : skills?.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg bg-card/30">
            <FileCode2 className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No skills defined</h3>
            <p className="text-muted-foreground">Add skill markdown files to give your agent specialized knowledge.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {skills?.map((skill) => (
              <Card key={skill.id} className="bg-card border-border hover:border-primary/50 transition-colors group">
                <CardHeader className="py-4 flex flex-row items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg font-mono text-primary flex items-center gap-2">
                        <FileCode2 className="w-4 h-4 text-muted-foreground" />
                        {skill.name}
                      </CardTitle>
                      <Badge variant="secondary" className="bg-secondary text-secondary-foreground font-mono text-[10px]">
                        Uses: {skill.usageCount}
                      </Badge>
                    </div>
                    <CardDescription className="text-sm">
                      {skill.description}
                    </CardDescription>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(skill.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}