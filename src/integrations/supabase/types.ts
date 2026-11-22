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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      boq_items: {
        Row: {
          cell_styles: Json | null
          created_at: string
          description_ar: string
          description_en: string | null
          equipment_cost: number | null
          id: string
          is_group: boolean
          item_no: string
          labor_cost: number | null
          level: number
          material_cost: number | null
          parent_id: string | null
          project_id: string | null
          quantity: number | null
          raw_row: Json | null
          sheet_name: string | null
          sort_order: number
          subcontractor_cost: number | null
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cell_styles?: Json | null
          created_at?: string
          description_ar: string
          description_en?: string | null
          equipment_cost?: number | null
          id?: string
          is_group?: boolean
          item_no: string
          labor_cost?: number | null
          level?: number
          material_cost?: number | null
          parent_id?: string | null
          project_id?: string | null
          quantity?: number | null
          raw_row?: Json | null
          sheet_name?: string | null
          sort_order?: number
          subcontractor_cost?: number | null
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cell_styles?: Json | null
          created_at?: string
          description_ar?: string
          description_en?: string | null
          equipment_cost?: number | null
          id?: string
          is_group?: boolean
          item_no?: string
          labor_cost?: number | null
          level?: number
          material_cost?: number | null
          parent_id?: string | null
          project_id?: string | null
          quantity?: number | null
          raw_row?: Json | null
          sheet_name?: string | null
          sort_order?: number
          subcontractor_cost?: number | null
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      price_analysis_items: {
        Row: {
          boq_item_id: string
          cell_styles: Json | null
          created_at: string
          description_ar: string
          description_en: string | null
          id: string
          project_id: string | null
          quantity: number
          resource_id: string | null
          resource_type: Database["public"]["Enums"]["resource_type"]
          sort_order: number
          unit: string
          unit_price: number
          user_id: string
        }
        Insert: {
          boq_item_id: string
          cell_styles?: Json | null
          created_at?: string
          description_ar: string
          description_en?: string | null
          id?: string
          project_id?: string | null
          quantity?: number
          resource_id?: string | null
          resource_type: Database["public"]["Enums"]["resource_type"]
          sort_order?: number
          unit: string
          unit_price?: number
          user_id: string
        }
        Update: {
          boq_item_id?: string
          cell_styles?: Json | null
          created_at?: string
          description_ar?: string
          description_en?: string | null
          id?: string
          project_id?: string | null
          quantity?: number
          resource_id?: string | null
          resource_type?: Database["public"]["Enums"]["resource_type"]
          sort_order?: number
          unit?: string
          unit_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_analysis_items_boq_item_id_fkey"
            columns: ["boq_item_id"]
            isOneToOne: false
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_analysis_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_analysis_items_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      price_analysis_markup: {
        Row: {
          boq_item_id: string
          indirect_pct: number
          overhead_pct: number
          profit_pct: number
          project_id: string | null
          risk_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          boq_item_id: string
          indirect_pct?: number
          overhead_pct?: number
          profit_pct?: number
          project_id?: string | null
          risk_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          boq_item_id?: string
          indirect_pct?: number
          overhead_pct?: number
          profit_pct?: number
          project_id?: string | null
          risk_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_analysis_markup_boq_item_id_fkey"
            columns: ["boq_item_id"]
            isOneToOne: true
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_analysis_markup_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          category: string | null
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          area: string | null
          budget: number | null
          client_name: string | null
          code: string | null
          contract_type: string | null
          created_at: string
          duration: string | null
          end_date: string | null
          estimated_value: number | null
          excel_headers: Json | null
          excel_pre_headers: Json | null
          excel_sheets_order: string[] | null
          financial_requirements: string | null
          id: string
          last_rfi_date: string | null
          last_submit_date: string | null
          location: string | null
          name: string
          note: string | null
          notes: string | null
          project_no: number | null
          scope_of_work: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          submission_date: string | null
          technical_requirements: string | null
          tender_entry_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: string | null
          budget?: number | null
          client_name?: string | null
          code?: string | null
          contract_type?: string | null
          created_at?: string
          duration?: string | null
          end_date?: string | null
          estimated_value?: number | null
          excel_headers?: Json | null
          excel_pre_headers?: Json | null
          excel_sheets_order?: string[] | null
          financial_requirements?: string | null
          id?: string
          last_rfi_date?: string | null
          last_submit_date?: string | null
          location?: string | null
          name: string
          note?: string | null
          notes?: string | null
          project_no?: number | null
          scope_of_work?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submission_date?: string | null
          technical_requirements?: string | null
          tender_entry_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string | null
          budget?: number | null
          client_name?: string | null
          code?: string | null
          contract_type?: string | null
          created_at?: string
          duration?: string | null
          end_date?: string | null
          estimated_value?: number | null
          excel_headers?: Json | null
          excel_pre_headers?: Json | null
          excel_sheets_order?: string[] | null
          financial_requirements?: string | null
          id?: string
          last_rfi_date?: string | null
          last_submit_date?: string | null
          location?: string | null
          name?: string
          note?: string | null
          notes?: string | null
          project_no?: number | null
          scope_of_work?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submission_date?: string | null
          technical_requirements?: string | null
          tender_entry_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resources: {
        Row: {
          code: string | null
          created_at: string
          division: string | null
          id: string
          name_ar: string
          notes: string | null
          project_id: string | null
          type: Database["public"]["Enums"]["resource_type"]
          unit: string
          unit_price: number
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          division?: string | null
          id?: string
          name_ar: string
          notes?: string | null
          project_id?: string | null
          type: Database["public"]["Enums"]["resource_type"]
          unit: string
          unit_price?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          division?: string | null
          id?: string
          name_ar?: string
          notes?: string | null
          project_id?: string | null
          type?: Database["public"]["Enums"]["resource_type"]
          unit?: string
          unit_price?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "estimation_manager" | "estimator" | "viewer"
      project_status:
        | "studying"
        | "submitted_to_medial_man"
        | "submitted_to_client"
        | "waiting_for_reply"
        | "inquiries_sent"
        | "answers_received"
        | "on_hold"
        | "client_rejected"
        | "construction_ongoing"
        | "construction_complete"
        | "finished"
        | "closed"
      resource_type: "material" | "labor" | "equipment" | "subcontractor"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "estimation_manager", "estimator", "viewer"],
      project_status: [
        "studying",
        "submitted_to_medial_man",
        "submitted_to_client",
        "waiting_for_reply",
        "inquiries_sent",
        "answers_received",
        "on_hold",
        "client_rejected",
        "construction_ongoing",
        "construction_complete",
        "finished",
        "closed",
      ],
      resource_type: ["material", "labor", "equipment", "subcontractor"],
    },
  },
} as const
