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
          excel_row_index: number | null
          excel_version_id: string | null
          id: string
          imported_unit_rate: number | null
          is_group: boolean
          is_included_elsewhere: boolean | null
          item_no: string
          labor_cost: number | null
          level: number
          manual_unit_price: number | null
          material_cost: number | null
          note: string | null
          note_cell_ref: string | null
          parent_id: string | null
          pricing_status: string | null
          project_id: string | null
          quantity: number | null
          rate_cell_ref: string | null
          rate_source: string | null
          raw_row: Json | null
          row_kind: string | null
          sheet_name: string | null
          sort_order: number
          subcontractor_cost: number | null
          tender_id: string | null
          total_cell_ref: string | null
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
          excel_row_index?: number | null
          excel_version_id?: string | null
          id?: string
          imported_unit_rate?: number | null
          is_group?: boolean
          is_included_elsewhere?: boolean | null
          item_no: string
          labor_cost?: number | null
          level?: number
          manual_unit_price?: number | null
          material_cost?: number | null
          note?: string | null
          note_cell_ref?: string | null
          parent_id?: string | null
          pricing_status?: string | null
          project_id?: string | null
          quantity?: number | null
          rate_cell_ref?: string | null
          rate_source?: string | null
          raw_row?: Json | null
          row_kind?: string | null
          sheet_name?: string | null
          sort_order?: number
          subcontractor_cost?: number | null
          tender_id?: string | null
          total_cell_ref?: string | null
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
          excel_row_index?: number | null
          excel_version_id?: string | null
          id?: string
          imported_unit_rate?: number | null
          is_group?: boolean
          is_included_elsewhere?: boolean | null
          item_no?: string
          labor_cost?: number | null
          level?: number
          manual_unit_price?: number | null
          material_cost?: number | null
          note?: string | null
          note_cell_ref?: string | null
          parent_id?: string | null
          pricing_status?: string | null
          project_id?: string | null
          quantity?: number | null
          rate_cell_ref?: string | null
          rate_source?: string | null
          raw_row?: Json | null
          row_kind?: string | null
          sheet_name?: string | null
          sort_order?: number
          subcontractor_cost?: number | null
          tender_id?: string | null
          total_cell_ref?: string | null
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
          consumption_rate: number | null
          copied_unit: string | null
          copied_unit_price: number | null
          created_at: string
          description_ar: string
          description_en: string | null
          execution_method: string | null
          id: string
          line_note: string | null
          material_category: string | null
          productivity: number | null
          project_id: string | null
          quantity: number
          quote_id: string | null
          quote_item_id: string | null
          quote_version: number | null
          rate_kind: string | null
          resource_id: string | null
          resource_type: Database["public"]["Enums"]["resource_type"]
          scope_tag: string | null
          sort_order: number
          supplier_quote_id: string | null
          tender_id: string | null
          unit: string
          unit_price: number
          user_id: string
          waste_pct: number | null
        }
        Insert: {
          boq_item_id: string
          cell_styles?: Json | null
          consumption_rate?: number | null
          copied_unit?: string | null
          copied_unit_price?: number | null
          created_at?: string
          description_ar: string
          description_en?: string | null
          execution_method?: string | null
          id?: string
          line_note?: string | null
          material_category?: string | null
          productivity?: number | null
          project_id?: string | null
          quantity?: number
          quote_id?: string | null
          quote_item_id?: string | null
          quote_version?: number | null
          rate_kind?: string | null
          resource_id?: string | null
          resource_type: Database["public"]["Enums"]["resource_type"]
          scope_tag?: string | null
          sort_order?: number
          supplier_quote_id?: string | null
          tender_id?: string | null
          unit: string
          unit_price?: number
          user_id: string
          waste_pct?: number | null
        }
        Update: {
          boq_item_id?: string
          cell_styles?: Json | null
          consumption_rate?: number | null
          copied_unit?: string | null
          copied_unit_price?: number | null
          created_at?: string
          description_ar?: string
          description_en?: string | null
          execution_method?: string | null
          id?: string
          line_note?: string | null
          material_category?: string | null
          productivity?: number | null
          project_id?: string | null
          quantity?: number
          quote_id?: string | null
          quote_item_id?: string | null
          quote_version?: number | null
          rate_kind?: string | null
          resource_id?: string | null
          resource_type?: Database["public"]["Enums"]["resource_type"]
          scope_tag?: string | null
          sort_order?: number
          supplier_quote_id?: string | null
          tender_id?: string | null
          unit?: string
          unit_price?: number
          user_id?: string
          waste_pct?: number | null
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
          manual_unit_price: number | null
          overhead_pct: number
          pricing_policy: string | null
          profit_pct: number
          project_id: string | null
          risk_pct: number
          round_up_rate: boolean | null
          tender_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          boq_item_id: string
          indirect_pct?: number
          manual_unit_price?: number | null
          overhead_pct?: number
          pricing_policy?: string | null
          profit_pct?: number
          project_id?: string | null
          risk_pct?: number
          round_up_rate?: boolean | null
          tender_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          boq_item_id?: string
          indirect_pct?: number
          manual_unit_price?: number | null
          overhead_pct?: number
          pricing_policy?: string | null
          profit_pct?: number
          project_id?: string | null
          risk_pct?: number
          round_up_rate?: boolean | null
          tender_id?: string | null
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
          client_id: string | null
          client_name: string | null
          code: string | null
          company_client_link_id: string | null
          company_id: string | null
          company_name: string | null
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
          client_id?: string | null
          client_name?: string | null
          code?: string | null
          company_client_link_id?: string | null
          company_id?: string | null
          company_name?: string | null
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
          client_id?: string | null
          client_name?: string | null
          code?: string | null
          company_client_link_id?: string | null
          company_id?: string | null
          company_name?: string | null
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
          name_en: string | null
          notes: string | null
          project_id: string | null
          supplier_name: string | null
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
          name_en?: string | null
          notes?: string | null
          project_id?: string | null
          supplier_name?: string | null
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
          name_en?: string | null
          notes?: string | null
          project_id?: string | null
          supplier_name?: string | null
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
      clients: {
        Row: {
          code: string
          contacts: Json | null
          created_at: string
          id: string
          name: string
          notes: string | null
          sector: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          code: string
          contacts?: Json | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          sector?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          code?: string
          contacts?: Json | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          sector?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenders: {
        Row: {
          client_id: string | null
          client_name: string | null
          created_at: string
          currency: string | null
          estimated_value: number | null
          id: string
          notes: string | null
          package_name: string | null
          project_id: string
          responsible_person: string | null
          rfi_deadline: string | null
          status: string
          status_reason: string | null
          submission_deadline: string | null
          submission_time: string | null
          submitted_amount: number | null
          submitted_at: string | null
          tender_no: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          currency?: string | null
          estimated_value?: number | null
          id?: string
          notes?: string | null
          package_name?: string | null
          project_id: string
          responsible_person?: string | null
          rfi_deadline?: string | null
          status?: string
          status_reason?: string | null
          submission_deadline?: string | null
          submission_time?: string | null
          submitted_amount?: number | null
          submitted_at?: string | null
          tender_no: string
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          currency?: string | null
          estimated_value?: number | null
          id?: string
          notes?: string | null
          package_name?: string | null
          project_id?: string
          responsible_person?: string | null
          rfi_deadline?: string | null
          status?: string
          status_reason?: string | null
          submission_deadline?: string | null
          submission_time?: string | null
          submitted_amount?: number | null
          submitted_at?: string | null
          tender_no?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tender_transitions: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: string
          id: string
          reason: string | null
          tender_id: string
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status: string
          id?: string
          reason?: string | null
          tender_id: string
          to_status: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: string
          id?: string
          reason?: string | null
          tender_id?: string
          to_status?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          code: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      company_client_links: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          id: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          id?: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      tender_submissions: {
        Row: {
          currency: string
          document_ref: string | null
          grand_total_with_vat: number
          id: string
          idempotency_key: string
          items_snapshot: Json
          net_selling_price: number
          pricing_policy: string
          project_id: string
          submitted_at: string
          submitted_by: string
          tender_id: string
          total_direct_cost: number
          vat_amount: number
          vat_rate: number
          version_no: number
        }
        Insert: {
          currency?: string
          document_ref?: string | null
          grand_total_with_vat: number
          id?: string
          idempotency_key: string
          items_snapshot: Json
          net_selling_price: number
          pricing_policy?: string
          project_id: string
          submitted_at?: string
          submitted_by: string
          tender_id: string
          total_direct_cost: number
          vat_amount: number
          vat_rate?: number
          version_no: number
        }
        Update: never
        Relationships: []
      }
      supplier_quotes: {
        Row: {
          city: string | null
          created_at: string
          created_by: string | null
          currency: string
          delivery_terms: string | null
          id: string
          project_id: string | null
          quote_date: string | null
          quote_no: string | null
          scope: string | null
          status: string
          supplier_name: string
          transport_included: boolean
          validity_date: string | null
          vat_included: boolean
          version_no: number
          workspace_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_terms?: string | null
          id?: string
          project_id?: string | null
          quote_date?: string | null
          quote_no?: string | null
          scope?: string | null
          status?: string
          supplier_name: string
          transport_included?: boolean
          validity_date?: string | null
          vat_included?: boolean
          version_no?: number
          workspace_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_terms?: string | null
          id?: string
          project_id?: string | null
          quote_date?: string | null
          quote_no?: string | null
          scope?: string | null
          status?: string
          supplier_name?: string
          transport_included?: boolean
          validity_date?: string | null
          vat_included?: boolean
          version_no?: number
          workspace_id?: string
        }
        Relationships: []
      }
      supplier_quote_items: {
        Row: {
          base_unit: string | null
          city: string | null
          created_at: string
          id: string
          min_order_charge: number
          min_order_qty: number
          pack_price: number
          pack_size: number
          pricing_unit: string
          quote_id: string
          resource_id: string | null
          scope_tag: string | null
          shift_hours: number
          specification: string
          terms: string | null
          transport_included: boolean
          unit_conversion_factor: number
          unit_price: number
          vat_included: boolean
          waste_pct: number
        }
        Insert: {
          base_unit?: string | null
          city?: string | null
          created_at?: string
          id?: string
          min_order_charge?: number
          min_order_qty?: number
          pack_price?: number
          pack_size?: number
          pricing_unit: string
          quote_id: string
          resource_id?: string | null
          scope_tag?: string | null
          shift_hours?: number
          specification: string
          terms?: string | null
          transport_included?: boolean
          unit_conversion_factor?: number
          unit_price?: number
          vat_included?: boolean
          waste_pct?: number
        }
        Update: {
          base_unit?: string | null
          city?: string | null
          created_at?: string
          id?: string
          min_order_charge?: number
          min_order_qty?: number
          pack_price?: number
          pack_size?: number
          pricing_unit?: string
          quote_id?: string
          resource_id?: string | null
          scope_tag?: string | null
          shift_hours?: number
          specification?: string
          terms?: string | null
          transport_included?: boolean
          unit_conversion_factor?: number
          unit_price?: number
          vat_included?: boolean
          waste_pct?: number
        }
        Relationships: []
      }
      assembly_coverage_records: {
        Row: {
          assembly_code: string | null
          assembly_id: string
          assembly_version: number
          boq_item_id: string
          coverage_status: string
          created_at: string
          csi_division: string | null
          evidence_note: string | null
          excluded_scopes: Json
          id: string
          included_scopes: Json
          project_id: string
          tender_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assembly_code?: string | null
          assembly_id: string
          assembly_version?: number
          boq_item_id: string
          coverage_status?: string
          created_at?: string
          csi_division?: string | null
          evidence_note?: string | null
          excluded_scopes?: Json
          id?: string
          included_scopes?: Json
          project_id: string
          tender_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assembly_code?: string | null
          assembly_id?: string
          assembly_version?: number
          boq_item_id?: string
          coverage_status?: string
          created_at?: string
          csi_division?: string | null
          evidence_note?: string | null
          excluded_scopes?: Json
          id?: string
          included_scopes?: Json
          project_id?: string
          tender_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_memberships: {
        Row: {
          created_at: string
          id: string
          role: "pricing_engineer" | "procurement" | "discipline_reviewer" | "approver" | "data_admin"
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: "pricing_engineer" | "procurement" | "discipline_reviewer" | "approver" | "data_admin"
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: "pricing_engineer" | "procurement" | "discipline_reviewer" | "approver" | "data_admin"
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      boq_excel_versions: {
        Row: {
          created_at: string
          file_name: string
          file_sha256: string
          id: string
          imported_count: number
          original_workbook_b64: string | null
          project_id: string
          sheet_names: Json
          status: string
          tender_id: string | null
          user_id: string
          writeback_map: Json
        }
        Insert: {
          created_at?: string
          file_name: string
          file_sha256: string
          id?: string
          imported_count?: number
          original_workbook_b64?: string | null
          project_id: string
          sheet_names?: Json
          status?: string
          tender_id?: string | null
          user_id: string
          writeback_map?: Json
        }
        Update: {
          created_at?: string
          file_name?: string
          file_sha256?: string
          id?: string
          imported_count?: number
          original_workbook_b64?: string | null
          project_id?: string
          sheet_names?: Json
          status?: string
          tender_id?: string | null
          user_id?: string
          writeback_map?: Json
        }
        Relationships: []
      }
      project_rfi_addenda: {
        Row: {
          answered_at: string | null
          cost_impact_sar: number
          created_at: string
          due_date: string | null
          entry_type: string
          id: string
          impacted_boq_item_ids: Json
          project_id: string
          question_text: string | null
          ref_no: string
          response_text: string | null
          status: string
          tender_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answered_at?: string | null
          cost_impact_sar?: number
          created_at?: string
          due_date?: string | null
          entry_type?: string
          id?: string
          impacted_boq_item_ids?: Json
          project_id: string
          question_text?: string | null
          ref_no: string
          response_text?: string | null
          status?: string
          tender_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answered_at?: string | null
          cost_impact_sar?: number
          created_at?: string
          due_date?: string | null
          entry_type?: string
          id?: string
          impacted_boq_item_ids?: Json
          project_id?: string
          question_text?: string | null
          ref_no?: string
          response_text?: string | null
          status?: string
          tender_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tender_evaluations: {
        Row: {
          client_relationship_score: number
          commercial_capacity_score: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          decision_rationale: string | null
          id: string
          margin_attractiveness_score: number
          overall_score: number
          project_id: string
          risk_exposure_score: number
          technical_fit_score: number
          tender_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_relationship_score?: number
          commercial_capacity_score?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_rationale?: string | null
          id?: string
          margin_attractiveness_score?: number
          overall_score?: number
          project_id: string
          risk_exposure_score?: number
          technical_fit_score?: number
          tender_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_relationship_score?: number
          commercial_capacity_score?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          decision_rationale?: string | null
          id?: string
          margin_attractiveness_score?: number
          overall_score?: number
          project_id?: string
          risk_exposure_score?: number
          technical_fit_score?: number
          tender_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      knowledge_item_templates: {
        Row: Record<string, any> & {
          id: string
          workspace_id: string
          code: string
          category_type: string
          scope: string
          title_ar: string
          unit: string
          status: string
        }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      knowledge_template_versions: {
        Row: Record<string, any> & {
          id: string
          template_id: string
          workspace_id: string
          version_no: number
          basis: string
          direct_unit_cost: number
          unit: string
          title_ar: string
          status: string
        }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      knowledge_price_evidence: {
        Row: Record<string, any> & {
          id: string
          workspace_id: string
          source_type: string
          resource_type: string
          title_ar: string
          unit: string
          direct_unit_price: number
          price_date: string
          verification_status: string
          scope: string
        }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      estimate_versions: {
        Row: Record<string, any> & { id: string; project_id: string; version_no: number; state: string; row_version: number }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      indirect_cost_lines: {
        Row: Record<string, any> & { id: string; project_id: string; cost_scope_id: string; driver: string; total_cost: number }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      tender_holds: {
        Row: Record<string, any> & { id: string; project_id: string; tender_id: string; hold_ref: string; subject: string; status: string }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      readiness_runs: {
        Row: Record<string, any> & { id: string; project_id: string; tender_id: string; input_hash: string; overall_state: string }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      comparison_packages: {
        Row: Record<string, any> & { id: string; project_id: string; title_ar: string; target_unit: string; work_quantity: number }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      boq_diff_runs: {
        Row: Record<string, any> & { id: string; project_id: string; old_label: string; new_label: string; status: string }
        Insert: Record<string, any>
        Update: Record<string, any>
        Relationships: []
      }
      knowledge_audit_logs: {
        Row: Record<string, any> & { id: string; workspace_id: string; action: string; entity_type: string; entity_id: string }
        Insert: Record<string, any>
        Update: Record<string, any>
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
      submit_tender_version: {
        Args: {
          p_tender_id: string
          p_project_id: string
          p_idempotency_key: string
          p_currency?: string
          p_pricing_policy?: string
          p_document_ref?: string | null
          p_total_direct_cost?: number
          p_net_selling_price?: number
          p_vat_rate?: number
          p_vat_amount?: number
          p_grand_total_with_vat?: number
          p_items_snapshot?: Json
          p_readiness_run_id?: string | null
          p_export_sha256?: string | null
          p_export_reconciliation?: Json | null
          p_holds_snapshot?: Json
          p_qualifications?: Json
        }
        Returns: Database["public"]["Tables"]["tender_submissions"]["Row"]
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
