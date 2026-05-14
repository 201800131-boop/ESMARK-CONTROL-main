import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface PedidoDanado {
  fecha: string | null;
  fecha_registro: string | null;
  area_id: string | null;
  nombre_pedido: string | null;
  cantidad_danada: number | null;
  motivo_dano: string | null;
  tipo_trabajo: string | null;
  tipo_dano: string | null;
  persona_dano: string | null;
  observacion: string | null;
}

interface AreaRow {
  id: string;
  code: string;
  nombre: string;
}

function toCsv(
  rows: PedidoDanado[],
  areaNameById: Record<string, string>,
): string {
  const headers = [
    "Fecha",
    "Area",
    "Pedido",
    "Cantidad danada",
    "Motivo dano",
    "Tipo trabajo",
    "Tipo dano",
    "Persona dano",
    "Observacion",
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const str = String(v);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const orderedRows = [...rows].sort((a, b) => {
    const left = String(a.fecha ?? a.fecha_registro ?? "");
    const right = String(b.fecha ?? b.fecha_registro ?? "");
    return right.localeCompare(left);
  });

  const lines = [
    headers.join(","),
    ...orderedRows.map((r) =>
      [
        String(r.fecha ?? r.fecha_registro ?? "").slice(0, 10),
        areaNameById[String(r.area_id ?? "")] ?? "Sin area",
        r.nombre_pedido,
        r.cantidad_danada,
        r.motivo_dano,
        r.tipo_trabajo,
        r.tipo_dano,
        r.persona_dano,
        r.observacion,
      ]
        .map(escape)
        .join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const jwt = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(jwt);

  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json()) as {
    area?: string;
    fecha_inicio?: string;
    fecha_fin?: string;
  };
  const { area, fecha_inicio, fecha_fin } = body;

  let areaIdFilter: string | null = null;
  if (area && area !== "all") {
    const { data: areaRow, error: areaErr } = await supabase
      .from("areas")
      .select("id")
      .eq("code", area)
      .maybeSingle();

    if (areaErr) {
      return new Response(JSON.stringify({ error: areaErr.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!areaRow?.id) {
      return new Response(
        JSON.stringify({ error: "Area invalida para exportar." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    areaIdFilter = String(areaRow.id);
  }

  let query = supabase
    .from("pedidos_danados")
    .select(
      "fecha,fecha_registro,area_id,nombre_pedido,cantidad_danada,motivo_dano,tipo_trabajo,tipo_dano,persona_dano,observacion",
    )
    .order("fecha_registro", { ascending: false });

  if (areaIdFilter) query = query.eq("area_id", areaIdFilter);
  if (fecha_inicio) query = query.gte("fecha", fecha_inicio);
  if (fecha_fin) query = query.lte("fecha", fecha_fin);

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = (data ?? []) as PedidoDanado[];
  const areaIds = Array.from(
    new Set(rows.map((row) => String(row.area_id ?? "")).filter(Boolean)),
  );

  let areaNameById: Record<string, string> = {};
  if (areaIds.length > 0) {
    const { data: areasData } = await supabase
      .from("areas")
      .select("id,code,nombre")
      .in("id", areaIds);

    areaNameById = ((areasData ?? []) as AreaRow[]).reduce<
      Record<string, string>
    >((acc, item) => {
      acc[String(item.id)] = item.nombre || item.code;
      return acc;
    }, {});
  }

  const csv = toCsv(rows, areaNameById);

  // Persist a record in reportes_generados
  await supabase.from("reportes_generados").insert({
    area: area ?? "all",
    generado_por: user.id,
    fecha_inicio: fecha_inicio ?? new Date().toISOString().slice(0, 10),
    fecha_fin: fecha_fin ?? new Date().toISOString().slice(0, 10),
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reporte_${area ?? "all"}.csv"`,
    },
  });
});
