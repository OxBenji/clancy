import communityThemes from "@/themes.config.json";

export interface Theme {
  id: string;
  name: string;
  author: string;
  description: string;
  tags: string[];
  prompt: string;
}

export const THEMES: Theme[] = communityThemes;
