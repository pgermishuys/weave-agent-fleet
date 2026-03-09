"use client";

import { Header } from "@/components/layout/header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SkillsTab } from "@/components/settings/skills-tab";
import { AgentsTab } from "@/components/settings/agents-tab";
import { ProvidersTab } from "@/components/settings/providers-tab";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { AboutTab } from "@/components/settings/about-tab";
import { KeybindingsTab } from "@/components/settings/keybindings-tab";
import { AppearanceTab } from "@/components/settings/appearance-tab";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Settings" subtitle="Manage skills, agents, providers, notifications, keybindings, and configuration" />
      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="skills">
          <TabsList variant="line">
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="keybindings">Keybindings</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
          <TabsContent value="skills" className="mt-4">
            <SkillsTab />
          </TabsContent>
          <TabsContent value="agents" className="mt-4">
            <AgentsTab />
          </TabsContent>
          <TabsContent value="providers" className="mt-4">
            <ProvidersTab />
          </TabsContent>
          <TabsContent value="notifications" className="mt-4">
            <NotificationsTab />
          </TabsContent>
          <TabsContent value="keybindings" className="mt-4">
            <KeybindingsTab />
          </TabsContent>
          <TabsContent value="appearance" className="mt-4">
            <AppearanceTab />
          </TabsContent>
          <TabsContent value="about" className="mt-4">
            <AboutTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
