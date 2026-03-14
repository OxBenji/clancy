/**
 * In-memory database adapter for demo mode (no Supabase required).
 * Implements the subset of the Supabase client interface used by ralph.ts and API routes.
 */

interface Row {
  [key: string]: unknown;
}

// In-memory tables
const tables: Record<string, Row[]> = {
  projects: [],
  tasks: [],
  guardrails: [],
};

// Minimal query builder that mirrors Supabase's chaining API
class QueryBuilder {
  private table: string;
  private operation: "select" | "insert" | "update" | "delete" | "upsert";
  private filters: { column: string; value: unknown }[] = [];
  private selectColumns: string = "*";
  private updateData: Row = {};
  private insertData: Row | Row[] = {};

  constructor(table: string) {
    this.table = table;
    this.operation = "select";
  }

  select(columns: string = "*") {
    this.operation = "select";
    this.selectColumns = columns;
    return this;
  }

  insert(data: Row | Row[]) {
    this.operation = "insert";
    this.insertData = data;
    // Execute immediately
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      if (!row.id) row.id = crypto.randomUUID();
      if (!row.created_at) row.created_at = new Date().toISOString();
      tables[this.table].push({ ...row });
    }
    return { data: rows, error: null };
  }

  update(data: Row) {
    this.operation = "update";
    this.updateData = data;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });

    if (this.operation === "update") {
      // Apply update to matching rows
      for (const row of tables[this.table]) {
        if (this.filters.every((f) => row[f.column] === f.value)) {
          Object.assign(row, this.updateData);
        }
      }
      return { data: null, error: null };
    }

    if (this.operation === "delete") {
      tables[this.table] = tables[this.table].filter(
        (row) => !this.filters.every((f) => row[f.column] === f.value)
      );
      return { data: null, error: null };
    }

    // For select, return matching rows
    if (this.operation === "select") {
      const matching = tables[this.table].filter((row) =>
        this.filters.every((f) => row[f.column] === f.value)
      );
      return { data: matching, error: null };
    }

    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    const matching = tables[this.table].filter((row) =>
      this.filters.every((f) => row[f.column] === f.value)
    );
    const asc = options?.ascending ?? true;
    matching.sort((a, b) => {
      const va = a[column] as string | number;
      const vb = b[column] as string | number;
      if (va < vb) return asc ? -1 : 1;
      if (va > vb) return asc ? 1 : -1;
      return 0;
    });
    return { data: matching, error: null };
  }

  // Terminal method for selects without filters
  then(resolve: (result: { data: Row[]; error: null }) => void) {
    const matching = tables[this.table].filter((row) =>
      this.filters.every((f) => row[f.column] === f.value)
    );
    resolve({ data: matching, error: null });
  }
}

// Minimal Supabase-compatible client
const memoryClient = {
  from(table: string) {
    if (!tables[table]) tables[table] = [];
    return new QueryBuilder(table);
  },
};

export type MemoryClient = typeof memoryClient;

export function getMemoryDb(): MemoryClient {
  return memoryClient;
}
