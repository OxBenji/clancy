import configTemplates from "@/templates.config.json";

export interface Template {
  id: string;
  name: string;
  description: string;
  icon?: string;
  prompt: string;
}

export const TEMPLATES: Template[] = configTemplates;
