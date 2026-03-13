export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          description: string | null;
          status: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          description?: string | null;
          status?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string | null;
          description?: string | null;
          status?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          id: string;
          project_id: string | null;
          label: string | null;
          status: string | null;
          duration_seconds: number | null;
          order_index: number | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          label?: string | null;
          status?: string | null;
          duration_seconds?: number | null;
          order_index?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string | null;
          label?: string | null;
          status?: string | null;
          duration_seconds?: number | null;
          order_index?: number | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
            isOneToOne: false;
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
