export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      bridge_modules: {
        Row: {
          created_at: string
          goal_node_id: string | null
          id: string
          skill_node_id: string
          status: string
          tasks: Json
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_node_id?: string | null
          id?: string
          skill_node_id: string
          status?: string
          tasks?: Json
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          goal_node_id?: string | null
          id?: string
          skill_node_id?: string
          status?: string
          tasks?: Json
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bridge_modules_goal_node_id_fkey"
            columns: ["goal_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bridge_modules_skill_node_id_fkey"
            columns: ["skill_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_sessions: {
        Row: {
          completed_at: string | null
          id: string
          item_ids: string[]
          started_at: string
          status: string
          summary: Json | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          item_ids?: string[]
          started_at?: string
          status?: string
          summary?: Json | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          item_ids?: string[]
          started_at?: string
          status?: string
          summary?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      diagnostic_items: {
        Row: {
          correct_option_id: string
          difficulty: number
          id: string
          options: Json
          question_text: string
          skill_node_id: string
        }
        Insert: {
          correct_option_id: string
          difficulty?: number
          id?: string
          options: Json
          question_text: string
          skill_node_id: string
        }
        Update: {
          correct_option_id?: string
          difficulty?: number
          id?: string
          options?: Json
          question_text?: string
          skill_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_items_skill_node_id_fkey"
            columns: ["skill_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_evaluations: {
        Row: {
          categories: Json
          created_at: string
          id: string
          readiness_notes: string | null
          session_id: string
          strengths: Json
          weaknesses: Json
        }
        Insert: {
          categories?: Json
          created_at?: string
          id?: string
          readiness_notes?: string | null
          session_id: string
          strengths?: Json
          weaknesses?: Json
        }
        Update: {
          categories?: Json
          created_at?: string
          id?: string
          readiness_notes?: string | null
          session_id?: string
          strengths?: Json
          weaknesses?: Json
        }
        Relationships: [
          {
            foreignKeyName: "interview_evaluations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_sessions: {
        Row: {
          config: Json
          ended_at: string | null
          id: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          config?: Json
          ended_at?: string | null
          id?: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          config?: Json
          ended_at?: string | null
          id?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      interview_turns: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_turns_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      learner_constraints: {
        Row: {
          completed_courses: string[]
          daily_time_minutes: number | null
          deadline_date: string | null
          display_name: string | null
          goal_node_id: string | null
          goal_text: string | null
          learning_style: string | null
          skill_level: string
          subjects: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_courses?: string[]
          daily_time_minutes?: number | null
          deadline_date?: string | null
          display_name?: string | null
          goal_node_id?: string | null
          goal_text?: string | null
          learning_style?: string | null
          skill_level?: string
          subjects?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_courses?: string[]
          daily_time_minutes?: number | null
          deadline_date?: string | null
          display_name?: string | null
          goal_node_id?: string | null
          goal_text?: string | null
          learning_style?: string | null
          skill_level?: string
          subjects?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learner_constraints_goal_node_id_fkey"
            columns: ["goal_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      learner_responses: {
        Row: {
          attempt: number
          correct: boolean
          created_at: string
          difficulty: number | null
          id: string
          item_id: string | null
          new_mastery: number | null
          previous_mastery: number | null
          selected_option_id: string | null
          session_id: string | null
          skill_node_id: string
          user_id: string
        }
        Insert: {
          attempt?: number
          correct: boolean
          created_at?: string
          difficulty?: number | null
          id?: string
          item_id?: string | null
          new_mastery?: number | null
          previous_mastery?: number | null
          selected_option_id?: string | null
          session_id?: string | null
          skill_node_id: string
          user_id: string
        }
        Update: {
          attempt?: number
          correct?: boolean
          created_at?: string
          difficulty?: number | null
          id?: string
          item_id?: string | null
          new_mastery?: number | null
          previous_mastery?: number | null
          selected_option_id?: string | null
          session_id?: string | null
          skill_node_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learner_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learner_responses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "calibration_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learner_responses_skill_node_id_fkey"
            columns: ["skill_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      learner_skill_state: {
        Row: {
          id: string
          last_exposed_at: string | null
          last_practiced_at: string | null
          observation_count: number
          p_mastery: number
          skill_node_id: string
          source: string
          user_id: string
        }
        Insert: {
          id?: string
          last_exposed_at?: string | null
          last_practiced_at?: string | null
          observation_count?: number
          p_mastery?: number
          skill_node_id: string
          source?: string
          user_id: string
        }
        Update: {
          id?: string
          last_exposed_at?: string | null
          last_practiced_at?: string | null
          observation_count?: number
          p_mastery?: number
          skill_node_id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learner_skill_state_skill_node_id_fkey"
            columns: ["skill_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_history: {
        Row: {
          created_at: string
          id: string
          node_snapshot: Json | null
          reasoning: string | null
          summary: string | null
          trigger: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          node_snapshot?: Json | null
          reasoning?: string | null
          summary?: string | null
          trigger?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          node_snapshot?: Json | null
          reasoning?: string | null
          summary?: string | null
          trigger?: string | null
          user_id?: string
        }
        Relationships: []
      }
      skill_edges: {
        Row: {
          from_node_id: string
          id: string
          to_node_id: string
          weight: number
        }
        Insert: {
          from_node_id: string
          id?: string
          to_node_id: string
          weight?: number
        }
        Update: {
          from_node_id?: string
          id?: string
          to_node_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "skill_edges_from_node_id_fkey"
            columns: ["from_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_edges_to_node_id_fkey"
            columns: ["to_node_id"]
            isOneToOne: false
            referencedRelation: "skill_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_nodes: {
        Row: {
          created_at: string
          description: string | null
          domain: string
          effort_hours: number
          id: string
          is_required: boolean
          market_weight: number
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          domain: string
          effort_hours?: number
          id?: string
          is_required?: boolean
          market_weight?: number
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          domain?: string
          effort_hours?: number
          id?: string
          is_required?: boolean
          market_weight?: number
          name?: string
        }
        Relationships: []
      }
      tutor_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tutor_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "tutor_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_plan_snapshot: {
        Args: {
          p_node_ids: Json
          p_reasoning: string
          p_summary: string
          p_trigger: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
