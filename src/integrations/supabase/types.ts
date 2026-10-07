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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      deleted_sales: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          deleted_by_name: string
          id: string
          operator_name: string
          reason: string
          sale_created_at: string
          sale_number: number
          sale_total: number
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string
          id?: string
          operator_name?: string
          reason?: string
          sale_created_at: string
          sale_number: number
          sale_total?: number
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          deleted_by_name?: string
          id?: string
          operator_name?: string
          reason?: string
          sale_created_at?: string
          sale_number?: number
          sale_total?: number
        }
        Relationships: []
      }
      product_batches: {
        Row: {
          created_at: string
          expiry_date: string
          id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          expiry_date: string
          id?: string
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          expiry_date?: string
          id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          code: string
          created_at: string
          expiry_date: string | null
          id: string
          name: string
          price: number
          stock: number
          subcategory: string
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          name: string
          price: number
          stock?: number
          subcategory?: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          name?: string
          price?: number
          stock?: number
          subcategory?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_est_add: boolean
          access_est_delete: boolean
          access_est_edit: boolean
          access_est_lotes: boolean
          access_est_novo: boolean
          access_est_remove: boolean
          access_estoque: boolean
          access_impressora: boolean
          access_pdv: boolean
          access_rel_categorias: boolean
          access_rel_estoque: boolean
          access_rel_fechamento: boolean
          access_rel_hora: boolean
          access_rel_vendas: boolean
          access_relatorios: boolean
          access_usuarios: boolean
          created_at: string
          full_name: string
          id: string
          whatsapp: string | null
        }
        Insert: {
          access_est_add?: boolean
          access_est_delete?: boolean
          access_est_edit?: boolean
          access_est_lotes?: boolean
          access_est_novo?: boolean
          access_est_remove?: boolean
          access_estoque?: boolean
          access_impressora?: boolean
          access_pdv?: boolean
          access_rel_categorias?: boolean
          access_rel_estoque?: boolean
          access_rel_fechamento?: boolean
          access_rel_hora?: boolean
          access_rel_vendas?: boolean
          access_relatorios?: boolean
          access_usuarios?: boolean
          created_at?: string
          full_name?: string
          id: string
          whatsapp?: string | null
        }
        Update: {
          access_est_add?: boolean
          access_est_delete?: boolean
          access_est_edit?: boolean
          access_est_lotes?: boolean
          access_est_novo?: boolean
          access_est_remove?: boolean
          access_estoque?: boolean
          access_impressora?: boolean
          access_pdv?: boolean
          access_rel_categorias?: boolean
          access_rel_estoque?: boolean
          access_rel_fechamento?: boolean
          access_rel_hora?: boolean
          access_rel_vendas?: boolean
          access_relatorios?: boolean
          access_usuarios?: boolean
          created_at?: string
          full_name?: string
          id?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          category: string
          id: string
          product_code: string
          product_id: string | null
          product_name: string
          quantity: number
          sale_id: string
          subtotal: number
          unit_price: number
        }
        Insert: {
          category?: string
          id?: string
          product_code: string
          product_id?: string | null
          product_name: string
          quantity: number
          sale_id: string
          subtotal: number
          unit_price: number
        }
        Update: {
          category?: string
          id?: string
          product_code?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sale_id?: string
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          card_amount: number
          cash_amount: number
          change_amount: number
          created_at: string
          id: string
          items_count: number
          operator_id: string | null
          operator_name: string
          sale_number: number
          total: number
        }
        Insert: {
          card_amount?: number
          cash_amount?: number
          change_amount?: number
          created_at?: string
          id?: string
          items_count?: number
          operator_id?: string | null
          operator_name?: string
          sale_number: number
          total?: number
        }
        Update: {
          card_amount?: number
          cash_amount?: number
          change_amount?: number
          created_at?: string
          id?: string
          items_count?: number
          operator_id?: string | null
          operator_name?: string
          sale_number?: number
          total?: number
        }
        Relationships: []
      }
      stock_additions: {
        Row: {
          category: string
          created_at: string
          id: string
          operator_id: string | null
          operator_name: string
          product_code: string
          product_id: string | null
          product_name: string
          quantity: number
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          operator_id?: string | null
          operator_name?: string
          product_code: string
          product_id?: string | null
          product_name: string
          quantity: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          operator_id?: string | null
          operator_name?: string
          product_code?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_additions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_settings: {
        Row: {
          chapelaria_label: string
          fiscal_label: string
          footer_message: string
          id: number
          operator_label: string
          show_chapelaria: boolean
          show_datetime: boolean
          show_operator: boolean
          store_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          chapelaria_label?: string
          fiscal_label?: string
          footer_message?: string
          id?: number
          operator_label?: string
          show_chapelaria?: boolean
          show_datetime?: boolean
          show_operator?: boolean
          store_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          chapelaria_label?: string
          fiscal_label?: string
          footer_message?: string
          id?: number
          operator_label?: string
          show_chapelaria?: boolean
          show_datetime?: boolean
          show_operator?: boolean
          store_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
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
      add_stock: {
        Args: { _expiry_date?: string; _product_id: string; _quantity: number }
        Returns: {
          category: string
          created_at: string
          id: string
          operator_id: string | null
          operator_name: string
          product_code: string
          product_id: string | null
          product_name: string
          quantity: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_additions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_expired_batch: { Args: { _batch_id: string }; Returns: undefined }
      delete_product: { Args: { _product_id: string }; Returns: undefined }
      delete_sale:
        | { Args: { _sale_id: string }; Returns: undefined }
        | { Args: { _reason?: string; _sale_id: string }; Returns: undefined }
      finalize_sale: {
        Args: { _card: number; _cash: number; _change: number; _items: Json }
        Returns: {
          card_amount: number
          cash_amount: number
          change_amount: number
          created_at: string
          id: string
          items_count: number
          operator_id: string | null
          operator_name: string
          sale_number: number
          total: number
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_stock_access: {
        Args: { _flag: string; _user_id: string }
        Returns: boolean
      }
      remove_stock: {
        Args: { _product_id: string; _quantity: number }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "gerente" | "supervisor" | "atendente"
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
    Enums: {
      app_role: ["gerente", "supervisor", "atendente"],
    },
  },
} as const
