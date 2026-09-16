import type { PrismaClient } from "@resolution/database";
interface Row {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  messages: string;
  lockedUntil: number;
  createdAt: Date;
  updatedAt: Date;
}
type Where = Partial<Omit<Row, "lockedUntil">> & { lockedUntil?: number | { lte: number } };
export function fakeConversations(): PrismaClient["chatConversation"] {
  const rows: Row[] = [];
  const matches = (r: Row, w: Where) =>
    Object.entries(w).every(([k, v]) =>
      k === "lockedUntil" && typeof v === "object"
        ? r.lockedUntil <= (v as { lte: number }).lte
        : r[k as keyof Row] === v,
    );
  return {
    async create({ data }: { data: Partial<Row> }) {
      const row = {
        id: crypto.randomUUID(),
        title: "",
        tenantId: "",
        userId: "",
        messages: "[]",
        lockedUntil: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    async findFirst({ where }: { where: Where }) {
      const row = rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    },
    async findMany({ where }: { where: Where }) {
      return rows
        .filter((r) => matches(r, where))
        .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt }));
    },
    async updateMany({ where, data }: { where: Where; data: Partial<Row> }) {
      const selected = rows.filter((r) => matches(r, where));
      selected.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
      return { count: selected.length };
    },
    async deleteMany({ where }: { where: Where }) {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--)
        if (matches(rows[i]!, where)) {
          rows.splice(i, 1);
          count++;
        }
      return { count };
    },
  } as unknown as PrismaClient["chatConversation"];
}
